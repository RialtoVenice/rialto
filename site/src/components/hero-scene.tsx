import { useEffect, useState } from "react";

/**
 * Full-bleed animated bridge across the top of the page. The artwork keeps its diorama right of centre, so the
 * media is scaled up and shifted left to put the bridge in the middle of the viewport. Server renders the poster;
 * the loop video mounts on the client only when the visitor has not asked for reduced motion.
 */
const MEDIA_CLASS = "absolute inset-0 h-full w-full object-cover object-[50%_0%]";
const MEDIA_STYLE = { transform: "scale(1.18) translate(-7%, -6%)", transformOrigin: "50% 0%" } as const;

export function HeroScene() {
  const [playVideo, setPlayVideo] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!mq.matches) setPlayVideo(true);
    const onChange = () => setPlayVideo(!mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <div className="relative w-full overflow-hidden bg-[#F6EEDD]" style={{ height: "clamp(320px, min(88vh, 54vw), 1000px)" }} aria-hidden="true">
      <img
        src="/assets/hero-bridge.jpg"
        srcSet="/assets/hero-bridge-m.jpg 1200w, /assets/hero-bridge.jpg 1800w"
        sizes="100vw"
        alt=""
        className={MEDIA_CLASS}
        style={MEDIA_STYLE}
        fetchPriority="high"
      />
      {playVideo && (
        <video
          className={MEDIA_CLASS}
          style={MEDIA_STYLE}
          src="/assets/hero-loop-v2.mp4"
          poster="/assets/hero-bridge.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-paper" />
    </div>
  );
}
