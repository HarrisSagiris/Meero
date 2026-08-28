"""Superagent's real LLM calls — reuses the same `llm()` (OpenAI or Claude
Sonnet depending on plan, real structured-output calls, real timeout)
codegen.py already uses for app generation. Two real round-trips, same
shape a human contributor would
follow: first figure out which files in the repo actually matter for this
request, then read them and write the actual change. No IO happens in this
module — app/workers/superagent_worker.py does the real GitHub reads/writes
around these two calls.
"""

from pydantic import BaseModel, Field

from app.agents.codegen import llm

MAX_FILES = 12


class FileSelection(BaseModel):
    can_help: bool = Field(
        description="False if this request has nothing to do with making a "
        "code change to this repo (e.g. it's a question, or off-topic) — "
        "never guess a file selection for a request that isn't actually "
        "asking for a change."
    )
    paths: list[str] = Field(
        default_factory=list,
        description=f"Up to {MAX_FILES} real paths from the given file tree "
        "that are actually relevant to making this change. Only paths that "
        "appear verbatim in the tree.",
    )
    reason: str = Field(
        default="", description="One sentence: why these files, or why can_help is false."
    )


class FileChange(BaseModel):
    path: str
    content: str


class SuperagentPatch(BaseModel):
    can_help: bool = Field(
        description="False if a safe, correct change genuinely isn't "
        "possible from the files given — never fabricate a partial or "
        "guessed change."
    )
    branch_name: str = Field(description="A short, valid git branch name, e.g. 'meero/fix-typo'.")
    pr_title: str
    pr_body: str = Field(description="1-3 sentences explaining what changed and why, for a real PR description.")
    reply_comment: str = Field(
        description="A short, friendly reply posted back on the mention — "
        "what you did, or why you couldn't help."
    )
    files: list[FileChange] = Field(default_factory=list)


_SELECT_SYSTEM = """You are Superagent, a real coding agent for a GitHub \
repo — triggered either by an @meero mention on an issue/PR, or by a direct \
chat message from the repo's owner. You're given the request text and the \
repo's real file tree (every file path, nothing else yet). Decide which \
real files you'd need to actually read to make the requested change, and \
return their exact paths. Be economical — pick only files genuinely \
relevant to the request, never the whole tree. If the message is just a \
question or comment with no code change implied, that's fine — set \
can_help to false and explain in `reason`; you'll still get a chance to \
reply conversationally."""

_SELECT_USER = """Repo: {repo}
{history}Message: "{mention}"
Issue/PR title: {title}
Issue/PR body:
{body}

File tree ({count} files):
{tree}
"""

_PATCH_SYSTEM = """You are Superagent, a real coding agent with write access \
to this repo via a genuine pull request. You're given the request that \
triggered you and the CURRENT real content of the files you asked to see. \
If it's asking for a change: produce the complete new content for every \
file you're changing (not a diff — the full file content, since these are \
committed as-is) plus any brand-new files you need to add, and write a \
short reply_comment describing what you did. If it's a question or doesn't \
need a code change, set can_help to false, leave files empty, and put a \
real, helpful conversational answer in reply_comment instead — never \
fabricate a change just to have something to do. If a change genuinely \
can't be done safely from what you were given, also set can_help to false \
and say why."""

_PATCH_USER = """Repo: {repo}
{history}Message: "{mention}"
Issue/PR title: {title}
Issue/PR body:
{body}

Current content of the files you selected:
{files}
"""


def _history_block(history: list[dict[str, str]] | None) -> str:
    if not history:
        return ""
    lines = "\n".join(f"{m['role']}: {m['content']}" for m in history[-8:])
    return f"Conversation so far:\n{lines}\n\n"


def select_relevant_files(
    *,
    repo_full_name: str,
    mention_text: str,
    issue_title: str,
    issue_body: str,
    file_tree: list[str],
    model: str,
    history: list[dict[str, str]] | None = None,
) -> FileSelection:
    result = llm(model=model).with_structured_output(FileSelection).invoke(
        [
            ("system", _SELECT_SYSTEM),
            (
                "user",
                _SELECT_USER.format(
                    repo=repo_full_name,
                    mention=mention_text,
                    title=issue_title,
                    body=issue_body or "(none)",
                    count=len(file_tree),
                    tree="\n".join(file_tree[:4000]),
                    history=_history_block(history),
                ),
            ),
        ]
    )
    if not isinstance(result, FileSelection):
        return FileSelection(can_help=False, reason="Model returned no parseable selection.")
    result.paths = result.paths[:MAX_FILES]
    return result


def generate_patch(
    *,
    repo_full_name: str,
    mention_text: str,
    issue_title: str,
    issue_body: str,
    files: dict[str, str],
    model: str,
    history: list[dict[str, str]] | None = None,
) -> SuperagentPatch:
    files_block = "\n\n".join(
        f"--- {path} ---\n{content}" for path, content in files.items()
    ) or "(no existing files selected — answer conversationally, or if a change is truly needed, include brand-new files.)"
    result = llm(max_tokens=32000, model=model).with_structured_output(SuperagentPatch).invoke(
        [
            ("system", _PATCH_SYSTEM),
            (
                "user",
                _PATCH_USER.format(
                    repo=repo_full_name,
                    mention=mention_text,
                    title=issue_title,
                    body=issue_body or "(none)",
                    files=files_block,
                    history=_history_block(history),
                ),
            ),
        ]
    )
    if not isinstance(result, SuperagentPatch):
        return SuperagentPatch(
            can_help=False,
            branch_name="meero/no-op",
            pr_title="",
            pr_body="",
            reply_comment="I couldn't generate a change for this — no parseable response.",
        )
    return result
