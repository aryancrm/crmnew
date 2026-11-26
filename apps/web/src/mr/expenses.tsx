// The field's expenses (SEFMED's Expenses, docs/PLAN.md 22), on the CRM's own expense lines: the
// month's lines, Head · Date · Claimed · Amount (approved), a ⋮ on each (claim / change; the team
// lead approves, maybe less, or rejects with why), the totals Claimed and Approved, + Add expense
// (date, head, amount, remark, attach or camera). Per diem and TA come by themselves for each day
// worked, at the company's rates (0 until Management sets them). ?waiting=1 is what waits for the
// lead (the team switch narrows it); older lines (petrol, fares…) show by their kind.

import type { ExpenseMonth, ExpenseRow, WorkType } from "@2mg/api/mr";
import { EXPENSE_STATUS_WORDS, WORK_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronLeft, ChevronRight, MoreVertical, Paperclip, Plus } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import { dayWords, FIELD, Label, MrHead, monthWords, shiftMonth } from "./parts";
import { EmptyState } from "../no-results";

const pesosOf = (centavos: number) => String(centavos / 100);

export function MrExpensesPage() {
  const [params, setParams] = useSearchParams();
  // The visits report links a span of days (from=…): its month.
  const month = params.get("month") ?? params.get("from")?.slice(0, 7) ?? null;
  const person = params.get("person");
  const waiting = params.get("waiting") === "1";
  const unit = useTeamUnit();
  const [head, setHead] = useState("");
  const [open, setOpen] = useState<{ what: "add" | "line" | "rates"; row?: ExpenseRow } | null>(null);
  const query = useQuery({
    queryKey: ["mr", "expenses", month, person, waiting, unit],
    queryFn: () =>
      api<ExpenseMonth>(
        withUnit(
          `/api/mr/expenses?${new URLSearchParams({ ...(month ? { month } : {}), ...(person ? { person } : {}), ...(waiting ? { waiting: "1" } : {}) })}`,
          unit,
        ),
      ),
    placeholderData: (previous) => previous,
  });
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) if (value === null) out.delete(key); else out.set(key, value);
    setParams(out, { replace: true });
  };
  const data = query.data;
  if (!data) return <PageState query={query} what="the expenses" />;
  const rows = data.rows.filter((one) => !head || one.head === head);
  return (
    <div className={`mx-auto flex max-w-4xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title={waiting ? "Expenses to approve" : "Expenses"}
        sub={waiting ? `${data.rows.length} waiting${data.person ? ` · ${data.person.name}` : ""}` : data.person ? data.person.name : "Everyone"}
        actions={
          <>
            {data.can.decide && !waiting && <Button small onClick={() => set({ waiting: "1", month: null })}>To approve</Button>}
            {waiting && <Button small variant="quiet" onClick={() => set({ waiting: null })}>The month</Button>}
            {data.can.setRates && <Button small onClick={() => setOpen({ what: "rates" })}>Allowance rates</Button>}
          </>
        }
      />
      {(waiting || person === "all") && <TeamSwitch />}
      <div className="flex flex-wrap items-center gap-2">
        {!waiting && (
          <>
            <Button small variant="quiet" aria-label="Month before" onClick={() => set({ month: shiftMonth(data.month, -1), from: null, to: null })}><ChevronLeft size={16} /></Button>
            <span className="text-sm font-semibold">{monthWords(data.month)}</span>
            <Button small variant="quiet" aria-label="Month after" onClick={() => set({ month: shiftMonth(data.month, 1), from: null, to: null })}><ChevronRight size={16} /></Button>
          </>
        )}
        <select aria-label="Head" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={head} onChange={(event) => setHead(event.target.value)}>
          <option value="">All</option>
          {data.heads.filter((one) => one.active).map((one) => (
            <option key={one.code} value={one.code}>{one.name}</option>
          ))}
        </select>
        {data.people.length > 0 && (
          <select aria-label="Whose expenses" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={person ?? ""} onChange={(event) => set({ person: event.target.value || null })}>
            <option value="">Mine</option>
            <option value="all">Everyone</option>
            {data.people.map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className={`${CARD} flex items-center justify-between px-4 py-3`}>
        <div className="text-center">
          <div className="font-bold text-rose-600">{peso(data.totals.claimed)}</div>
          <div className="text-[11px] font-semibold text-rose-600">Claimed amount</div>
        </div>
        {data.can.add && (
          <button type="button" aria-label="Add expense" onClick={() => setOpen({ what: "add" })} className="grid size-12 place-items-center rounded-full bg-sky-500 text-white shadow-lg hover:bg-sky-600">
            <Plus size={24} />
          </button>
        )}
        <div className="text-center">
          <div className="font-bold text-sky-800">{peso(data.totals.approved)}</div>
          <div className="text-[11px] font-semibold text-sky-800">Approved amount</div>
        </div>
      </div>
      <div className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-[1fr_3.25rem_3.75rem_3.75rem_1.75rem] gap-1 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
          <span>Head</span>
          <span>Date</span>
          <span className="text-right">₱ Claimed</span>
          <span className="text-right">₱ Amount</span>
          <span />
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((one) => (
            <li key={one.id} className="grid grid-cols-[1fr_3.25rem_3.75rem_3.75rem_1.75rem] items-center gap-1 px-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate">{one.headName}</span>
                <span className={`block truncate text-[11px] font-semibold ${one.status === "approved" ? "text-emerald-700" : one.status === "sent_back" ? "text-rose-700" : one.status === "pending" ? "text-amber-700" : "text-slate-400"}`}>
                  {EXPENSE_STATUS_WORDS[one.status]}
                  {one.auto ? ` · worked out ${peso(one.generated)}` : ""}
                  {!data.person ? ` · ${one.person.name}` : ""}
                  {one.decisionNote ? ` · ${one.decisionNote}` : ""}
                </span>
              </span>
              <span className="text-[12px]">{dayWords(one.day).replace(/^\w+, /, "")}</span>
              <span className="text-right">{peso(one.status === "open" ? 0 : one.claimed)}</span>
              <span className="text-right font-semibold text-rose-600">{peso(one.approved ?? 0)}</span>
              <button type="button" aria-label="More" onClick={() => setOpen({ what: "line", row: one })} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
                <MoreVertical size={16} />
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li>
              {waiting ? (
                <EmptyState title="Nothing waits for approval.">Expenses your team claims show here for you to approve.</EmptyState>
              ) : (
                <EmptyState title="No expenses this month.">Per diem and TA appear for each day you start working.</EmptyState>
              )}
            </li>
          )}
        </ul>
      </div>
      {open?.what === "add" && <AddExpense data={data} onClose={() => setOpen(null)} />}
      {open?.what === "line" && open.row && <LineDialog data={data} row={open.row} onClose={() => setOpen(null)} />}
      {open?.what === "rates" && <RatesDialog data={data} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FilePick({ file, onPick }: { file: File | null; onPick: (file: File | null) => void }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <label className="grid size-12 cursor-pointer place-items-center rounded-full bg-sky-200 text-sky-800" aria-label="Attach a file">
        <Paperclip size={18} />
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(event) => onPick(event.target.files?.[0] ?? null)} />
      </label>
      <label className="grid size-12 cursor-pointer place-items-center rounded-full bg-sky-200 text-sky-800" aria-label="Take a photo">
        <Camera size={18} />
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => onPick(event.target.files?.[0] ?? null)} />
      </label>
      {file && <span className="max-w-40 truncate text-xs text-slate-600">{file.name}</span>}
    </div>
  );
}

function AddExpense({ data, onClose }: { data: ExpenseMonth; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [day, setDay] = useState(manilaToday());
  const [head, setHead] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const heads = data.heads.filter((one) => one.active && !one.allowance);
  const needsBill = heads.find((one) => one.code === head)?.needsBill ?? true;
  return (
    <Dialog title="Add expense" onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Label text="Date" error={action.at("day")}><input type="date" className={FIELD} max={manilaToday()} value={day} onChange={(event) => setDay(event.target.value)} /></Label>
        <Label text="Head *" error={action.at("head")}>
          <select className={FIELD} value={head} onChange={(event) => setHead(event.target.value)}>
            <option value="">Pick</option>
            {heads.map((one) => (
              <option key={one.code} value={one.code}>{one.name.toUpperCase()}</option>
            ))}
          </select>
        </Label>
        <Label text="Amount (₱) *" error={action.at("amount")}><input className={FIELD} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Label>
        <Label text="Remark"><input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} /></Label>
        <FilePick file={file} onPick={setFile} />
        {needsBill && !file && <p className="text-center text-xs text-slate-500">This head needs the photo of its bill.</p>}
        <Problem message={action.general(["day", "head", "amount"])} />
        <Button
          variant="primary"
          disabled={action.busy || !head || !amount}
          onClick={() =>
            action.run(async () => {
              const body = new FormData();
              body.set("day", day);
              body.set("head", head);
              body.set("amount", amount);
              if (note) body.set("note", note);
              if (file) body.set("file", file);
              await api("/api/mr/expenses", { body });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          ADD EXPENSE
        </Button>
      </div>
    </Dialog>
  );
}

/** A line's ⋮: the MR claims or changes it; the team lead approves (the amount may be less) or
 *  rejects it with why. */
function LineDialog({ data, row, onClose }: { data: ExpenseMonth; row: ExpenseRow; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [amount, setAmount] = useState(row.status === "open" ? (row.generated ? pesosOf(row.generated) : "") : pesosOf(row.claimed));
  const [note, setNote] = useState(row.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [approved, setApproved] = useState(pesosOf(row.claimed));
  const [why, setWhy] = useState("");
  const own = data.can.add && data.person?.id === row.person.id;
  const refresh = () => queries.invalidateQueries({ queryKey: ["mr"] });
  return (
    <Dialog title={row.headName} sub={`${row.person.name} · ${dayWords(row.day)} · ${EXPENSE_STATUS_WORDS[row.status]}`} onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className={`${CARD} p-2`}><div className="font-bold">{peso(row.generated)}</div><div className="text-[11px] text-slate-500">Worked out</div></div>
          <div className={`${CARD} p-2`}><div className="font-bold">{peso(row.claimed)}</div><div className="text-[11px] text-slate-500">Claimed</div></div>
          <div className={`${CARD} p-2`}><div className="font-bold">{peso(row.approved ?? 0)}</div><div className="text-[11px] text-slate-500">Approved</div></div>
        </div>
        {row.hasFile && <a className="text-sky-700 hover:underline" href={`/api/mr/expenses/${row.id}/file`} target="_blank" rel="noreferrer">Open the bill</a>}
        {row.note && <div className="text-slate-600">Remark: {row.note}</div>}
        {own && row.status !== "approved" && (
          <>
            <Label text="Claim (₱)" error={action.at("amount")}><input className={FIELD} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Label>
            <Label text="Remark"><input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} /></Label>
            <FilePick file={file} onPick={setFile} />
            <Button
              variant="primary"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  const body = new FormData();
                  body.set("amount", amount || "0");
                  if (note) body.set("note", note);
                  if (file) body.set("file", file);
                  await api(`/api/mr/expenses/${row.id}/claim`, { body });
                  await refresh();
                  onClose();
                })
              }
            >
              {row.status === "open" ? "Claim" : "Save the claim"}
            </Button>
          </>
        )}
        {data.can.decide && row.status === "pending" && !own && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Label text="Approve (₱)" error={action.at("amount")}><input className={FIELD} inputMode="decimal" value={approved} onChange={(event) => setApproved(event.target.value)} /></Label>
            <Button variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/expenses/${row.id}/decide`, { body: { approve: true, amount: Number(approved) } }); await refresh(); onClose(); })}>Approve</Button>
            <Label text="Or reject: why" error={action.at("note")}><input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} /></Label>
            <Button disabled={action.busy || !why.trim()} onClick={() => action.run(async () => { await api(`/api/mr/expenses/${row.id}/decide`, { body: { approve: false, note: why } }); await refresh(); onClose(); })}>Reject</Button>
          </div>
        )}
        <Problem message={action.general(["amount", "note"])} />
      </div>
    </Dialog>
  );
}

function RatesDialog({ data, onClose }: { data: ExpenseMonth; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [rates, setRates] = useState(data.allowances.map((one) => ({ workType: one.workType, perDiem: pesosOf(one.perDiem), ta: pesosOf(one.ta) })));
  const change = (workType: WorkType, key: "perDiem" | "ta", value: string) =>
    setRates((all) => all.map((one) => (one.workType === workType ? { ...one, [key]: value } : one)));
  return (
    <Dialog title="Allowance rates" sub="The company's per diem and TA a day by work place, in pesos (0 = not set)." onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-2">
        {rates.map((one) => (
          <div key={one.workType} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 text-sm">
            <span>{WORK_WORDS[one.workType]}</span>
            <input aria-label={`Per diem ${WORK_WORDS[one.workType]}`} className={`${FIELD} h-9`} inputMode="decimal" value={one.perDiem} onChange={(event) => change(one.workType, "perDiem", event.target.value)} />
            <input aria-label={`TA ${WORK_WORDS[one.workType]}`} className={`${FIELD} h-9`} inputMode="decimal" value={one.ta} onChange={(event) => change(one.workType, "ta", event.target.value)} />
          </div>
        ))}
        <div className="grid grid-cols-[1fr_6rem_6rem] text-[11px] text-slate-500"><span /><span>Per diem</span><span>TA</span></div>
        <Problem message={action.problem?.message} />
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api("/api/mr/expenses/rates", { body: { rates: rates.map((one) => ({ workType: one.workType, perDiem: Number(one.perDiem) || 0, ta: Number(one.ta) || 0 })) } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          Save rates
        </Button>
      </div>
    </Dialog>
  );
}
