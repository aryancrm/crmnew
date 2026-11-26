// The departments launcher on a department's sign-in page (Aryan, 24 Nov), in place of the
// "All departments" pill: a grid button like Google's apps menu, but of softly rounded squares in
// one gradient (orange to yellow), opening every department's sign-in in a panel.

import { useEffect, useId, useRef, useState } from "react";
import { heroLogo } from "../portal/hero-logos";
import { WORKSPACES } from "../workspaces";

const GRADIENT = "linear-gradient(135deg, #ff5a00 0%, #ff8a00 50%, #ffd400 100%)";
const DOT = 7; // each square, px
const STEP = 10; // square plus gap, px
const SIDE = DOT + STEP * 2; // the whole grid, px

/** The 3×3 grid: one gradient running across all nine squares. */
function GridMark() {
  return (
    <span aria-hidden="true" className="grid grid-cols-3 gap-[3px]" style={{ width: SIDE, height: SIDE }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid
          key={i}
          className="rounded-[2px]"
          style={{
            width: DOT,
            height: DOT,
            backgroundImage: GRADIENT,
            backgroundSize: `${SIDE}px ${SIDE}px`,
            backgroundPosition: `${-(i % 3) * STEP}px ${-Math.floor(i / 3) * STEP}px`,
          }}
        />
      ))}
    </span>
  );
}

export function DepartmentsMenu(props: { current: string; onPick: (key: string | null) => void }) {
  const [openMenu, setOpenMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // A press outside closes it.
  useEffect(() => {
    if (!openMenu) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpenMenu(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [openMenu]);

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(event) => {
        // Escape closes the menu only (on the page, Escape otherwise goes back to all departments).
        if (event.key === "Escape" && openMenu) {
          event.stopPropagation();
          setOpenMenu(false);
        }
      }}
    >
      <button
        type="button"
        aria-label="All departments"
        title="All departments"
        aria-expanded={openMenu}
        aria-controls={panelId}
        onClick={() => setOpenMenu((now) => !now)}
        className={`grid size-12 place-items-center rounded-xl transition-colors hover:bg-[#f1f3f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21] ${openMenu ? "bg-[#f1f3f6]" : ""}`}
      >
        <GridMark />
      </button>

      {openMenu && (
        <div
          id={panelId}
          className="absolute top-[calc(100%+8px)] right-0 z-30 origin-top-right animate-[launcher-in_260ms_cubic-bezier(.2,.8,.2,1)_both] motion-reduce:animate-none w-[min(296px,calc(100vw-32px))] rounded-2xl border border-[#eceef3] bg-white p-2.5 shadow-[0_24px_60px_-20px_rgba(31,39,51,0.35)]"
        >
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-[#7a8394]">All departments</p>
          <ul className="grid max-h-[min(480px,72vh)] grid-cols-3 gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {WORKSPACES.map((one, i) => (
              <li
                key={one.key}
                className="animate-[launcher-item-in_380ms_cubic-bezier(.2,.8,.2,1)_both] motion-reduce:animate-none"
                style={{ animationDelay: `${120 + i * 45}ms` }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(false);
                    props.onPick(one.key);
                  }}
                  aria-current={one.key === props.current ? "page" : undefined}
                  className={`flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition-colors hover:bg-[#f4f5f7] ${one.key === props.current ? "bg-[#fff7f2]" : ""}`}
                >
                  <img src={heroLogo(one.key)} alt="" width={26} height={26} className="size-[26px] object-contain" />
                  <span className="text-[11px] leading-tight text-[#3c4452]">{one.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpenMenu(false);
              props.onPick(null);
            }}
            className="mt-2 w-full rounded-xl border-t border-[#f0f1f4] px-2 pt-2.5 pb-1 text-[12px] font-medium text-[#5b6472] transition-colors hover:text-[#c2410c]"
          >
            Back to the home page
          </button>
        </div>
      )}
    </div>
  );
}
