"use client";

import { useEffect, useRef } from "react";

/**
 * Full-bleed hero background video (public/videos/landing.mp4). autoPlay is
 * set natively (not just imperatively) since relying on a JS-triggered
 * .play() alone left it stuck on the poster frame in some browsers — we
 * also kick an imperative .play() on mount/canplay as a belt-and-suspenders
 * fallback for browsers that ignore the native attribute post-hydration.
 * prefers-reduced-motion visitors get the static first frame instead —
 * paused right after mount.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      video.pause();
      return;
    }

    const play = () => video.play().catch(() => {});
    play();
    video.addEventListener("canplay", play);
    return () => video.removeEventListener("canplay", play);
  }, []);

  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-cover"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    >
      <source src="/videos/landing.mp4" type="video/mp4" />
    </video>
  );
}
