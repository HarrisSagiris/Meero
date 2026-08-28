/** Minimal inline icon set (16–20px, stroke-based). */

type IconProps = { size?: number; className?: string };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3.5 8.5 10 3l6.5 5.5V16a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.5Z" />
      <path d="M8 17v-5h4v5" />
    </svg>
  );
}

export function GridIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </svg>
  );
}

export function StarIcon({
  size = 18,
  className,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size)} className={className} fill={filled ? "currentColor" : "none"} aria-hidden>
      <path d="m10 2.8 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5L2.8 8l5-.7L10 2.8Z" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M16 10H4M9.5 4.5 4 10l5.5 5.5" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M4 10h12M10.5 4.5 16 10l-5.5 5.5" />
    </svg>
  );
}

export function CubeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M10 2.3 17 6.2v7.6L10 17.7 3 13.8V6.2L10 2.3Z" />
      <path d="M3 6.2 10 10l7-3.8M10 10v7.7" />
    </svg>
  );
}

export function GlobeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M2.8 10h14.4M10 2.8c2 2 3 4.4 3 7.2s-1 5.2-3 7.2c-2-2-3-4.4-3-7.2s1-5.2 3-7.2Z" />
    </svg>
  );
}

export function RocketIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M11.5 12.5 7.5 8.5c1.6-3.2 4.4-5.6 8.3-6.3.5-.1 1 .4.9.9-.7 3.9-3.1 6.7-6.3 8.3l1.1 1.1Z" />
      <path d="M7.5 8.5H5L3 11l3 .5" />
      <path d="M11.5 12.5V15l-2.5 2-.5-3" />
      <path d="M6 14c-1 .5-1.7 1.5-2 3 1.5-.3 2.5-1 3-2" />
      <circle cx="12.2" cy="7.8" r="1" />
    </svg>
  );
}

export function ShieldIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M10 2.5 4 4.8v4.4c0 4 2.5 6.6 6 8.3 3.5-1.7 6-4.3 6-8.3V4.8L10 2.5Z" />
      <path d="m7.2 9.8 2 2 3.6-4" />
    </svg>
  );
}

export function SparkleIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M10 3v3.2M10 13.8V17M3 10h3.2M13.8 10H17" />
      <path d="m5.6 5.6 2 2M12.4 12.4l2 2M14.4 5.6l-2 2M7.6 12.4l-2 2" />
    </svg>
  );
}

export function PullRequestIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="5.5" cy="5" r="1.9" />
      <circle cx="5.5" cy="15" r="1.9" />
      <circle cx="14.5" cy="15" r="1.9" />
      <path d="M5.5 6.9v6.2" />
      <path d="M10.5 3h2a2 2 0 0 1 2 2v8.1" />
      <path d="m12.3 4.8-1.8-1.8 1.8-1.8" />
    </svg>
  );
}

export function SupabaseIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M11.9 18.3c-.4.5-1.3.2-1.3-.5v-6.3H4.3c-.9 0-1.4-1-.8-1.7L8.1 1.7c.4-.5 1.3-.2 1.3.5v6.3h6.3c.9 0 1.4 1 .8 1.7l-4.6 8.1Z" />
    </svg>
  );
}

export function VercelIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 76 65"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 3.5h4.5V8" />
      <path d="M16.5 3.5 9 11" />
      <path d="M16 12v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H8" />
    </svg>
  );
}

export function LockIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
      <path d="M7 8.5V6.5a3 3 0 0 1 6 0v2" />
      <path d="M10 11.5v2" />
    </svg>
  );
}

export function LinkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M8.6 11.4a3 3 0 0 0 4.5.3l2-2a3 3 0 0 0-4.3-4.2l-1.1 1.1" />
      <path d="M11.4 8.6a3 3 0 0 0-4.5-.3l-2 2a3 3 0 0 0 4.3 4.2l1.1-1.1" />
    </svg>
  );
}

export function ExpandIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M7.5 3H3v4.5M12.5 3H17v4.5M7.5 17H3v-4.5M12.5 17H17v-4.5" />
    </svg>
  );
}

export function CodeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m7 6-4 4 4 4" />
      <path d="m13 6 4 4-4 4" />
    </svg>
  );
}

export function RefreshIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M16 8.5a6 6 0 1 0-1.5 5.7" />
      <path d="M16 4v4.5h-4.5" />
    </svg>
  );
}

export function TabsIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="3" y="3" width="10" height="7" rx="1.5" />
      <rect x="7" y="10" width="10" height="7" rx="1.5" />
    </svg>
  );
}

/** Official GitHub mark (Simple Icons, MIT-licensed), verbatim path data. */
export function GithubIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** Official Slack mark — the real 4-color "hashtag", not a monochrome
 *  stand-in (unlike Github/Notion above, a single-color Slack mark reads
 *  as barely recognizable, so this one keeps its real brand colors
 *  regardless of surrounding text color). Path data from Wikimedia
 *  Commons' official asset (upload.wikimedia.org/.../Slack_icon_2019.svg). */
export function SlackIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 127 127" className={className} aria-hidden>
      <path
        d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
        fill="#E01E5A"
      />
      <path
        d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
        fill="#36C5F0"
      />
      <path
        d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
        fill="#2EB67D"
      />
      <path
        d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
        fill="#ECB22E"
      />
    </svg>
  );
}

/** Official Notion mark — the real two-tone card+"N" glyph (white tile,
 *  black wordmark), path data from Wikimedia Commons' official asset
 *  (upload.wikimedia.org/.../Notion-logo.svg). Kept at its true colors
 *  rather than currentColor, same reasoning as Slack above. */
export function NotionIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <path
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
        fill="#fff"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
        fill="#000"
      />
    </svg>
  );
}

/** Official Claude mark (Simple Icons, CC0-licensed), verbatim path data —
 *  rendered in Claude's real brand color (#D97757, per Simple Icons' brand
 *  metadata), not currentColor, since a monochrome version reads as barely
 *  recognizable (same reasoning SlackIcon above uses for its real colors). */
export function ClaudeIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#D97757"
      className={className}
      aria-hidden
    >
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

/** Official OpenAI mark ("the flower"), verbatim path data from a Simple
 *  Icons release — no longer published in that project's current icon set
 *  (removed at OpenAI's request), but this is the same real, unaltered
 *  brand mark. Kept on currentColor/black on purpose: OpenAI's own brand
 *  guidelines restrict this mark to black or white only, unlike Claude's
 *  real accent color above — there's no "official" colored variant to use
 *  here (owner decision, 2026-08-19). */
export function OpenAIIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z" />
    </svg>
  );
}

export function SettingsIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.7v2.1m0 10.4v2.1m7.3-7.3h-2.1M4.8 10H2.7m11.8-5.1-1.5 1.5M6.9 13.1l-1.5 1.5m9-1.5 1.5 1.5M6.9 6.9 5.4 5.4" />
    </svg>
  );
}

export function CreditIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M10 2.5 3.5 6v8L10 17.5 16.5 14V6L10 2.5Z" />
      <path d="M10 9.5 3.7 6.1M10 9.5 16.3 6.1M10 9.5v8" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

export function LogOutIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M7.5 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3" />
      <path d="M13 14.2 17.2 10 13 5.8M17 10H7.5" />
    </svg>
  );
}

export function UsersIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="7.5" cy="7" r="2.8" />
      <path d="M2.5 16.5c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5" />
      <path d="M13 5.3c1.4.3 2.5 1.5 2.5 3S14.4 10.9 13 11.2" />
      <path d="M16 12.2c1.5.5 2.5 1.8 2.5 3.3" />
    </svg>
  );
}

export function HistoryIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
      <path d="M3.5 3.5v3.3h3.3" />
      <path d="M10 6.5V10l2.5 1.5" />
    </svg>
  );
}

export function BarChartIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M4 16.5v-4" />
      <path d="M9.5 16.5v-9" />
      <path d="M15 16.5v-6" />
      <path d="M2.5 16.5h15" />
    </svg>
  );
}

export function TrendingUpIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3 13.5 8 8.5l3 3 6-6.5" />
      <path d="M13.5 5h3.5v3.5" />
    </svg>
  );
}

export function CursorClickIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M6.5 3.5 7 15l2.7-2.6 1.7 3.7 1.9-.9-1.7-3.7 3.7-.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function FormIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="3.5" y="3" width="13" height="14" rx="1.5" />
      <path d="M6.5 7h7" />
      <path d="M6.5 10h7" />
      <path d="M6.5 13h4" />
    </svg>
  );
}

export function FunnelIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3 4h14l-5.5 6.5v5L8.5 17v-6.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function TargetIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="3" />
      <circle cx="10" cy="10" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function FlaskIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M8 3h4" />
      <path
        d="M9 3v5.5L4.8 15a1.5 1.5 0 0 0 1.3 2.3h7.8a1.5 1.5 0 0 0 1.3-2.3L11 8.5V3"
        strokeLinejoin="round"
      />
      <path d="M6.2 12.5h7.6" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m4 10.5 4 4 8-9" />
    </svg>
  );
}

export function PencilIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12.5 3.5a1.5 1.5 0 0 1 2 2L6 14l-3 1 1-3Z" />
      <path d="M11 5 15 9" />
    </svg>
  );
}

export function TrashIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M4 6h12" />
      <path d="M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
      <path d="M5.5 6.5 6 16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-9.5" />
      <path d="M8.3 9.3v5" />
      <path d="M11.7 9.3v5" />
    </svg>
  );
}
