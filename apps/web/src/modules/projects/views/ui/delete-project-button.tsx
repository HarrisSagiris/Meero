"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { deleteProject } from "@/modules/projects/actions/project-actions";
import { TrashIcon } from "@/components/icons";

/** Deletes a real project — irreversible (cascades to its specs, messages,
 *  builds, build_files, everything), so this is confirm-gated with a
 *  branded portal/backdrop modal instead of the plain native
 *  window.confirm(). */
export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  function onConfirm() {
    setConfirming(false);
    startTransition(() => {
      void deleteProject(projectId);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(true)}
        aria-label="Delete project"
        className="relative z-10 rounded-md p-1 text-input opacity-0 transition-all duration-200 group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <TrashIcon size={15} />
      </button>

      {confirming &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              aria-label="Cancel"
              onClick={() => setConfirming(false)}
              className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            />
            <div className="animate-pop relative w-full max-w-sm rounded-3xl border border-border bg-white p-6 shadow-composer">
              <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
                Delete &ldquo;{projectName}&rdquo;?
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">
                This permanently deletes the project, its chat history, and every build — this
                can&apos;t be undone.
              </p>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="rounded-full px-4 py-2 text-[13px] font-medium text-secondary-foreground transition hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={pending}
                  className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {pending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
