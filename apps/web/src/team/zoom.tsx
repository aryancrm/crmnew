// A frame to look around a big chart: zoom in and out (buttons, or the wheel with Ctrl / ⌘), drag
// to move, Fit to see all of it, 100% for its own size. Links inside still open on a click (a drag
// doesn't count as a click).

import { Maximize2, Minus, Plus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

const MIN = 0.25;
const MAX = 1.75;

export function ZoomBox({ children, height = 520 }: { children: ReactNode; height?: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const fit = useCallback(() => {
    const box = frame.current;
    const content = inner.current;
    if (!box || !content) return;
    const width = content.scrollWidth;
    const tall = content.scrollHeight;
    const next = Math.max(
      MIN,
      Math.min(1, (box.clientWidth - 24) / width, (box.clientHeight - 24) / tall),
    );
    setScale(next);
    setAt({ x: Math.max(12, (box.clientWidth - width * next) / 2), y: 12 });
  }, []);

  // Fit once when drawn, so a big chart starts whole.
  useEffect(() => {
    const timer = setTimeout(fit, 30);
    return () => clearTimeout(timer);
  }, [fit]);

  const zoom = (by: number, around?: { x: number; y: number }) => {
    setScale((now) => {
      const next = Math.max(MIN, Math.min(MAX, now * by));
      const box = frame.current;
      const point =
        around ?? (box ? { x: box.clientWidth / 2, y: box.clientHeight / 2 } : { x: 0, y: 0 });
      setAt((pos) => ({
        x: point.x - ((point.x - pos.x) * next) / now,
        y: point.y - ((point.y - pos.y) * next) / now,
      }));
      return next;
    });
  };

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    box.addEventListener("wheel", wheel, { passive: false });
    return () => box.removeEventListener("wheel", wheel);
  });

  const button = "grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100";
  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm">
        <button
          type="button"
          className={button}
          onClick={() => zoom(1 / 1.2)}
          aria-label="Zoom out"
        >
          <Minus className="size-4" />
        </button>
        <span className="w-11 text-center text-xs font-semibold text-slate-600 tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button type="button" className={button} onClick={() => zoom(1.2)} aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          className="h-8 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          onClick={() => {
            setScale(1);
            setAt({ x: 12, y: 12 });
          }}
        >
          100%
        </button>
        <button
          type="button"
          className={button}
          onClick={fit}
          aria-label="Fit the whole chart"
          title="Fit"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
      <div
        ref={frame}
        style={{ height }}
        className="relative cursor-grab overflow-hidden rounded-xl bg-slate-50/70 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = {
            x: at.x,
            y: at.y,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const dx = event.clientX - start.startX;
          const dy = event.clientY - start.startY;
          if (!start.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
          start.moved = true;
          setAt({ x: start.x + dx, y: start.y + dy });
        }}
        onPointerUp={() => {
          // A drag ends without opening the box under the pointer.
          if (drag.current?.moved) {
            const stop = (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
            };
            window.addEventListener("click", stop, { capture: true, once: true });
            setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
          }
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <div
          ref={inner}
          className="absolute top-0 left-0 w-max origin-top-left"
          style={{ transform: `translate(${at.x}px, ${at.y}px) scale(${scale})` }}
        >
          {children}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        Drag to move · Ctrl/⌘ + scroll or the buttons to zoom · Fit shows it all
      </p>
    </div>
  );
}
