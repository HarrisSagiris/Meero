"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createProject, type CreateProjectState } from "@/modules/projects/actions/project-actions";
import { ArrowUpIcon, PlusIcon } from "@/components/icons";
import { PENDING_PROMPT_KEY } from "@/modules/landing/views/ui/landing-composer";
import { createClient } from "@/lib/supabase/client";
import { STARTER_IDEAS } from "@/modules/landing/utils/starter-ideas";
import { ModelSelector } from "@/modules/projects/views/ui/model-selector";
import { DEFAULT_MODEL, type ModelId } from "@/modules/projects/utils/models";
import type { Plan, SpecAttachment } from "@/lib/types";

const initialState: CreateProjectState = {};

const MAX_FILES = 10;
const MAX_FILE_MB = 20;
const ACCEPT = ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.csv,.json,.docx";

export function PromptComposer({
  plan,
  creditsRemaining,
  bonusCredits,
}: {
  plan: Plan;
  creditsRemaining: number;
  bonusCredits: number;
}) {
  const [state, formAction, pending] = useActionState(createProject, initialState);

  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<SpecAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }

  function onPromptChange(value: string) {
    setPrompt(value);

    requestAnimationFrame(() => {
      resizeTextarea();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function applyIdea(ideaPrompt: string) {
    setPrompt(ideaPrompt);

    requestAnimationFrame(() => {
      resizeTextarea();
      textareaRef.current?.focus();
    });
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const pendingPrompt = sessionStorage.getItem(PENDING_PROMPT_KEY);

        if (!pendingPrompt) return;

        sessionStorage.removeItem(PENDING_PROMPT_KEY);
        setPrompt(pendingPrompt);

        requestAnimationFrame(() => {
          resizeTextarea();
          textareaRef.current?.focus();
        });
      } catch {
        // sessionStorage unavailable.
      }
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;

    setUploadError(null);

    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setUploadError("Session expired — reload and sign in again.");
      return;
    }

    setUploading(true);

    try {
      for (const file of Array.from(list)) {
        if (attachments.length >= MAX_FILES) {
          setUploadError(`Maximum ${MAX_FILES} attachments.`);
          break;
        }

        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          setUploadError(`"${file.name}" exceeds ${MAX_FILE_MB} MB.`);
          continue;
        }

        const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);

        const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;

        const { error } = await supabase.storage.from("attachments").upload(path, file);

        if (error) {
          setUploadError(`Upload failed for "${file.name}": ${error.message}`);
          continue;
        }

        setAttachments((prev) => [
          ...prev,
          {
            path,
            name: file.name,
          },
        ]);
      }
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function removeAttachment(path: string) {
    setAttachments((prev) => prev.filter((a) => a.path !== path));

    const supabase = createClient();

    await supabase.storage.from("attachments").remove([path]);
  }

  const busy = pending || uploading;
  const error = uploadError ?? state.error;

  return (
    <div className="w-full">
      <form
        ref={formRef}
        action={formAction}
        className="w-full rounded-2xl ring-2 ring-secondary bg-white p-4 shadow-[0_1px_2px_rgb(0_0_0_/_0.04),0_8px_20px_rgb(0_0_0_/_0.05)] transition-all duration-300 focus-within:ring-foreground/15 focus-within:shadow-[0_2px_6px_rgb(0_0_0_/_0.05),0_12px_28px_rgb(0_0_0_/_0.08)]"
      >
        <textarea
          ref={textareaRef}
          name="prompt"
          required
          maxLength={20000}
          disabled={pending}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe the web app you want to build…"
          className="min-h-[40px] max-h-[300px] w-full resize-none overflow-y-auto bg-transparent px-1 pt-0.5 text-[17px] leading-relaxed outline-none placeholder:text-muted-foreground"
          style={{
            height: "40px",
          }}
        />

        <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />
        <input type="hidden" name="model" value={model} />

        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {attachments.map((a) => (
              <span
                key={a.path}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted py-1 pr-1.5 pl-2.5 text-[12px] text-secondary-foreground"
              >
                {a.name}

                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(a.path)}
                  className="rounded-md px-1 text-muted-foreground hover:bg-border hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Attach documents"
            title="Attach documents (specs, sketches, data samples)"
            className="flex size-9 items-center justify-center rounded-lg text-secondary-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {uploading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-input border-t-primary" />
            ) : (
              <PlusIcon size={16} />
            )}
          </button>

          <span className="h-6 w-px bg-border" aria-hidden />

          <ModelSelector plan={plan} value={model} onChange={setModel} disabled={busy} />

          <div className="ml-auto flex items-center gap-3">
            {error && (
              <p role="alert" className="max-w-xs text-[13px] text-red-600">
                {error}
              </p>
            )}

            {!error && prompt.trim() && !busy && (
              <span className="hidden text-[11px] font-medium text-muted-foreground sm:block">
                ↵ Enter to create
              </span>
            )}

            <button
              type="submit"
              disabled={busy || !prompt.trim()}
              aria-label="Create project"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-primary/10 transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:opacity-40"
            >
              {pending ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <ArrowUpIcon size={16} />
              )}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 px-1">
        <span className="text-[12px] font-medium text-secondary-foreground">or Try:</span>

        {STARTER_IDEAS.map((idea) => (
          <button
            key={idea.label}
            type="button"
            disabled={pending}
            onClick={() => applyIdea(idea.prompt)}
            className="rounded-xl border border-border bg-white px-3 py-1 text-[12px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground"
          >
            {idea.label}
          </button>
        ))}
      </div>
    </div>
  );
}
