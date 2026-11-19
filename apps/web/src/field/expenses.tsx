// What the field spends: petrol (with the kilometres), fares, parking, tolls, food, lodging and
// other costs, each with the photo of its bill or payment proof (a fare may have none). The MedRep
// adds them; their team lead approves each or sends it back with a word; the CEO opens anyone's.
// With ?waiting=1 it is the team lead's list of lines to approve.

import type { ExpenseKind, ExpenseRow, FieldDay, FieldExpenses } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ChevronLeft, FileText, Pencil, Plus, Undo2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { FIELD } from "../org/dialogs";
import { smaller } from "../photo";
import { manilaToday, RangePicker, short } from "../team/range";
import { Button, CARD, Dialog, PageHead, PageState, Problem, peso, useAction } from "../ui";

export const EXPENSE_WORDS: Record<ExpenseKind, string> = {
  petrol: "Petrol",
  fare: "Fare",
  parking: "Parking",
  toll: "Toll",
  food: "Food",
  lodging: "Lodging",
  other: "Other",
};
const STATUS: Record<ExpenseRow["status"], { word: string; tone: string }> = {
  pending: { word: "With the team lead", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { word: "Approved", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  sent_back: { word: "Sent back", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
};
const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function Label({ text, error, children }: { text: string; error?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control comes in as the children.
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{text}</span>
      {children}
      {error && <span className="text-xs font-medium text-rose-700">{error}</span>}
    </label>
  );
}

export function FieldExpensesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const waiting = params.get("waiting") === "1";
  const person = params.get("person");
  const today = manilaToday();
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? today;
  const query = useQuery({
    queryKey: ["field", "expenses", waiting, person, from, to],
    queryFn: () =>
      api<FieldExpenses>(
        `/api/field/expenses?${new URLSearchParams({
          ...(waiting ? { waiting: "1" } : { from, to }),
          ...(person ? { person } : {}),
        })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the expenses" />;
  const t = data.totals;
  const kinds = (Object.keys(t.byKind) as ExpenseKind[]).filter((kind) => t.byKind[kind]);
  const mine = data.can.add;

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      {!mine && !waiting && (
        <nav
          aria-label="Where you are"
          className="flex items-center gap-1.5 text-xs text-slate-500"
        >
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/field/report"))}
            aria-label="Back"
            className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <Link to="/field/report" className="hover:text-slate-800">
            Visits report
          </Link>
          <span aria-hidden="true" className="text-slate-300">
            ›
          </span>
          <span className="font-medium text-slate-700">{data.person?.name}</span>
        </nav>
      )}
      <PageHead
        title={
          waiting ? "Expenses to approve" : mine ? "My expenses" : `${data.person?.name}'s expenses`
        }
        sub={
          waiting
            ? `${data.rows.length} waiting for you`
            : `${data.from === data.to ? short(data.from) : `${short(data.from)} – ${short(data.to)}`}`
        }
        actions={
          mine && (
            <Button variant="primary" small onClick={() => setEditing("new")}>
              <Plus size={15} /> Add expense
            </Button>
          )
        }
      >
        {!waiting && <RangePicker />}
      </PageHead>

      {!waiting && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className={`${CARD} p-4`}>
            <div className="text-xs font-semibold text-slate-500">Approved</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700 tabular-nums">
              {peso(t.approved)}
            </div>
          </div>
          <div className={`${CARD} p-4`}>
            <div className="text-xs font-semibold text-slate-500">With the team lead</div>
            <div className="mt-1 text-2xl font-semibold text-amber-700 tabular-nums">
              {peso(t.pending)}
            </div>
            {t.sentBack > 0 && (
              <div className="mt-1 text-xs text-rose-700">{peso(t.sentBack)} sent back</div>
            )}
          </div>
          <div className={`${CARD} p-4 xl:col-span-2`}>
            <div className="text-xs font-semibold text-slate-500">By kind</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
              {kinds.length ? (
                kinds.map((kind) => (
                  <span key={kind}>
                    <span className="text-slate-500">{EXPENSE_WORDS[kind]}</span>{" "}
                    <span className="font-semibold text-slate-900">
                      {peso(t.byKind[kind] ?? 0)}
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-slate-400">Nothing spent</span>
              )}
              {t.km > 0 && (
                <span>
                  <span className="text-slate-500">Driven</span>{" "}
                  <span className="font-semibold text-slate-900">{t.km} km</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <section className={`${CARD} overflow-hidden`}>
        <ul className="divide-y divide-slate-100">
          {data.rows.map((row) => (
            <ExpenseLine
              key={row.id}
              row={row}
              waiting={waiting}
              mine={mine}
              onEdit={() => setEditing(row)}
            />
          ))}
          {data.rows.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              {waiting
                ? "Nothing waiting for you."
                : mine
                  ? "Nothing added in these days. Add what you spent with its bill."
                  : "Nothing spent in these days."}
            </li>
          )}
        </ul>
      </section>
      {editing && (
        <ExpenseDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ExpenseLine({
  row,
  waiting,
  mine,
  onEdit,
}: {
  row: ExpenseRow;
  waiting: boolean;
  mine: boolean;
  onEdit: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const decide = (approve: boolean) =>
    action.run(async () => {
      await api(`/api/field/expenses/${row.id}/decide`, { body: { approve, note: note || null } });
      await queries.invalidateQueries({ queryKey: ["field"] });
    });
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{EXPENSE_WORDS[row.kind]}</span>
          <span className="font-semibold text-slate-900 tabular-nums">{peso(row.amount)}</span>
          {row.km && <span className="text-xs text-slate-500">{row.km} km</span>}
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS[row.status].tone}`}
          >
            {STATUS[row.status].word}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {[
            waiting ? row.person.name : null,
            dayWords(row.day),
            row.visit ? `visit to ${row.visit.customer}` : null,
            row.note,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {row.decisionNote && (
          <div className="mt-1 text-xs text-rose-700">
            {row.decidedBy}: {row.decisionNote}
          </div>
        )}
        {row.receipt ? (
          <a
            href={`/api/field/expenses/${row.id}/receipt`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
          >
            <FileText size={12} /> Bill
          </a>
        ) : (
          <span className="mt-1 inline-block text-xs text-slate-400">No bill (fare)</span>
        )}
        <Problem message={action.problem?.message} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {mine && row.status !== "approved" && (
          <Button small onClick={onEdit}>
            <Pencil size={14} /> {row.status === "sent_back" ? "Put it right" : "Change"}
          </Button>
        )}
        {row.canDecide &&
          (sendingBack ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void decide(false);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What is wrong"
                className="h-8 w-44 rounded-lg border border-slate-300 px-2 text-sm"
              />
              <Button small type="submit" disabled={action.busy}>
                Send back
              </Button>
            </form>
          ) : (
            <>
              <Button small variant="primary" disabled={action.busy} onClick={() => decide(true)}>
                <Check size={14} /> Approve
              </Button>
              <Button small onClick={() => setSendingBack(true)}>
                <Undo2 size={14} /> Send back
              </Button>
            </>
          ))}
      </div>
    </li>
  );
}

function ExpenseDialog({ row, onClose }: { row: ExpenseRow | null; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [day, setDay] = useState(row?.day ?? manilaToday());
  const [kind, setKind] = useState<ExpenseKind>(row?.kind ?? "petrol");
  const [amount, setAmount] = useState(row ? String(row.amount / 100) : "");
  const [km, setKm] = useState(row?.km ? String(row.km) : "");
  const [visitId, setVisitId] = useState(row?.visit ? String(row.visit.id) : "");
  const [note, setNote] = useState(row?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const visits = useQuery({
    queryKey: ["field", "day", null, day],
    queryFn: () => api<FieldDay>(`/api/field/day?day=${day}`),
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      const body = new FormData();
      body.set("day", day);
      body.set("kind", kind);
      body.set("amount", amount);
      if (kind === "petrol" && km) body.set("km", km);
      if (visitId) body.set("visitId", visitId);
      if (note.trim()) body.set("note", note.trim());
      if (file) body.set("file", await smaller(file));
      await api(row ? `/api/field/expenses/${row.id}` : "/api/field/expenses", { body });
    });
    if (done) {
      await queries.invalidateQueries({ queryKey: ["field"] });
      onClose();
    }
  }
  const needsBill = kind !== "fare";
  const fileError = action.at("file");
  return (
    <Dialog
      title={row ? "Change the expense" : "Add an expense"}
      sub="With the photo of the bill or payment proof."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Label text="Day *" error={action.at("day")}>
            <input
              type="date"
              value={day}
              max={manilaToday()}
              onChange={(event) => setDay(event.target.value)}
              className={FIELD}
            />
          </Label>
          <Label text="For *" error={action.at("kind")}>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as ExpenseKind)}
              className={FIELD}
            >
              {(Object.keys(EXPENSE_WORDS) as ExpenseKind[]).map((key) => (
                <option key={key} value={key}>
                  {EXPENSE_WORDS[key]}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Amount (₱) *" error={action.at("amount")}>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={FIELD}
              inputMode="decimal"
              placeholder="450"
            />
          </Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "petrol" && (
            <Label text="Kilometres driven" error={action.at("km")}>
              <input
                value={km}
                onChange={(event) => setKm(event.target.value)}
                className={FIELD}
                inputMode="numeric"
                placeholder="38"
              />
            </Label>
          )}
          <Label text="For a visit" error={action.at("visitId")}>
            <select
              value={visitId}
              onChange={(event) => setVisitId(event.target.value)}
              className={FIELD}
            >
              <option value="">
                {visits.data?.visits.length ? "Not for one visit" : "No visits that day"}
              </option>
              {(visits.data?.visits ?? []).map((one) => (
                <option key={one.id} value={one.id}>
                  {one.customer.name}
                </option>
              ))}
            </select>
          </Label>
        </div>
        <Label text={kind === "other" ? "What it was *" : "Note"} error={action.at("note")}>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={FIELD}
            placeholder="Pasay to Makati and back"
          />
        </Label>
        <Label
          text={needsBill ? "Bill or payment proof *" : "Bill (if you have one)"}
          error={fileError}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover">
              <Camera size={15} />{" "}
              {file ? "Another photo" : row?.receipt ? "Replace the photo" : "Take or pick a photo"}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </span>
            <span className="truncate text-xs text-slate-600">
              {file ? file.name : row?.receipt ? `On file: ${row.receipt.name}` : "No photo yet"}
            </span>
          </span>
        </Label>
        <Problem
          message={action.general(["day", "kind", "amount", "km", "visitId", "note", "file"])}
        />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : row ? "Save and send again" : "Add expense"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
