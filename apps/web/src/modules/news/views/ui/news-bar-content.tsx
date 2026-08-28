"use client";

import Link from "next/link";
import { ArrowUpIcon } from "@/components/icons";

/**
 * Client half of the announcement bar — NewsBar (server component) fetches
 * the latest post, this renders it. Set in bold sans, same as the hero
 * title.
 */
export function NewsBarContent({ title }: { title: string }) {
  return (
    <Link
      href="/news"
      className="group flex min-h-10 w-full items-center justify-center gap-2 bg-primary px-4 py-2 text-center font-sans text-[17px] font-medium text-white transition hover:bg-primary/85"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-semibold">Latest news:</span>
        <span className="truncate">{title}</span>
        <ArrowUpIcon
          size={12}
          className="rotate-90 shrink-0 transition group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
