"""Superagent worker — real GitHub- and Slack-mention-triggered coding agent.

Input (queued either by POST /webhooks/github/superagent for a real
"@meero" GitHub comment, POST /webhooks/slack/events for a real "@Meero"
Slack mention, or POST /superagent/connections/{id}/chat for a direct chat
message — see app/main.py):
{connection_id, event_id, event_type, issue_number, issue_title,
issue_body, mention_text, [slack_bot_token, slack_channel, slack_thread_ts]}.

Two real LLM calls (app/agent/superagent_brain.py) sandwiched between real
GitHub reads/writes: fetch the repo's real file tree, ask the model which
files it needs, fetch those, ask it to write the actual change, then open a
genuine pull request (app/superagent.py's open_pull_request_with_patch,
which only touches the files that changed). The reply goes back wherever
the mention came from — a real GitHub comment, or a real Slack message via
chat.postMessage (app/slack.py) — never a canned response. Every step that
can fail leaves a real superagent_events row explaining what happened —
never a silent drop.

Run:  python -m app.workers.superagent_worker
"""

from app.infrastructure.database import db
from app.agents.codegen import model_for_plan
from app.agents.superagent_brain import generate_patch, select_relevant_files
from app.infrastructure.queues.queues import SUPERAGENT_QUEUE, dequeue_blocking
from app.services.slack.slack import post_message as post_slack_message
from app.services.superagent.superagent import (
    get_default_branch,
    get_file_content,
    get_repo_tree,
    make_branch_name,
    open_pull_request_with_patch,
    post_comment,
)
from app.workers.common import log


def _reply(job: dict, github_token: str, full_name: str, issue_number: int | None, text: str) -> None:
    """Sends the reply back wherever the mention actually came from."""
    if job.get("event_type") == "slack_mention":
        post_slack_message(
            job["slack_bot_token"],
            job["slack_channel"],
            text,
            thread_ts=job.get("slack_thread_ts"),
        )
    elif issue_number is not None:
        post_comment(github_token, full_name, issue_number, f"@meero: {text}")
    # A direct chat message (POST /superagent/connections/{id}/chat) never
    # reaches this worker — that endpoint replies synchronously in its own
    # request and has no issue_number/Slack channel to reply into here.


def process_job(job: dict) -> None:
    connection_id = job["connection_id"]
    event_id = job["event_id"]
    issue_number = job["issue_number"]
    mention_text = job.get("mention_text", "")
    issue_title = job.get("issue_title", "")
    issue_body = job.get("issue_body", "")

    connection = db.get_superagent_connection(connection_id)
    if connection is None or connection.get("status") != "active":
        db.finish_superagent_event(event_id, "failed", error="Connection no longer active.")
        return
    full_name = connection["github_repo_full_name"]
    user_id = connection["user_id"]

    gh = db.get_github_connection(user_id)
    if gh is None:
        db.finish_superagent_event(
            event_id, "failed", error="GitHub is no longer connected for this account."
        )
        return
    token = gh["access_token"]

    profile = db.get_profile(user_id) or {}
    model = model_for_plan(profile.get("plan"))

    try:
        branch = get_default_branch(token, full_name)
        tree = get_repo_tree(token, full_name, branch)

        selection = select_relevant_files(
            repo_full_name=full_name,
            mention_text=mention_text,
            issue_title=issue_title,
            issue_body=issue_body,
            file_tree=tree,
            model=model,
        )
        if not selection.can_help:
            reason = selection.reason or "This isn't something I can turn into a code change."
            _reply(job, token, full_name, issue_number, reason)
            db.finish_superagent_event(event_id, "succeeded", summary=f"Declined: {reason}")
            return

        files = {}
        for path in selection.paths:
            content = get_file_content(token, full_name, path, branch)
            if content is not None:
                files[path] = content

        patch = generate_patch(
            repo_full_name=full_name,
            mention_text=mention_text,
            issue_title=issue_title,
            issue_body=issue_body,
            files=files,
            model=model,
        )
        if not patch.can_help or not patch.files:
            reply = patch.reply_comment or "I couldn't safely make this change."
            _reply(job, token, full_name, issue_number, reply)
            db.finish_superagent_event(event_id, "succeeded", summary=f"Declined: {reply}")
            return

        pr = open_pull_request_with_patch(
            token,
            full_name,
            [{"path": f.path, "content": f.content} for f in patch.files],
            make_branch_name(patch.branch_name, event_id),
            patch.pr_title or "Meero: automated change",
            patch.pr_body or "Opened by Superagent in response to an @meero mention.",
            base=branch,
        )

        reply = f"{patch.reply_comment}\n\nOpened {pr['html_url']}".strip()
        _reply(job, token, full_name, issue_number, reply)
        db.finish_superagent_event(
            event_id, "succeeded", pr_url=pr["html_url"], summary=patch.pr_title
        )
        log.info("Superagent opened %s for connection %s", pr["html_url"], connection_id)

    except Exception as exc:  # noqa: BLE001 — worker must not die on one job
        log.exception("Superagent run failed for event %s", event_id)
        db.finish_superagent_event(event_id, "failed", error=str(exc)[:500])
        try:
            _reply(
                job,
                token,
                full_name,
                issue_number,
                "something went wrong on my end handling this — a human should take a look.",
            )
        except Exception:  # noqa: BLE001 — best-effort, the real error is already recorded
            pass


def main() -> None:
    log.info("Superagent worker up; waiting on %s", SUPERAGENT_QUEUE)
    while True:
        job = dequeue_blocking(SUPERAGENT_QUEUE)
        if job is not None:
            process_job(job)


if __name__ == "__main__":
    main()
