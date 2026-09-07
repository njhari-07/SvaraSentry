import { useState, useEffect } from "react";

const SECTIONS = [
  { id: "hero", label: "Hero" },
  { id: "showcase", label: "Showcase" },
  { id: "focus", label: "Focus" },
  { id: "tension", label: "Idea" },
  { id: "reveal", label: "Physics" },
  { id: "spec", label: "Specs" },
  { id: "glass", label: "Glass" },
  { id: "direct", label: "Engine" },
  { id: "embed", label: "Embed" },
  { id: "touch", label: "Touch" },
  { id: "manifesto", label: "Manifesto" },
  { id: "cta", label: "Defend" },
];

export default function SideIndex() {
  const [activeId, setActiveId] = useState("hero");

  useEffect(() => {
    const handleScroll = () => {
      const center = window.innerHeight / 2;
      let current = "hero";
      let minDistance = Infinity;

      SECTIONS.forEach((s) => {
        const el = document.getElementById(s.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top + rect.height / 2 - center);
          if (rect.top < center && rect.bottom > center) {
            if (dist < minDistance) {
              minDistance = dist;
              current = s.id;
            }
          }
        }
      });

      setActiveId(current);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="fixed right-6 sm:right-10 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col gap-3 items-end">
      {SECTIONS.map((s) => {
        const isActive = activeId === s.id;
        return (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className="group flex items-center gap-2 cursor-pointer focus:outline-none"
            aria-label={`Scroll to ${s.label}`}
          >
            <span
              className={`font-mono text-[10px] uppercase tracking-widest transition-all duration-300 ${
                isActive
                  ? "opacity-100 text-white translate-x-0"
                  : "opacity-0 text-neutral-400 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0"
              }`}
            >
              {s.label}
            </span>
            <span
              className={`h-[1px] transition-all duration-300 ${
                isActive ? "w-8 bg-white" : "w-4 bg-white/30 group-hover:w-6 group-hover:bg-white/70"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
