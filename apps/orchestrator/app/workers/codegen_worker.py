"""Codegen worker.

Consumes jobs from the codegen queue, runs the OpenAI codegen agent, writes
the generated Next.js + shadcn/ui app project to the workspace, and uploads
a source archive to Supabase Storage. Then hands off to the real builder:
`app/workers/web_worker.py`, which applies the schema, runs a real
`next build` (static export) on a plain Linux host, and publishes the
live, running app preview.

Run:  python -m app.workers.codegen_worker
"""

from app.infrastructure.database import db
from app.agents.codegen import (
    CodegenError,
    GeneratedFile,
    diff_files,
    fix_project,
    generate_project,
    model_for_plan,
    plan_app,
)
from app.errors import BuildCanceled
from app.infrastructure.queues.queues import (
    CODEGEN_QUEUE,
    WEB_BUILD_QUEUE,
    dequeue_blocking,
    enqueue,
    is_build_canceled,
    publish_event,
)
from app.workers.common import (
    language_for,
    log,
    workspace_for,
    write_bundle,
    zip_dir,
)


def process_job(job: dict) -> None:
    build_id = job["build_id"]
    fix_of = job.get("fix_of")
    build = db.get_build(build_id)
    if build is None:
        log.error("Build %s not found; dropping job", build_id)
        return

    spec = db.get_spec(build["spec_id"])
    if spec is None:
        db.set_build_status(build_id, "failed", error="Spec not found.")
        return

    project_id = build["project_id"]
    platform = build["platform"]  # always "web"

    project = db.get_project(project_id)
    owner_profile = db.get_profile(project["owner_id"]) if project else None
    model = model_for_plan(
        owner_profile["plan"] if owner_profile else None,
        project.get("preferred_model") if project else None,
    )

    # A real, user-initiated stop (POST /builds/{id}/cancel) — checked before
    # the LLM call starts and throttled inside its streaming loop.
    should_cancel = lambda: is_build_canceled(build_id)  # noqa: E731

    persisted_seq = 0

    def on_file(path: str, status: str, content: str = "") -> None:
        nonlocal persisted_seq
        publish_event(
            {
                "type": "build.coding_file",
                "project_id": project_id,
                "build_id": build_id,
                "platform": platform,
                "path": path,
                "status": status,  # "coding" | "done"
                # Real, still-growing source for this file — lets the Code tab
                # render it appearing line by line as it's generated.
                "content": content,
            }
        )
        # "done" fires exactly once per file, with its final content — durably
        # persist it right away (not just once at the very end via
        # replace_build_files below) so a page refresh mid-generation still
        # shows real, already-finished code instead of nothing. Best-effort:
        # a transient write failure here shouldn't fail an otherwise-good
        # generation, since replace_build_files() is still the authoritative
        # write once the full bundle is done.
        if status == "done":
            try:
                db.upsert_build_file(
                    build_id, project_id, path, content, language_for(path), persisted_seq
                )
                persisted_seq += 1
            except Exception:  # noqa: BLE001
                log.exception("Live file persist failed for %s (build %s)", path, build_id)

    def on_plan(plan: dict) -> None:
        publish_event(
            {
                "type": "build.planning",
                "project_id": project_id,
                "build_id": build_id,
                "platform": platform,
                "plan": plan,
            }
        )
        # Durably persist the growing plan too (not just the live WS
        # signal) — called on every chunk, including the last (the
        # complete, final plan), so a page refresh at any point during
        # planning still shows real content instead of nothing. Best-effort,
        # same tradeoff as on_file's live persist below: a transient write
        # failure here shouldn't affect codegen itself.
        try:
            db.set_build_plan_preview(build_id, plan)
        except Exception:  # noqa: BLE001
            log.exception("Live plan persist failed (build %s)", build_id)

    try:
        publish_event(
            {
                "type": "build.phase",
                "project_id": project_id,
                "build_id": build_id,
                "platform": platform,
                "phase": "fixing_code" if fix_of else "generating_code",
            }
        )

        fix_result = None
        if fix_of:
            # One real AI fix attempt: fed the exact stored bundler error and
            # the previously generated files — never a blind re-plan from
            # scratch. fix_project tries a TARGETED fix first (only the
            # implicated file(s), everything else carried forward untouched)
            # and falls back to a full regenerate when the error can't be
            # confidently scoped — see codegen.py's FixResult.
            original_build = db.get_build(fix_of) or {}
            original_artifact = db.get_artifact(fix_of, "source_archive") or {}
            original_meta = original_artifact.get("metadata") or {}
            title = original_meta.get("title", "App")
            # Carried forward unchanged (a fix never re-plans) so later
            # actions still have the original plan to work from.
            plan_dict = original_meta.get("plan")
            previous_files = [
                GeneratedFile(path=f["path"], content=f["content"])
                for f in db.list_build_files(fix_of)
            ]
            fix_result = fix_project(
                spec["prompt"],
                previous_files,
                # A runtime-triggered fix (see db.create_runtime_fix_build)
                # sets the error text on THIS build's own row, since the
                # build it's fixing actually succeeded and has no error of
                # its own; a normal compile-failure fix falls back to the
                # original build's stored error, as before.
                build.get("error") or original_build.get("error") or "",
                model=model,
                on_file=on_file,
                should_cancel=should_cancel,
                # The conversion agent (app/conversion_agent.py) reuses this
                # exact fix/regenerate machinery to carry a real FEATURE
                # prompt (launch/graduate/revert an A/B experiment) — not a
                # build failure — via the same create_conversion_experiment_
                # build → "error" column → fix_of plumbing as a real error
                # fix. Without this flag the model would be told a working
                # app "FAILED on real infrastructure" when it's actually
                # being asked to implement a feature.
                is_feature_request=bool(build.get("is_conversion_experiment")),
            )
            bundle = fix_result.bundle
        else:
            plan = plan_app(
                spec["prompt"], model=model, should_cancel=should_cancel, on_plan=on_plan
            )
            # Ground this build in the project's own REAL existing code
            # whenever there is any — the fix for chat iteration blindly
            # regenerating a whole working app from scratch instead of
            # editing it. get_latest_succeeded_build naturally returns None
            # for a project's first build (nothing to ground on — identical
            # to the old behavior) and naturally ignores in-flight/failed
            # builds (iterate from the last known-good code, never a build
            # that's still running or broken).
            previous_build = db.get_latest_succeeded_build(project_id)
            previous_files = (
                [
                    GeneratedFile(path=f["path"], content=f["content"])
                    for f in db.list_build_files(previous_build["id"])
                ]
                if previous_build
                else None
            )
            bundle = generate_project(
                plan,
                spec["prompt"],
                model=model,
                on_file=on_file,
                should_cancel=should_cancel,
                previous_files=previous_files,
            )
            title = plan.title
            plan_dict = plan.model_dump()
            if previous_files:
                # Same "what actually changed" UI as a fix build gets —
                # real, computed diffs, never a description of one. Helps
                # prove to the user that iterating really did preserve
                # everything else, not just claim to.
                changed_paths, diffs = diff_files(previous_files, bundle.files)
                db.set_build_fix_explanation(
                    build_id,
                    explanation=(
                        "Updated the app for your latest request, keeping "
                        "everything else the same."
                        if changed_paths
                        else "No code changes were needed — the app already covers this."
                    ),
                    changed_paths=changed_paths,
                    diffs=diffs,
                    targeted=False,
                )

        root = workspace_for(build_id, platform)
        write_bundle(bundle, root)

        # Surface the real generated source in the builder's Code tab. This
        # happens BEFORE we hand off to the bundler — the user watches the
        # actual app code that is about to be bundled, never a placeholder.
        db.replace_build_files(
            build_id,
            project_id,
            [
                {
                    "path": f.path,
                    "content": f.content,
                    "language": language_for(f.path),
                }
                for f in bundle.files
            ],
        )
        publish_event(
            {
                "type": "build.code",
                "project_id": project_id,
                "build_id": build_id,
                "platform": platform,
                "file_count": len(bundle.files),
            }
        )

        # Real "what was wrong, what changed" — a plain-English explanation
        # plus an actual diff per changed file, for the builder's fix-review
        # UI. Only set on a fix build; a first generation has nothing to
        # diff against.
        if fix_result is not None:
            db.set_build_fix_explanation(
                build_id,
                explanation=fix_result.explanation,
                changed_paths=fix_result.changed_paths,
                diffs=fix_result.diffs,
                targeted=fix_result.targeted,
            )

        archive = zip_dir(root)

        storage_path = f"{project_id}/{build_id}/app-source.zip"
        db.upload_artifact_file(storage_path, archive, "application/zip")
        db.add_artifact(
            build_id,
            "source_archive",
            storage_path,
            size_bytes=len(archive),
            metadata={"title": title, "file_count": len(bundle.files), "plan": plan_dict},
        )

        # Hand off to the web worker on a plain Linux host — its first real
        # step is applying schema.sql to the user's own database.
        enqueue(
            WEB_BUILD_QUEUE,
            {
                "build_id": build_id,
                "project_id": project_id,
                "storage_path": storage_path,
            },
        )
        publish_event(
            {
                "type": "build.phase",
                "project_id": project_id,
                "build_id": build_id,
                "platform": platform,
                "phase": "applying_schema",
            }
        )
        log.info("Codegen done for build %s (%s files)", build_id, len(bundle.files))

    except BuildCanceled:
        # A real, user-initiated stop — never enqueue to the web queue.
        # db.set_build_status()'s sticky-canceled guard means this is a
        # no-op if the cancel endpoint's own write already landed; either
        # way the row ends up "canceled", never silently resurrected.
        log.info("Build %s canceled during codegen", build_id)
        db.set_build_status(build_id, "canceled")
    except CodegenError as exc:
        db.set_build_status(build_id, "failed", error=f"Codegen rejected: {exc}")
    except Exception as exc:  # noqa: BLE001 — worker must not die on one job
        log.exception("Codegen failed for build %s", build_id)
        db.set_build_status(build_id, "failed", error=f"Codegen error: {exc}")


def main() -> None:
    log.info("Codegen worker up; waiting on %s", CODEGEN_QUEUE)
    while True:
        job = dequeue_blocking(CODEGEN_QUEUE)
        if job is not None:
            process_job(job)


if __name__ == "__main__":
    main()
