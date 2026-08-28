import Link from "next/link";
import { MeeroMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

/** Top bar for logged-out visitors — an absolutely-positioned overlay on
 *  top of the hero video, always transparent. Positioned absolute (not
 *  sticky) so it never reserves layout space of its own — a sticky header
 *  still sits in normal document flow at its natural position, and with a
 *  transparent background that flow space just showed the page's white
 *  background as a bar above the video. Rendered inside the hero <section>
 *  by Landing so it overlaps the video rather than pushing it down. */
export function LandingNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="Meero" className="flex shrink-0 items-center gap-2.5">
          <MeeroMark size={34} />
          <span className="text-[19px] font-semibold tracking-tight text-white">Meero</span>
        </Link>

        <div className="flex items-center gap-1">
          <Button variant="secondary" size="lg" render={<Link href="/login" />}>
            Login
          </Button>
          <Button size="lg" render={<Link href="/signup" />}>
            Sign Up <LogIn />
          </Button>
        </div>
      </div>
    </header>
  );
}
