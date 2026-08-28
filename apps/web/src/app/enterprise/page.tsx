import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/modules/marketing/views/ui/marketing-nav";
import {
  UsersIcon,
  LockIcon,
  GlobeIcon,
  SupabaseIcon,
  GithubIcon,
  ShieldIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "For teams",
  description:
    "How Meero works when more than one person is building: real collaborators, private projects, custom domains, and apps that run entirely on your own Supabase and GitHub.",
};

/** Every capability listed here is one that actually ships today
 *  (collaborators, private projects, custom domains, own-Supabase data
 *  ownership, GitHub commits, RLS enforcement). Deliberately makes NO claim
 *  about SSO/SAML, SOC 2, contractual SLAs, or dedicated support — none of
 *  those exist yet, and a team-plan page is exactly where an invented one
 *  would do real damage. */
const CAPABILITIES = [
  {
    Icon: UsersIcon,
    title: "Real collaborators",
    body: "Add teammates by email and they get genuine working access to a project — chat, builds, fixes, and live status. Account-level actions (billing, deploys, connections) stay with the owner, and every collaborator's build bills to the owner's plan, so it works like a team seat rather than a way to spend someone else's budget.",
  },
  {
    Icon: LockIcon,
    title: "Private projects",
    body: "On Pro and Ultra, projects are private by default with a normal visibility toggle. (On the free plan every project is public on the Marketplace — that's enforced at the database level, so it's worth knowing before you put internal work in.)",
  },
  {
    Icon: GlobeIcon,
    title: "Your own domain",
    body: "Attach a custom domain to a released app. Verification reflects your DNS provider's real state — Meero polls the live status rather than assuming it worked.",
  },
  {
    Icon: SupabaseIcon,
    title: "Your data stays yours",
    body: "Every generated app's backend is a Supabase project on your own account — real Postgres, real auth, real row-level security. If you stop using Meero tomorrow, the database and its data are still yours, untouched.",
  },
  {
    Icon: GithubIcon,
    title: "Everything lands in your repo",
    body: "Connect GitHub and Meero creates the repository, then commits every successful build straight to main as a real commit. You keep a full, readable history of what changed — and you can walk away with the source at any point.",
  },
  {
    Icon: ShieldIcon,
    title: "Security enforced mechanically",
    body: "Generated code can't ship an XSS sink or a raw network call — validation fails the build before it reaches your database. Every table a generated app creates must enable row-level security with a real policy.",
  },
];

export default function EnterprisePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-16 sm:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-serif text-[clamp(36px,5.5vw,52px)] leading-[1.05] tracking-[-0.01em] text-foreground">
            Meero for teams
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
            The same product, with the pieces that matter once more than one person depends on what
            you ship — shared access, privacy, your own domain, and infrastructure you actually own.
          </p>
        </header>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-white p-5">
              <Icon size={20} className="text-primary" />
              <h2 className="mt-3 text-[14.5px] font-semibold text-foreground">{title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">{body}</p>
            </div>
          ))}
        </div>

        <section className="mt-16 rounded-2xl border border-border bg-muted/40 p-8 sm:p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
            What we don&apos;t offer yet
          </h2>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-secondary-foreground">
            Meero is an independent product, and it&apos;s worth being straight about the gaps:
            there&apos;s no SSO/SAML, no compliance certification, and no contractual uptime
            guarantee today. Live service status is published openly at{" "}
            <a
              href="https://meero.openstatus.dev"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              meero.openstatus.dev
            </a>
            . If one of those is a hard requirement for your team, tell us — it&apos;s the most
            useful thing you can do to get it prioritized.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <a
              href="mailto:hello@meero.im"
              className="rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
            >
              Talk to us
            </a>
            <Link
              href="/pricing"
              className="rounded-full border border-border bg-white px-5 py-2.5 text-[13.5px] font-medium text-foreground transition hover:bg-muted"
            >
              See pricing
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
