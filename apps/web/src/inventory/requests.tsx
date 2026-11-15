// "Medicine not available": the pop-up anyone outside Inventory uses to ask for a medicine we
// don't have (or don't list), the list of what they asked and Inventory's answers, and
// Inventory's own page of requests to answer.

import type { Catalogue, CustomerList, MedicineRequest, MedicineRequests } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, PackagePlus, Truck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, count, Dialog, PageHead, PageState, timeLabel, useAction } from "../ui";

const FIELD =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none";
const LABEL = "text-xs font-semibold text-slate-600";

export const REQUEST_STATUS: Record<MedicineRequest["status"], { word: string; tone: string }> = {
  open: { word: "Asked", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  ordered: { word: "Ordered", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  added: { word: "Added to the list", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  declined: { word: "Can't be had", tone: "bg-rose-50 text-rose-800 ring-rose-200" },
};

/** Ask Inventory for a medicine: its name (or one of ours that is out), how many, for whom. */
export function MedicineRequestDialog({
  catalogue,
  start,
  onClose,
}: {
  catalogue: Catalogue;
  /** A medicine of ours already picked (out of stock). */
  start?: { id: number; name: string; strength: string | null } | null;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [name, setName] = useState(start?.name ?? "");
  const [strength, setStrength] = useState(start?.strength ?? "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const [asked, setAsked] = useState("");
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(find.trim()), 250);
    return () => clearTimeout(timer);
  }, [find]);
  const customers = useQuery({
    queryKey: ["customers", "pick", asked],
    queryFn: () => api<CustomerList>(`/api/customers?q=${encodeURIComponent(asked)}`),
    enabled: asked.length >= 2 && !customer,
  });
  // One of ours, matched by the name typed: the request then points at it.
  const ours = catalogue.rows.find(
    (row) =>
      row.name.toLowerCase() === name.trim().toLowerCase() &&
      (row.strength ?? "").toLowerCase() === strength.trim().toLowerCase(),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = await action.run(() =>
      api("/api/inventory/requests", {
        body: {
          medicineId: ours?.id ?? (start?.id || null),
          name,
          strength: strength || null,
          qty: qty ? Number(qty) : null,
          customerId: customer?.id ?? null,
          note: note || null,
        },
      }),
    );
    if (!sent) return;
    await queries.invalidateQueries({ queryKey: ["inventory", "requests"] });
    setDone(true);
  }

  return (
    <Dialog
      title="Medicine not available"
      sub="Tell Inventory what a customer wants that we don't have. They answer here."
      onClose={onClose}
      busy={action.busy}
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CircleCheck className="size-10 text-emerald-600" />
          <div className="text-sm font-semibold text-slate-900">Inventory has your request</div>
          <div className="text-[13px] text-slate-500">
            {name} {strength}: you'll see their answer under "What I asked for".
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Medicine *</span>
              <input
                list="request-medicines"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Brand or molecule"
                className={FIELD}
                required
                autoFocus={!start}
              />
              <datalist id="request-medicines">
                {catalogue.rows.map((row) => (
                  <option key={row.id} value={row.name}>
                    {[row.strength, row.total ? `${count(row.total)} in stock` : "out of stock"]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                ))}
              </datalist>
              {action.at("name") && (
                <span className="text-xs font-medium text-rose-700">{action.at("name")}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Strength</span>
              <input
                value={strength}
                onChange={(event) => setStrength(event.target.value)}
                placeholder="80 mg"
                className={FIELD}
              />
            </label>
          </div>
          {ours && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              We list {ours.name} {ours.strength}:{" "}
              <b>{ours.total ? `${count(ours.total)} in stock now` : "out of stock"}</b>.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>How many (pieces)</span>
              <input
                inputMode="numeric"
                value={qty}
                onChange={(event) => setQty(event.target.value.replace(/\D/g, ""))}
                placeholder="30"
                className={FIELD}
              />
            </label>
            <div className="relative flex flex-col gap-1">
              <span className={LABEL}>For which customer</span>
              {customer ? (
                <div className="flex h-10 items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-sm">
                  <span className="truncate font-semibold">{customer.name}</span>
                  <button
                    type="button"
                    onClick={() => setCustomer(null)}
                    className="text-xs font-medium text-emerald-700 hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                    placeholder="Optional: name or phone"
                    className={FIELD}
                  />
                  {asked.length >= 2 && (customers.data?.rows.length ?? 0) > 0 && (
                    <ul className="absolute top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {customers.data?.rows.slice(0, 6).map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomer({ id: row.id, name: row.name });
                              setFind("");
                            }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-slate-50"
                          >
                            <span className="truncate font-medium">{row.name}</span>
                            <span className="shrink-0 text-[11px] text-slate-500">{row.city}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Note for Inventory</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="When they need it, the doctor who prescribed it…"
              className={`${FIELD} h-auto min-h-16 py-2`}
            />
          </label>
          {action.problem && !action.problem.field && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
              {action.problem.message}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button onClick={onClose} disabled={action.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={action.busy}>
              {action.busy ? "Sending…" : "Send to Inventory"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** What this person asked Inventory for, and the answers: under the medicines list. */
export function MyRequests() {
  const open = useQuery({
    queryKey: ["inventory", "requests", "open"],
    queryFn: () => api<MedicineRequests>("/api/inventory/requests"),
  });
  const answered = useQuery({
    queryKey: ["inventory", "requests", "answered"],
    queryFn: () => api<MedicineRequests>("/api/inventory/requests?show=answered"),
  });
  const rows = [...(open.data?.rows ?? []), ...(answered.data?.rows ?? []).slice(0, 10)];
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <h2 className="mb-3 border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
        What I asked for
      </h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-[13px]"
          >
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">
                {row.name} {row.strength}
              </div>
              <div className="text-xs text-slate-500">
                {row.asks
                  .map((ask) =>
                    [ask.customer, ask.qty ? `${count(ask.qty)} pcs` : null, timeLabel(ask.at)]
                      .filter(Boolean)
                      .join(" · "),
                  )
                  .join("; ")}
              </div>
              {row.answer && (
                <div className="mt-1 text-xs text-slate-700">
                  <b>{row.answeredBy}:</b> {row.answer}
                </div>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${REQUEST_STATUS[row.status].tone}`}
            >
              {REQUEST_STATUS[row.status].word}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Inventory's page: every medicine someone asked for, the most asked first, to answer once. */
export function MedicineRequestsPage() {
  const [params, setParams] = useSearchParams();
  const show = params.get("show") === "answered" ? "answered" : "open";
  const query = useQuery({
    queryKey: ["inventory", "requests", show],
    queryFn: () =>
      api<MedicineRequests>(
        `/api/inventory/requests${show === "answered" ? "?show=answered" : ""}`,
      ),
  });
  const [answering, setAnswering] = useState<{
    row: MedicineRequest;
    status: "ordered" | "added" | "declined";
  } | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the requests" />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHead
        title="Medicine requests"
        sub="What Management, MedReps and the Online desk asked for that we don't have. The most asked first."
      />
      <div className="flex w-fit gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
        {(["open", "answered"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={show === key}
            onClick={() => setParams(key === "open" ? {} : { show: key }, { replace: true })}
            className={`rounded-md px-3 py-1.5 ${show === key ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
          >
            {key === "open" ? "To answer" : "Answered"}{" "}
            <span className="ml-1 text-slate-400 tabular-nums">{count(data.counts[key])}</span>
          </button>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          {show === "open"
            ? "Nothing waiting: nobody asked for a medicine we don't have."
            : "Nothing answered yet."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.rows.map((row) => (
            <article
              key={row.id}
              className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900">
                    {row.name} {row.strength}
                  </h2>
                  <div className="text-[11px] text-slate-500">
                    {row.code} ·{" "}
                    {row.medicineId ? (
                      <Link to={`/medicines/${row.medicineId}`} className="hover:underline">
                        we list it · {count(row.inStock)} in stock
                      </Link>
                    ) : (
                      "not on our list"
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums text-slate-900">
                    {count(row.times)}×
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {row.qty ? `${count(row.qty)} pcs` : "asked"}
                  </div>
                </div>
              </div>
              <ul className="mt-3 flex-1 divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-slate-50/50 text-xs">
                {row.asks.slice(0, 4).map((ask) => (
                  <li key={ask.id} className="px-2.5 py-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="truncate font-semibold text-slate-800">
                        {ask.by}
                        {ask.customer ? ` · for ${ask.customer}` : ""}
                      </span>
                      <span className="shrink-0 text-slate-500">{timeLabel(ask.at)}</span>
                    </div>
                    {(ask.qty || ask.note) && (
                      <div className="text-slate-600">
                        {[ask.qty ? `${count(ask.qty)} pcs` : null, ask.note]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </li>
                ))}
                {row.asks.length > 4 && (
                  <li className="px-2.5 py-1.5 text-slate-500">+{row.asks.length - 4} more asks</li>
                )}
              </ul>
              {row.status === "open" ? (
                data.can.answer && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAnswering({ row, status: "ordered" })}
                      className="flex h-8 items-center justify-center gap-1 rounded-lg bg-brand text-xs font-semibold text-white hover:bg-brand-dark"
                    >
                      <Truck className="size-3.5" /> Ordered
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnswering({ row, status: "added" })}
                      className="flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <PackagePlus className="size-3.5" /> Added
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnswering({ row, status: "declined" })}
                      className="flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      <CircleX className="size-3.5" /> Can't get
                    </button>
                  </div>
                )
              ) : (
                <div className="mt-3 flex items-start justify-between gap-2 text-xs">
                  <span className="text-slate-700">
                    <b>{row.answeredBy}:</b> {row.answer ?? REQUEST_STATUS[row.status].word}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${REQUEST_STATUS[row.status].tone}`}
                  >
                    {REQUEST_STATUS[row.status].word}
                  </span>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {answering && <AnswerDialog {...answering} onClose={() => setAnswering(null)} />}
    </div>
  );
}

const ANSWER_WORDS = {
  ordered: {
    title: "Ordered from a supplier",
    hint: "When it comes, so they can tell the customer.",
    placeholder: "Ordered from Hetero, here by the 25th",
  },
  added: {
    title: "Added to our list",
    hint: "It is now in Medicines & stock.",
    placeholder: "Added as Tagrisso 80 mg",
  },
  declined: {
    title: "Can't be had",
    hint: "Say why, so they can tell the customer.",
    placeholder: "Not registered with the FDA here",
  },
} as const;

function AnswerDialog({
  row,
  status,
  onClose,
}: {
  row: MedicineRequest;
  status: "ordered" | "added" | "declined";
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [answer, setAnswer] = useState("");
  const words = ANSWER_WORDS[status];
  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = await action.run(() =>
      api(`/api/inventory/requests/${row.id}/answer`, { body: { status, answer: answer || null } }),
    );
    if (!sent) return;
    await queries.invalidateQueries({ queryKey: ["inventory", "requests"] });
    await queries.invalidateQueries({ queryKey: ["orders", "dashboard"] });
    onClose();
  }
  return (
    <Dialog
      title={`${words.title} · ${row.name}`}
      sub={words.hint}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Answer {status === "declined" ? "*" : ""}</span>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={words.placeholder}
            className={`${FIELD} h-auto min-h-20 py-2`}
            autoFocus
          />
          {action.at("answer") && (
            <span className="text-xs font-medium text-rose-700">{action.at("answer")}</span>
          )}
        </label>
        {action.problem && !action.problem.field && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
            {action.problem.message}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Send the answer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
