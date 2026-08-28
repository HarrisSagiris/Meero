import Link from "next/link";
import { AutonomousMonitoring } from "@/modules/landing/views/ui/autonomous-monitoring";
import { ConversionOptimization } from "@/modules/landing/views/ui/conversion-optimization";
import { HeroVideo } from "@/modules/landing/views/ui/hero-video";
import { HowItWorks } from "@/modules/landing/views/ui/how-it-works";
import { LandingComposer } from "@/modules/landing/views/ui/landing-composer";
import { LandingNav } from "@/modules/landing/views/ui/landing-nav";
import { ArrowRightIcon } from "@/components/icons";
import { MeeroMark } from "@/components/logo";
import { PublicGallery, type PublicProject } from "@/modules/landing/views/ui/public-gallery";
import { NewsBar } from "@/modules/news/views/ui/news-bar";
import { ScrollReveal } from "@/components/scroll-reveal";
import { StatusPill } from "@/components/status-pill";

/**
 * Public marketing landing shown to logged-out visitors — a full-bleed
 * video hero (the Golden Gate Bridge at sunset), a composer that's usable
 * right away, how it works, a gallery of real public projects, one closing
 * line. The hero carries the atmosphere; everything below it stays quiet
 * and white so the product does the talking.
 */
export function Landing({ publicProjects }: { publicProjects: PublicProject[] }) {
  return (
    <div className="relative min-h-screen bg-white">
      <NewsBar />

      <main className="relative">
        {/* Hero — full-bleed video */}
        <section className="relative isolate flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4 pt-10 pb-20 text-center sm:px-6">
          <HeroVideo />
          <div className="meero-hero-video-overlay absolute inset-0" aria-hidden />
          <LandingNav />

          <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center px-2">
            <h1 className="animate-rise rise-1 mt-7 whitespace-nowrap text-center font-sans text-[clamp(36px,9vw,84px)] font-semibold leading-[1.05] tracking-[-0.02em] text-white [text-shadow:0_2px_24px_rgb(0_0_0_/_0.35)]">
              Launch. Run. <span className="text-primary">Grow.</span>
            </h1>

            <p className="animate-rise rise-2 mt-5 max-w-md text-center text-[17px] leading-relaxed text-white/85">
              Turn a prompt into a real web app that keeps running, fixing itself, and improving
              after launch.
            </p>

            <div className="animate-rise rise-3 mt-11 w-full">
              <LandingComposer />
            </div>

            <p className="animate-rise rise-4 mt-6 text-[12.5px] text-white/70">
              Free to start — no credit card
            </p>
          </div>
        </section>

        <div className="relative px-4 sm:px-6">
          {/* How it works */}
          <HowItWorks />

          {/* The headline differentiator — Meero keeps watching after it
              ships, not just another "describe → build → ship" builder. */}
          <AutonomousMonitoring />

          {/* The hero's third promise ("...and improving after launch") —
              the real conversion-optimization agent, completing the story
              AutonomousMonitoring starts (fixing errors) with the growth
              half (fixing friction). */}
          <ConversionOptimization />

          {/* What people have actually built */}
          {publicProjects.length > 0 && (
            <ScrollReveal>
              <section className="mx-auto max-w-5xl px-2 pt-28 pb-32">
                <h2 className="text-center font-sans text-[28px] font-semibold tracking-[-0.02em] text-foreground sm:text-[36px]">
                  Proudly built using Meero
                  <span className="text-primary">.</span>
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-center text-[14px] text-secondary-foreground">
                  Real apps, real databases — shipped by people describing what they wanted.
                </p>
                <div className="mt-10">
                  <PublicGallery projects={publicProjects} />
                </div>
              </section>
            </ScrollReveal>
          )}

          {/* Closing line — plain white, nothing but type and one button.
              The product carries the page; this is just a quiet last word. */}
          <section className="mx-auto max-w-xl px-2 pb-32 text-center">
            <ScrollReveal>
              <h2 className="font-sans text-[40px] font-semibold tracking-[-0.02em] text-foreground sm:text-[52px]">
                Ready when you are
                <span className="text-primary">.</span>
              </h2>
              <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-secondary-foreground">
                Free to start. No credit card. Just describe it.
              </p>
              <div className="mt-8 flex items-center justify-center gap-2">
                <Link
                  href="/signup"
                  className="group/cta inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-3 text-[14px] font-medium text-white shadow-primary/10 transition hover:bg-primary/85"
                >
                  Start building
                  <ArrowRightIcon
                    size={14}
                    className="transition-transform duration-300 group-hover/cta:translate-x-0.5"
                  />
                </Link>
                <Link
                  href="/login"
                  className="rounded-full px-6 py-3 text-[14px] font-medium text-secondary-foreground transition hover:text-foreground"
                >
                  Log in
                </Link>
              </div>
            </ScrollReveal>
          </section>
        </div>
      </main>

      <footer className="relative px-6 pt-4 pb-16">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-8 text-center">
          <Link
            href="/"
            aria-label="Meero"
            className="flex items-center gap-2 transition hover:opacity-80"
          >
            <MeeroMark size={22} />
            <span className="text-[15px] font-medium text-foreground">Meero</span>
          </Link>

          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-secondary-foreground">
            <Link href="/news" className="transition hover:text-foreground">
              News
            </Link>
            <Link href="/login" className="transition hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className="transition hover:text-foreground">
              Sign up
            </Link>
            <a
              href="https://discord.gg/KBBKQQXrTA"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-foreground"
            >
              Discord
            </a>
          </div>

          <StatusPill />

          <a
            href="https://www.producthunt.com/products/meero?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-meero"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-60 transition hover:opacity-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- external Product Hunt badge, not a local/optimizable asset */}
            <img
              alt="Meero - Launch full stack web apps in minutes. | Product Hunt"
              width={200}
              height={44}
              src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1208258&theme=light&t=1785276236816"
            />
          </a>
        </div>
      </footer>
    </div>
  );
}
