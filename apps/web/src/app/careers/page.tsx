import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/modules/marketing/views/ui/marketing-nav";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Meero is an independent, bootstrapped product. There are no open roles right now — but if you want to be considered when that changes, get in touch.",
};

/** Deliberately states the true hiring position rather than listing
 *  invented openings: Meero is currently built by its founder, with no
 *  funded headcount to hire against. If that changes, add real roles here —
 *  don't add placeholder ones. */
export default function CareersPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-16 sm:px-8">
        <header className="text-center">
          <h1 className="font-serif text-[clamp(36px,5.5vw,52px)] leading-[1.05] tracking-[-0.01em] text-foreground">
            Careers
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
            Meero is an independent, bootstrapped product — built and run by its founder, without
            outside funding.
          </p>
        </header>

        <div className="mt-12 rounded-2xl border border-border bg-white p-8 shadow-primary/10">
          <h2 className="text-[17px] font-semibold text-foreground">No open roles right now</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-secondary-foreground">
            That&apos;s the honest answer — there&apos;s no team to join yet, and we&apos;d rather
            say so than keep a page of openings that don&apos;t exist. When Meero is ready to bring
            people on, real roles will be posted here first and announced in the news feed.
          </p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link
              href="/news"
              className="rounded-full border border-border px-4 py-2 text-[13.5px] font-medium text-foreground transition hover:bg-muted"
            >
              Follow along in News
            </Link>
            <a
              href="mailto:careers@meero.im"
              className="rounded-full bg-primary px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
            >
              Introduce yourself
            </a>
          </div>
        </div>

        <section className="mt-10 rounded-2xl border border-border bg-muted/40 p-8">
          <h2 className="text-[17px] font-semibold text-foreground">
            What we&apos;d care about when the time comes
          </h2>
          <ul className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-secondary-foreground">
            <li>
              <span className="font-medium text-foreground">Taste in what real means.</span> Meero
              has a hard rule against mocked or simulated pipeline stages — every build applies a
              real schema to a real database and runs a real compile. That standard is the product.
            </li>
            <li>
              <span className="font-medium text-foreground">Security as a default.</span> Generated
              apps are validated mechanically: no injection sinks, no raw network calls, and every
              table must enable row-level security before a byte reaches anyone&apos;s database.
            </li>
            <li>
              <span className="font-medium text-foreground">Comfort owning a whole slice.</span> A
              small team means shipping end to end — the model prompt, the worker, the migration,
              and the UI that exposes it.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
