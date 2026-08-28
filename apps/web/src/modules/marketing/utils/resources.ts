/** Deliberately only lists destinations that genuinely exist today: the real
 *  /news route, the real external OpenStatus page the StatusPill already
 *  polls, and the other marketing routes. No "docs coming soon" tiles.
 *  Shared between the /resources page and the top nav's Resources dropdown
 *  so the two can never list different things. */
export type ResourceItem = {
  title: string;
  body: string;
  href: string;
  external?: boolean;
};

export const RESOURCES: ResourceItem[] = [
  {
    title: "News",
    body: "Release notes and product updates — what shipped, when, and why it matters.",
    href: "/news",
  },
  {
    title: "Status",
    body: "Live uptime and incident history for the Meero app, API, and build workers.",
    href: "https://meero.openstatus.dev",
    external: true,
  },
  {
    title: "Templates",
    body: "Detailed starting specs for common app shapes — start from one and change anything.",
    href: "/templates",
  },
  {
    title: "Community",
    body: "Real apps people built with Meero and shared publicly. Clone any of them into your own account.",
    href: "/community",
  },
  {
    title: "Pricing",
    body: "What each plan includes, how weekly token budgets work, and when they refresh.",
    href: "/pricing",
  },
  {
    title: "For teams",
    body: "How collaborators, private projects, and custom domains work when more than one person is building.",
    href: "/enterprise",
  },
];
