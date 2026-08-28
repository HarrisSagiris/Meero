"""LangGraph-powered conversational build agent.

Graph:  START → reply → decide → apply → END

- reply  : streams a conversational answer token-by-token (custom stream)
- decide : structured action plan (spec merge? start the build?)
- apply  : executes the real side effects — spec insert, build queueing,
           assistant message persistence — and appends deterministic truth
           about what actually ran to the reply.
"""

import asyncio
from typing import Any, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from app.infrastructure.database import db
from app.agents import prompts
from app.agents.codegen import llm, model_for_plan
from app.config import WEB_BUILD_COST
from app.infrastructure.queues.queues import CODEGEN_QUEUE, enqueue


def _usage_tokens(obj: Any) -> int:
    """Best-effort total_tokens from a LangChain message/chunk's usage_metadata.
    Returns 0 when absent — token accounting must never raise and break chat."""
    try:
        usage = getattr(obj, "usage_metadata", None)
        if not usage:
            return 0
        total = usage.get("total_tokens") if isinstance(usage, dict) else getattr(usage, "total_tokens", 0)
        return int(total or 0)
    except Exception:
        return 0


class QuickQuestion(BaseModel):
    question: str = Field(description="One short clarifying question for the user")
    options: list[str] = Field(
        default_factory=list,
        description="2-5 short, tappable answer choices for this question",
    )
    multi: bool = Field(
        default=False,
        description="True if the user may pick several options, not just one",
    )


class ChatAction(BaseModel):
    updated_spec: str | None = Field(
        default=None,
        description="Complete merged app spec if the message changes the app",
    )
    start_build: bool = False
    questions: list[QuickQuestion] = Field(
        default_factory=list,
        # Deliberately no max_length here: with include_raw=True, a schema
        # validation failure just yields parsed=None, and decide_node's
        # fallback to a blank ChatAction() would then also wipe out a real
        # updated_spec/start_build for the turn — worse than a long list.
        # decide_node slices to 2 in code after parsing succeeds instead.
        description=(
            "AT MOST 2 clarifying questions from your reply, as tappable "
            "multiple-choice — pick only the highest-impact ones, shown one "
            "at a time. Fill this ONLY when asking the user to clarify (e.g. "
            "the opening exchange) and NOT building; empty otherwise."
        ),
    )


class ChatState(TypedDict, total=False):
    project: dict[str, Any]
    spec: dict[str, Any] | None
    history: list[dict[str, Any]]
    message: str
    user_plan: str
    attachments: list[dict[str, Any]]
    reply: str
    action: ChatAction
    new_spec_version: int | None
    builds_started: list[str]
    # True when Manual mode parked a ready-to-build spec on
    # projects.pending_build_spec_id instead of queueing it for real.
    build_pending: bool
    # Tappable multiple-choice questions to render under the reply (only on
    # clarifying turns, never when a build started). Each: {question, options, multi}.
    questions: list[dict[str, Any]]
    final_reply: str
    # Real OpenAI tokens consumed across the turn's LLM calls (reply + decide),
    # used to bill actual usage. See app/main.py chat_stream.
    tokens_used: int


def _context(state: ChatState) -> str:
    spec = state.get("spec")
    history_text = (
        "\n".join(f"{m['role']}: {m['content'][:600]}" for m in state["history"][-12:])
        or "(no prior messages)"
    )
    message = state["message"]
    attachments = state.get("attachments") or []
    if attachments:
        names = ", ".join(a.get("name", "file") for a in attachments)
        message = (
            f"{message}\n\n[The user attached these reference documents: "
            f"{names}. Factor their intent into the app spec.]"
        )
    return prompts.CHAT_USER_TEMPLATE.format(
        name=state["project"].get("name", "Untitled"),
        spec_version=spec["version"] if spec else 0,
        spec=spec["prompt"] if spec else "(no spec yet)",
        history=history_text,
        message=message,
    )


async def reply_node(state: ChatState) -> dict:
    writer = get_stream_writer()
    model = model_for_plan(state.get("user_plan"))
    parts: list[str] = []
    tokens = 0
    async for chunk in llm(model=model).astream(
        [("system", prompts.CHAT_REPLY_SYSTEM), ("user", _context(state))]
    ):
        content = chunk.content
        if isinstance(content, str) and content:
            parts.append(content)
            writer({"token": content})
        # With stream_usage=True the terminal chunk carries the turn's usage.
        tokens += _usage_tokens(chunk)
    return {"reply": "".join(parts), "tokens_used": state.get("tokens_used", 0) + tokens}


async def decide_node(state: ChatState) -> dict:
    # The reply has finished streaming but this node's own LLM call (which,
    # on a build-starting turn, has to regenerate the ENTIRE merged app spec
    # as a structured-output field) can genuinely take several seconds with
    # no output of its own — without this, the chat UI goes completely silent
    # right when the user is confirming/starting a build. See chat-panel.tsx's
    # handling of `payload.status`.
    writer = get_stream_writer()
    writer({"status": "deciding"})
    model = model_for_plan(state.get("user_plan"))
    result = await llm(model=model).with_structured_output(
        ChatAction, include_raw=True
    ).ainvoke(
        [
            ("system", prompts.CHAT_DECIDE_SYSTEM),
            (
                "user",
                _context(state)
                + f"\n\nAssistant reply just given:\n{state['reply']}",
            ),
        ]
    )
    # include_raw=True returns {"raw": AIMessage, "parsed": ChatAction, ...} so
    # we can read the structured action AND the real token usage of the call.
    action = result.get("parsed") if isinstance(result, dict) else result
    if not isinstance(action, ChatAction):
        action = ChatAction()
    # Deterministic backstop, not just a prompt request: the one-at-a-time
    # UI (chat-panel.tsx) is designed around a short list, and prompt-only
    # guidance has proven unreliable elsewhere in this codebase — never trust
    # it alone for something the UI depends on structurally.
    action.questions = action.questions[:2]
    tokens = _usage_tokens(result.get("raw")) if isinstance(result, dict) else 0
    return {"action": action, "tokens_used": state.get("tokens_used", 0) + tokens}


async def apply_node(state: ChatState) -> dict:
    writer = get_stream_writer()
    # Real side effects follow (spec write, build creation, credit charge) —
    # another silent stretch after decide_node's own "deciding" status unless
    # we say so. Overwritten by the more specific "starting_build" status
    # below when this turn actually starts a build.
    writer({"status": "applying"})
    action = state["action"]
    project = state["project"]
    spec = state.get("spec")

    new_spec = None
    if action.updated_spec and action.updated_spec.strip():
        new_spec = await asyncio.to_thread(
            db.create_spec,
            project["id"],
            action.updated_spec.strip(),
            project["owner_id"],
            attachments=state.get("attachments") or [],
        )

    # Never build on the opening exchange of a new project — the assistant
    # asks clarifying questions first, and only builds once the user has
    # engaged (answered / confirmed). "First turn" = no assistant message has
    # been recorded yet (history holds only the user's messages so far). This
    # is deterministic so it can't be overridden by a stray LLM decision.
    history = state.get("history") or []
    has_assistant_turn = any(m.get("role") == "assistant" for m in history)
    if not has_assistant_turn:
        action.start_build = False

    # Every plan builds the same thing: one real, secure, full-stack web
    # app. See AGENTS.md — there's no per-platform target to choose between.
    # A build needs a linked Supabase project (the app's real backend); when
    # it's missing, say so honestly instead of queueing a doomed build.
    started: list[str] = []
    needs_supabase_link = False
    awaiting_approval = False
    is_manual = project.get("autonomy_mode") == "manual"
    if action.start_build:
        if not project.get("supabase_project_ref"):
            needs_supabase_link = True
        else:
            build_spec = new_spec or spec
            if build_spec is not None and is_manual:
                # Manual mode: the agent still decided the app is ready, but
                # a real build (and its real credit charge) only starts once
                # the user genuinely approves — see POST
                # /projects/{id}/approve-build in app/main.py. Never queue
                # anything here.
                await asyncio.to_thread(
                    db.set_pending_build, project["id"], build_spec["id"]
                )
                awaiting_approval = True
            elif build_spec is not None:
                writer({"status": "starting_build"})
                build = await asyncio.to_thread(
                    db.create_build, project["id"], build_spec["id"], "web"
                )
                enqueue(CODEGEN_QUEUE, {"build_id": build["id"]})
                await asyncio.to_thread(
                    db.charge_credits, project["owner_id"], WEB_BUILD_COST
                )
                started.append("web")

    # Deterministic truth about side effects, appended server-side.
    notes: list[str] = []
    if new_spec is not None:
        notes.append(f"Spec updated to v{new_spec['version']}.")
    if started:
        notes.append("Started building your app.")
    if awaiting_approval:
        notes.append(
            "Your app is ready to build — Manual mode is on, so I'll wait "
            "for your OK. Hit **Approve build** below when you're ready "
            "(or switch back to Solo mode in Settings to skip this step)."
        )
    if needs_supabase_link:
        notes.append(
            "Before I can build, link a Supabase project to this app — it's "
            "where your app's database and user accounts will live. Use the "
            "Supabase button in the header, then tell me to build."
        )

    final_reply = state["reply"].strip()
    if notes:
        note_text = " ".join(notes)
        final_reply = f"{final_reply}\n\n{note_text}"
        writer({"token": f"\n\n{note_text}"})

    await asyncio.to_thread(
        db.add_message,
        project["id"],
        "assistant",
        final_reply,
        new_spec["version"] if new_spec else None,
    )

    # Surface clarifying questions as tappable choices — but only when we did
    # NOT start (or ask to approve) a build; nothing to clarify at that point.
    questions = (
        [] if (started or awaiting_approval) else [q.model_dump() for q in action.questions]
    )

    return {
        "new_spec_version": new_spec["version"] if new_spec else None,
        "builds_started": started,
        "build_pending": awaiting_approval,
        "questions": questions,
        "final_reply": final_reply,
    }


def _build_graph():
    graph = StateGraph(ChatState)
    graph.add_node("reply", reply_node)
    graph.add_node("decide", decide_node)
    graph.add_node("apply", apply_node)
    graph.add_edge(START, "reply")
    graph.add_edge("reply", "decide")
    graph.add_edge("decide", "apply")
    graph.add_edge("apply", END)
    return graph.compile()


chat_graph = _build_graph()
