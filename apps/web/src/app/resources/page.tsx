import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/modules/marketing/views/ui/marketing-nav";
import { RESOURCES } from "@/modules/marketing/utils/resources";
import { ExternalLinkIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Everything around Meero — product news, live service status, starting templates, and apps the community has shared.",
};

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-16 sm:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-serif text-[clamp(36px,5.5vw,52px)] leading-[1.05] tracking-[-0.01em] text-foreground">
            Resources
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
            Everything around the product — what&apos;s shipping, whether it&apos;s up right now,
            and where to start.
          </p>
        </header>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map((item) => {
            const inner = (
              <>
                <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
                  {item.title}
                  {item.external && (
                    <ExternalLinkIcon size={13} className="text-muted-foreground" />
                  )}
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">
                  {item.body}
                </p>
              </>
            );

            const className =
              "block rounded-xl border border-border bg-white p-5 transition hover:border-primary/40 hover:shadow-primary/10";

            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className={className}
              >
                {inner}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={className}>
                {inner}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
