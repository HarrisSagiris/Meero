"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MeeroMark } from "@/components/logo";
import { PENDING_PROMPT_KEY } from "@/modules/landing/views/ui/landing-composer";
import { STARTER_IDEAS } from "@/modules/landing/utils/starter-ideas";
import { RESOURCES } from "@/modules/marketing/utils/resources";
import { PLAN_CARDS, PLAN_LABEL } from "@/modules/billing/utils/plans";
import { ExternalLinkIcon } from "@/components/icons";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

const TRIGGER_CLASS =
  "h-auto rounded-full bg-transparent px-3 py-2 font-sans text-[13.5px] font-medium text-secondary-foreground hover:bg-transparent hover:text-foreground focus:bg-transparent data-open:bg-transparent data-popup-open:bg-transparent data-popup-open:text-foreground";

const LINK_CLASS =
  "flex items-center rounded-full px-3 py-2 font-sans text-[13.5px] font-medium text-secondary-foreground transition-colors hover:bg-transparent hover:text-foreground";

const MENU_LINK_CLASS = "flex-col items-start gap-0.5 text-left";

/** Every entry here points at a route that actually exists. Community and
 *  Careers each lead to exactly one page with nothing further to preview —
 *  a dropdown there would just repeat the label — so only Templates,
 *  Resources, and Pricing (which each have real, distinct sub-content) get
 *  one. Enterprise stays a plain link for the same reason.
 *
 *  `showPricing` is off on the signed-in home's TopNav — a logged-in user
 *  already has a plan (and an Upgrade path in the sidebar), so the Pricing
 *  dropdown there is just noise. */
export function MarketingNavLinks({
  className = "",
  showPricing = true,
}: {
  className?: string;
  showPricing?: boolean;
}) {
  const router = useRouter();

  function applyTemplate(prompt: string) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
    } catch {
      // sessionStorage unavailable — still navigate; the composer's own
      // starter chips cover the same ideas.
    }
    router.push("/");
  }

  return (
    <NavigationMenu className={`hidden font-sans lg:flex ${className}`}>
      <NavigationMenuList className="gap-1">
        <NavigationMenuItem>
          <NavigationMenuLink render={<Link href="/community" />} className={LINK_CLASS}>
            Community
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink render={<Link href="/enterprise" />} className={LINK_CLASS}>
            Enterprise
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger className={TRIGGER_CLASS}>Templates</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-72 gap-0.5 p-1">
              {STARTER_IDEAS.map((idea) => {
                const [headline] = idea.prompt.split("\n").filter(Boolean);
                return (
                  <li key={idea.label}>
                    <NavigationMenuLink
                      render={<button type="button" onClick={() => applyTemplate(idea.prompt)} />}
                      className={`${MENU_LINK_CLASS} w-full`}
                    >
                      <span className="font-sans text-[13.5px] font-medium text-foreground">
                        {idea.label}
                      </span>
                      <span className="line-clamp-1 font-sans text-[12.5px] leading-snug text-muted-foreground">
                        {headline}
                      </span>
                    </NavigationMenuLink>
                  </li>
                );
              })}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger className={TRIGGER_CLASS}>Resources</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-[26rem] grid-cols-2 gap-0.5 p-1">
              {RESOURCES.map((item) => (
                <li key={item.href}>
                  <NavigationMenuLink
                    render={
                      item.external ? (
                        <a href={item.href} target="_blank" rel="noreferrer" />
                      ) : (
                        <Link href={item.href} />
                      )
                    }
                    className={MENU_LINK_CLASS}
                  >
                    <span className="flex items-center gap-1 font-sans text-[13px] font-medium text-foreground">
                      {item.title}
                      {item.external && (
                        <ExternalLinkIcon size={11} className="text-muted-foreground" />
                      )}
                    </span>
                    <span className="line-clamp-2 font-sans text-[12.5px] leading-snug text-muted-foreground">
                      {item.body}
                    </span>
                  </NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink render={<Link href="/careers" />} className={LINK_CLASS}>
            Careers
          </NavigationMenuLink>
        </NavigationMenuItem>

        {showPricing && (
          <NavigationMenuItem>
            <NavigationMenuTrigger className={TRIGGER_CLASS}>Pricing</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid w-56 gap-0.5 p-1">
                {PLAN_CARDS.map((card) => (
                  <li key={card.plan}>
                    <NavigationMenuLink
                      render={<Link href="/pricing" />}
                      className="items-baseline justify-between gap-2"
                    >
                      <span className="font-sans text-[13.5px] font-medium text-foreground">
                        {PLAN_LABEL[card.plan]}
                      </span>
                      <span className="font-sans text-[12px] text-muted-foreground">
                        {card.price}
                        {card.period}
                      </span>
                    </NavigationMenuLink>
                  </li>
                ))}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
        )}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

/** Standalone header for the marketing pages themselves (the signed-in home
 *  composes MarketingNavLinks into its own TopNav instead, so it keeps the
 *  sidebar trigger and account menu). */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="Meero" className="flex shrink-0 items-center gap-2.5">
          <MeeroMark size={30} />
          <span className="text-[18px] font-semibold tracking-tight text-foreground">Meero</span>
        </Link>

        <MarketingNavLinks />

        <div className="flex items-center gap-1">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-[13.5px] font-medium text-secondary-foreground transition-colors hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-primary px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
