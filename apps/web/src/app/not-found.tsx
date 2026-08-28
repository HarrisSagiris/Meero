import Link from "next/link";

export default function NotFound() {
  return (
    <main className="meero-gradient-soft flex min-h-screen flex-col items-center justify-center px-6">
      <div className="rounded-2xl border border-border bg-white/95 px-10 py-12 text-center shadow-composer backdrop-blur-md">
        <p className="text-[13px] font-medium tracking-wider text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-secondary-foreground">
          The project may have been deleted, or the link is wrong.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-foreground px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-neutral-800"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
