"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";

/** A subtle nudge to scroll down for more — fades out the moment the user
 *  actually starts scrolling, so it never lingers once they've gotten the
 *  hint (or gets in the way of anything below it). */
export function ScrollHint({ label }: { label: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY < 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none flex flex-col items-center gap-1 text-muted-foreground transition-opacity duration-500 motion-reduce:hidden ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="text-[11.5px] font-medium">{label}</span>
      <ChevronDownIcon size={13} />
    </div>
  );
}
