import Image from "next/image";
import Link from "next/link";

/** Icon-only mark (no wordmark baked in). */
export function MeeroMark({
  size = 28,
  invert = false,
  className = "",
}: {
  size?: number;
  invert?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/meeromodern.png"
      alt="Meero"
      width={size}
      height={size}
      priority
      className={`shrink-0 object-contain transition-[filter] duration-300 ${invert ? "invert" : ""} ${className}`}
    />
  );
}

/** Full lockup — the icon mark plus a real "Meero" text wordmark, set in the
 *  app's own display font (no flattened brand image — see MeeroMark for why). */
export function MeeroWordmark({
  href = "/",
  height = 30,
  invert = false,
  className = "",
}: {
  href?: string;
  height?: number;
  invert?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 ${invert ? "invert" : ""} ${className}`}
    >
      <MeeroMark size={Math.round(height * 0.9)} />
      <span
        style={{ fontSize: height * 0.62 }}
        className="font-semibold tracking-tight text-foreground"
      >
        Meero
      </span>
    </Link>
  );
}
