// An order's versions (docs/PLAN.md 18, Aryan 17 Nov): as the MedRep placed it, each time they
// fixed it, each time Management changed it before approving. The MedRep sees at once what
// Management changed, line by line, before → after; anyone can open every version.

import type { OrderVersion, OrderVersionLine } from "@2mg/api/types";
import { ChevronDown, History, PencilLine } from "lucide-react";
import { useState } from "react";
import { count, peso, timeLabel } from "../ui";

export type LineChange = { name: string; what: string; tone: "add" | "off" | "change" };

/** A medicine's paid line and its free line are two lines; the same medicine twice is added up. */
function grouped(lines: OrderVersionLine[]) {
  const out = new Map<string, OrderVersionLine>();
  for (const line of lines) {
    const key = `${line.medicineId}:${line.free ? "free" : "paid"}`;
    const have = out.get(key);
    out.set(key, have ? { ...have, qty: have.qty + line.qty } : { ...line });
  }
  return out;
}

/** What changed from one version to the next, one row per medicine line. */
export function changesBetween(before: OrderVersionLine[], after: OrderVersionLine[]): LineChange[] {
  const old = grouped(before);
  const now = grouped(after);
  const out: LineChange[] = [];
  for (const [key, line] of now) {
    const was = old.get(key);
    const name = line.free ? `${line.name} (free)` : line.name;
    if (!was) {
      out.push({
        name,
        tone: "add",
        what: line.free
          ? `Added free: ${count(line.qty)}`
          : `Added: ${count(line.qty)} × ${peso(line.unitPrice)}${line.unitPrice !== line.listPrice ? ` (list ${peso(line.listPrice)})` : ""}`,
      });
      continue;
    }
    const bits: string[] = [];
    if (was.qty !== line.qty) bits.push(`qty ${count(was.qty)} → ${count(line.qty)}`);
    if (!line.free && was.unitPrice !== line.unitPrice)
      bits.push(`${peso(was.unitPrice)} → ${peso(line.unitPrice)} each (list ${peso(line.listPrice)})`);
    if (was.relief !== line.relief) bits.push(line.relief ? "SC/PWD price on" : "SC/PWD price off");
    if (bits.length) out.push({ name, tone: "change", what: bits.join(", ") });
  }
  for (const [key, was] of old)
    if (!now.has(key))
      out.push({
        name: was.free ? `${was.name} (free)` : was.name,
        tone: "off",
        what: `Taken off (was ${count(was.qty)}${was.free ? " free" : ` × ${peso(was.unitPrice)}`})`,
      });
  return out;
}

const TONE: Record<LineChange["tone"], string> = {
  add: "text-emerald-700",
  off: "text-rose-700",
  change: "text-sky-700",
};

function Changes({ list }: { list: LineChange[] }) {
  if (!list.length) return <div className="text-slate-500">No medicine or price changed.</div>;
  return (
    <ul className="mt-1 space-y-0.5">
      {list.map((change) => (
        <li key={`${change.name}-${change.what}`} className="flex flex-wrap gap-x-1.5">
          <span className="font-semibold text-slate-800">{change.name}:</span>
          <span className={TONE[change.tone]}>{change.what}</span>
        </li>
      ))}
    </ul>
  );
}

/** Management's last change before approving, for the MedRep to see at once, and every version
 *  of the order behind a toggle. Nothing when the order never changed. */
export function OrderVersions({ versions }: { versions: OrderVersion[] }) {
  const [open, setOpen] = useState(false);
  if (versions.length < 2) return null;
  const at = versions.findLastIndex((version) => version.kind === "changed");
  const last = at > 0 ? versions[at] : undefined;
  const before = at > 0 ? versions[at - 1] : undefined;
  return (
    <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 text-[13px] text-slate-800">
      {last && before && (
        <div className="flex gap-2.5">
          <PencilLine className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <b>Changed by {last.by ?? "Management"}</b>{" "}
            <span className="text-slate-500">· {timeLabel(last.at)}</span>
            {last.why && <div className="mt-0.5">“{last.why}”</div>}
            <Changes list={changesBetween(before.lines, last.lines)} />
            {before.total !== last.total && (
              <div className="mt-1 text-slate-600">
                Total {peso(before.total)} → <b className="text-slate-900">{peso(last.total)}</b>
              </div>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 ${last ? "mt-2" : ""}`}
        aria-expanded={open}
      >
        <History className="size-3.5" aria-hidden="true" />
        {open ? "Hide" : "See"} every version ({count(versions.length)})
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="mt-2 space-y-2.5 border-l-2 border-slate-200 pl-3">
          {versions.map((version, index) => {
            const prior = versions[index - 1];
            return (
              <li key={version.n}>
                <div className="font-semibold">
                  {version.n}. {version.kindLabel}
                  <span className="font-normal text-slate-500">
                    {version.by ? ` · ${version.by}` : ""} · {timeLabel(version.at)} · {peso(version.total)}
                  </span>
                </div>
                {version.why && <div className="text-slate-600">“{version.why}”</div>}
                {prior ? (
                  <Changes list={changesBetween(prior.lines, version.lines)} />
                ) : (
                  <ul className="mt-1 space-y-0.5 text-slate-700">
                    {version.lines.map((line, at) => (
                      <li key={`${line.medicineId}-${at}`}>
                        {line.name} · {count(line.qty)}
                        {line.free
                          ? " free"
                          : ` × ${peso(line.unitPrice)}${line.unitPrice !== line.listPrice ? ` (list ${peso(line.listPrice)})` : ""}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
