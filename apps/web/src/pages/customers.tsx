// Customers: hospitals, doctors, patients and business buyers. The same screen serves
// Hospitals, Doctors, Patients, Customers and a MedRep's "My area"; the API decides which
// customers the person sees. Search and paging are done by the server.

import type { CustomerKind, CustomerList, CustomerRow, MyArea } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { shortPeso } from "../ceo";
import { CustomerDialog } from "../customers/dialog";
import { RepStrip } from "../rep-strip";
import { seatWords } from "../seat-words";
import { Button, Card, count, dayLabel, PageHead, PageState, Pill } from "../ui";
import { Figure } from "./figures";
import { KIND_BADGE } from "./orders-board";

export function Customers({ kind, mine }: { kind?: CustomerKind; mine?: boolean }) {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  // A Hospital CHC's "My hospitals" opens on the hospitals; "all" shows every kind.
  const asked = params.get("kind");
  const hospitalsFirst = Boolean(mine) && me?.channel?.code === "HOSP" && me.role === "medrep";
  const picked =
    kind ?? (asked === "all" ? undefined : ((asked as CustomerKind | null) || (hospitalsFirst ? "hospital" : undefined)));
  const page = Number(params.get("page")) || 1;
  const review = params.get("review") === "1";
  const medrep = params.get("medrep") ?? "";
  const view = params.get("view") === "table" ? "table" : "cards";
  const [typed, setTyped] = useState(params.get("q") ?? "");

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  // The search goes to the server a moment after typing stops.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed !== (params.get("q") ?? "")) set({ q: typed, page: "" });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "";
  const owes = params.get("owes") ?? "";
  const query = useQuery({
    queryKey: ["customers", "list", picked ?? "", q, page, review, medrep, sort, owes],
    queryFn: () =>
      api<CustomerList>(
        `/api/customers?kind=${picked ?? ""}&q=${encodeURIComponent(q)}&page=${page}${review ? "&review=1" : ""}${medrep ? `&medrep=${medrep}` : ""}${sort ? `&sort=${sort}` : ""}${owes ? `&owes=${owes}` : ""}`,
      ),
    placeholderData: (previous) => previous,
  });
  const area = useQuery({
    queryKey: ["customers", "area"],
    queryFn: () => api<MyArea>("/api/my/area"),
    enabled: Boolean(mine),
  });

  const data = query.data;
  if (!data) return <PageState query={query} what={mine ? `the ${seatWords(me).customers}` : "the customers"} />;
  const kindLabel = data.kinds.find((entry) => entry.key === picked);
  const title = mine ? seatWords(me).myCustomers : (kindLabel?.plural ?? "Customers");
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const label = (key: CustomerKind) => data.kinds.find((entry) => entry.key === key)?.label ?? key;
  const plural = (kindLabel?.plural ?? "Customers").toLowerCase();
  /** This list's address with some of its filters changed. */
  const hrefWith = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const text = next.toString();
    return text ? `?${text}` : "?";
  };

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title={review && !mine ? "New customers to check" : title}
        sub={
          review
            ? "Hospitals, doctors and patients a MedRep added. Their orders go through; check each one's details and mark it checked."
            : `${count(data.total)} ${(data.total === 1 ? (kindLabel?.label ?? "customer") : (kindLabel?.plural ?? "customers")).toLowerCase()}`
        }
        actions={
          data.can.add && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add{" "}
              {kindLabel ? kindLabel.label.toLowerCase() : "customer"}
            </Button>
          )
        }
      />

      {/* The kind's customers at a glance (not narrowed by the search). */}
      {!mine && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure
            label={kindLabel?.plural ?? "Customers"}
            value={count(data.summary.all)}
            sub={
              picked
                ? !review && !q && !medrep && data.byRep.length
                  ? `looked after by ${count(data.byRep.length)}`
                  : undefined
                : data.kinds
                    .filter((entry) => data.counts[entry.key])
                    .slice(0, 3)
                    .map(
                      (entry) =>
                        `${count(data.counts[entry.key] ?? 0)} ${entry.plural.toLowerCase()}`,
                    )
                    .join(" · ")
            }
            to={hrefWith({ review: "", medrep: "", q: "" })}
          />
          <Figure
            label="Not checked yet"
            value={count(data.summary.toCheck)}
            sub={data.summary.toCheck ? "added by a MedRep" : "all checked"}
            tone={data.summary.toCheck ? "warn" : undefined}
            to={data.can.manage ? hrefWith({ review: "1" }) : undefined}
          />
          <Figure
            label="Ordered this month"
            value={count(data.summary.orderedThisMonth)}
            sub={`of ${count(data.summary.all)} ${plural}`}
          />
          <Figure
            label="No order yet"
            value={count(data.summary.neverOrdered)}
            sub={data.summary.neverOrdered ? "never ordered" : "everyone has ordered"}
          />
        </div>
      )}

      {mine && area.data && (
        <Card className="flex flex-col gap-3 p-4">
          {area.data.area ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-lg font-bold">{area.data.area.name}</div>
                {area.data.area.channel && (
                  <Pill tone="brand">{area.data.area.channel} channel</Pill>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {area.data.area.cities.map((city, index) => (
                  <div
                    key={city}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-ground px-2.5 py-1 text-[13px]"
                  >
                    {index === 0 && <MapPin size={14} className="text-brand" aria-hidden="true" />}
                    {city}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-ink-2">You have no area yet. You see the customers you added.</div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {(["hospital", "doctor", "patient"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={picked === key}
                onClick={() => set({ kind: picked === key ? (hospitalsFirst ? "all" : "") : key, page: "" })}
                className={`flex flex-col gap-0.5 rounded-lg p-3 text-left ${picked === key ? "bg-brand-tint ring-2 ring-brand" : "bg-ground"}`}
              >
                <span className="text-xl font-semibold">{count(area.data.counts[key] ?? 0)}</span>
                <span className="text-xs text-ink-2">
                  {data.kinds.find((entry) => entry.key === key)?.plural}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* The search and filters in one box, as the Leads desk draws them. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-0 flex-[3_1_16rem]">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            aria-label="Search"
            placeholder="Search by name, phone number, CUS number or city"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
          />
        </div>
        <select
          aria-label="Who owes"
          className="h-9 flex-[1_1_9rem] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
          value={owes}
          onChange={(event) => set({ owes: event.target.value, page: "" })}
        >
          <option value="">Everyone</option>
          <option value="any">Owe us money</option>
          <option value="overdue">Past due</option>
        </select>
        <select
          aria-label="Order by"
          className="h-9 flex-[1_1_10rem] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
          value={sort}
          onChange={(event) => set({ sort: event.target.value, page: "" })}
        >
          <option value="">A to Z</option>
          <option value="owed">Owe most</option>
          <option value="overdue">Most past due</option>
          <option value="recent">Ordered lately</option>
          <option value="quiet">Longest without an order</option>
        </select>
        {!kind && (
          <select
            aria-label="Kind of customer"
            className="h-9 flex-[1_1_11rem] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
            value={picked ?? ""}
            onChange={(event) => set({ kind: event.target.value || (hospitalsFirst ? "all" : ""), page: "" })}
          >
            <option value="">All kinds</option>
            {data.kinds.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.plural}
                {data.counts[entry.key] ? ` (${count(data.counts[entry.key] as number)})` : ""}
              </option>
            ))}
          </select>
        )}
        {data.can.manage && (
          <button
            type="button"
            aria-pressed={review}
            onClick={() => set({ review: review ? "" : "1", page: "" })}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
              review
                ? "bg-amber-500 text-white shadow-sm"
                : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${review ? "bg-white" : "bg-amber-500"}`}
            />
            Not checked yet
          </button>
        )}
        <fieldset className="hidden shrink-0 gap-0.5 rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold sm:inline-flex">
          <legend className="sr-only">View</legend>
          {(["cards", "table"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => set({ view: key === "cards" ? "" : key })}
              className={`h-8 rounded-md px-3 capitalize ${view === key ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
            >
              {key}
            </button>
          ))}
        </fieldset>
        {!mine && (data.byRep.length > 1 || medrep) && (
          <div className="basis-full border-t border-slate-100 pt-2.5">
            <RepStrip
              reps={data.byRep}
              picked={medrep}
              total={data.byRep.reduce((all, rep) => all + rep.count, data.unassigned)}
              noun="customer"
              onPick={(id) => set({ medrep: id, page: "" })}
            />
          </div>
        )}
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-2xs">
          {q || review || picked || medrep ? "No customer matches." : "No customers yet."}
        </div>
      ) : view === "table" ? (
        <div
          className={`hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs sm:block ${query.isPlaceholderData ? "opacity-60" : ""}`}
        >
          <table className="w-full min-w-[960px] text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
              <tr className="text-left">
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Name
                </th>
                {!picked && (
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Kind
                  </th>
                )}
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Phone
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  City
                </th>
                {!mine && (
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Under
                  </th>
                )}
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Orders
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Last order
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((row) => (
                <tr
                  key={row.id}
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${row.review === "to_review" ? "bg-amber-50/40" : ""}`}
                  onClick={() => navigate(`/customers/${row.id}`)}
                >
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="min-w-0">
                        <Link
                          to={`/customers/${row.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="block truncate text-[13px] font-semibold text-slate-900 hover:text-emerald-800"
                        >
                          {row.name}
                        </Link>
                        <div className="truncate text-[11px] text-slate-500">
                          {[row.code, row.specialty, row.worksAt].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  {!picked && <td className="px-3 py-2 text-slate-700">{label(row.kind)}</td>}
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{row.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{row.city ?? "—"}</td>
                  {!mine && (
                    <td className="px-3 py-2">
                      {row.medrep ? (
                        <>
                          <div className="font-medium text-slate-800">
                            {row.medrep}
                            {row.manager && (
                              <span className="font-normal text-slate-400"> › {row.manager}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">{row.area ?? "No area"}</div>
                        </>
                      ) : row.deskOwner ? (
                        <>
                          <div className="font-medium text-slate-800">{row.deskOwner}</div>
                          <div className="text-[11px] text-slate-500">Online desk</div>
                        </>
                      ) : (
                        <span className="text-slate-400">Nobody yet</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">
                    {count(row.orders)}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {row.lastOrderAt ? dayLabel(row.lastOrderAt.slice(0, 10)) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.review === "to_review" ? (
                      <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300">
                        Not checked yet
                      </span>
                    ) : (
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                        Checked
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data.rows.length > 0 && (
        // The Leads desk's cards: who they are, under whom, their orders, checked or not.
        <div
          className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 ${view === "table" ? "sm:hidden" : ""} ${query.isPlaceholderData ? "opacity-60" : ""}`}
        >
          {data.rows.map((row) => (
            <CustomerCard
              key={row.id}
              row={row}
              kind={!picked ? label(row.kind) : null}
              mine={Boolean(mine)}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-ink-2">
          Page {data.page} of {pages}
          <Button
            small
            disabled={data.page <= 1}
            onClick={() => set({ page: String(data.page - 1) })}
          >
            Previous
          </Button>
          <Button
            small
            disabled={data.page >= pages}
            onClick={() => set({ page: String(data.page + 1) })}
          >
            Next
          </Button>
        </div>
      )}

      {adding && (
        <CustomerDialog
          can={data.can}
          kinds={data.kinds}
          kind={picked}
          onClose={() => setAdding(false)}
          onSaved={(id) => navigate(`/customers/${id}`)}
        />
      )}
    </div>
  );
}

/** One customer as a card, laid out like the Leads desk's: the name, its number, kind and
 *  place, whom it is under, its orders, and whether Management has checked it. */
function CustomerCard({
  row,
  kind,
  mine,
}: {
  row: CustomerRow;
  /** The kind in words, when the list holds several kinds. */
  kind: string | null;
  mine: boolean;
}) {
  const toCheck = row.review === "to_review";
  return (
    <Link
      to={`/customers/${row.id}`}
      className={`group flex min-w-0 flex-col justify-between rounded-2xl border p-3.5 shadow-sm transition-[border-color,box-shadow] hover:shadow-md ${
        toCheck
          ? "border-amber-200 bg-amber-50/40 hover:border-amber-300"
          : "border-slate-200/90 bg-white hover:border-emerald-300"
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              className="truncate text-sm font-semibold tracking-tight text-slate-900 group-hover:text-emerald-800"
              title={row.name}
            >
              {row.name}
            </h3>
            <div className="truncate text-[11px] font-medium text-slate-500">
              <span className="font-semibold text-slate-700">{row.code}</span>
              {row.specialty ? ` · ${row.specialty}` : ""}
            </div>
          </div>
          {toCheck ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-300">
              Not checked yet
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
              Checked
            </span>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
          {kind && (
            <span
              className={`rounded-full border px-2 py-0.5 font-semibold ${KIND_BADGE[row.kind]?.style ?? "border-slate-200 bg-slate-50 text-slate-700"}`}
            >
              {kind}
            </span>
          )}
          {row.city && (
            <span className="inline-flex max-w-[150px] items-center gap-0.5 truncate text-slate-500">
              <MapPin className="size-2.5 shrink-0 text-slate-400" />
              <span className="truncate">{row.city}</span>
            </span>
          )}
          {row.phone && <span className="text-slate-500 tabular-nums">{row.phone}</span>}
        </div>
        {row.worksAt && (
          <p className="mt-1.5 truncate text-[11px] text-slate-600">Works at {row.worksAt}</p>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px]">
        {!mine ? (
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-slate-400">Under</div>
            {row.medrep ? (
              <div className="truncate font-semibold text-slate-800">
                {row.medrep}
                {row.manager && (
                  <span className="font-normal text-slate-400"> › {row.manager}</span>
                )}
              </div>
            ) : row.deskOwner ? (
              <div className="truncate font-semibold text-slate-800">
                {row.deskOwner} <span className="font-normal text-slate-400">· Online desk</span>
              </div>
            ) : (
              <div className="text-slate-400">Nobody yet</div>
            )}
          </div>
        ) : (
          <span />
        )}
        <div className="shrink-0 text-right">
          <div className="font-semibold text-slate-900 tabular-nums">
            {count(row.orders)} {row.orders === 1 ? "order" : "orders"}
          </div>
          <div
            className={`text-[10px] ${quietDays(row.lastOrderAt) > 45 ? "font-semibold text-amber-700" : "text-slate-500"}`}
          >
            {row.lastOrderAt
              ? `last ${dayLabel(row.lastOrderAt.slice(0, 10))} · ${quietDays(row.lastOrderAt)}d ago`
              : "no order yet"}
          </div>
        </div>
      </div>
      {row.owed > 0 && (
        // What they owe, past due in red; the bar is the credit limit used.
        <div className="mt-2.5 border-t border-slate-100 pt-2">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-slate-500">
              Owes <b className="text-slate-900 tabular-nums">{shortPeso(row.owed)}</b>
            </span>
            {row.overdue > 0 ? (
              <span className="font-semibold text-rose-600 tabular-nums">
                {shortPeso(row.overdue)} past due
              </span>
            ) : (
              <span className="text-emerald-700">Nothing past due</span>
            )}
          </div>
          {row.creditLimit ? (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${row.owed > row.creditLimit ? "bg-rose-500" : row.owed > row.creditLimit * 0.8 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, (row.owed / row.creditLimit) * 100)}%` }}
                title={`Credit limit ${shortPeso(row.creditLimit)}`}
              />
            </div>
          ) : null}
        </div>
      )}
    </Link>
  );
}

/** Days since an order (0 when none). */
function quietDays(iso: string | null): number {
  return iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : 0;
}
