// The General part's Division and Sub-division when the account handles more than one (27 Nov: "an
// account may handle several Sub-divisions, Divisions or areas: a search dropdown in the General"):
// only what the account holds on the company's tree, searchable by Division, Sub-division, area or
// team. One assignment shows as it is, with no list.

import type { OrderAssignment } from "@2mg/api/types";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export const assignmentKey = (one: Pick<OrderAssignment, "division" | "subDivision">) => `${one.division}|${one.subDivision}`;

const words = (one: OrderAssignment) => [one.division, one.subDivision].filter(Boolean).join(" · ");
const detail = (one: OrderAssignment) => [one.area, one.team && one.team !== one.area ? one.team : null].filter(Boolean).join(" · ");

export function AssignmentPicker({
  options,
  value,
  onPick,
  className,
}: {
  options: OrderAssignment[];
  value: string;
  onPick: (one: OrderAssignment) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useId();
  const picked = options.find((one) => assignmentKey(one) === value) ?? options[0];
  const asked = text.trim().toLowerCase();
  const shown = asked
    ? options.filter((one) => `${words(one)} ${detail(one)} ${one.seat ?? ""}`.toLowerCase().includes(asked))
    : options;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (one: OrderAssignment) => {
    onPick(one);
    setOpen(false);
    setText("");
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={list}
        onClick={() => {
          setOpen((now) => !now);
          setAt(0);
        }}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className="min-w-0 truncate">{picked ? words(picked) : "Pick one"}</span>
        <ChevronDown size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5">
            <Search size={14} className="text-slate-400" aria-hidden="true" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the list opened to be searched.
              autoFocus
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setAt(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setAt((now) => Math.min(now + 1, shown.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setAt((now) => Math.max(now - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const one = shown[at];
                  if (one) choose(one);
                } else if (event.key === "Escape") setOpen(false);
              }}
              placeholder="Search Division, Sub-division or area"
              aria-label="Search your Divisions and Sub-divisions"
              className="h-9 w-full bg-transparent text-sm outline-none"
            />
          </label>
          <ul id={list} role="listbox" className="mt-1 max-h-64 overflow-y-auto">
            {shown.map((one, n) => {
              const key = assignmentKey(one);
              return (
                <li key={key} role="option" aria-selected={key === value}>
                  <button
                    type="button"
                    onMouseEnter={() => setAt(n)}
                    onClick={() => choose(one)}
                    className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${n === at ? "bg-slate-100" : ""}`}
                  >
                    <Check size={14} className={`mt-0.5 shrink-0 ${key === value ? "text-brand" : "invisible"}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900">{words(one)}</span>
                      {detail(one) && <span className="block truncate text-xs text-slate-500">{detail(one)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-2.5 py-3 text-sm text-slate-500">None of yours matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
