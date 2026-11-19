// A telesales team at a glance (Aryan, 19 Nov: "MD Telesales: who under Honey does how much, the
// sales they made, A to Z"; Reynan's TeleSales): each person's calls today and this month, what
// came of them, the callbacks due, orders (here and in Zoho) and the share of calls that became
// orders, new customers against repeat ones, orders stopped. Sold and owed per person are in the
// channel's panel above it.

import type { TelesalesTeam } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { withUnit } from "../team/switch";
import { CARD } from "../ui";

/** The seat's area after its channel ("HOS | Makati" → Makati), unless it is the seller's own name. */
const placeOf = (one: TelesalesTeam["rows"][number]) => {
  const place = one.area?.split("|").slice(1).join("|").trim();
  if (!place) return null;
  const first = one.name.split(" ")[0]?.toLowerCase() ?? "";
  return place.toLowerCase().startsWith(first) ? null : place;
};

export function TelesalesTeamCard({ unit = null }: { unit?: number | null }) {
  const query = useQuery({
    queryKey: ["telesales", "team", unit ?? ""],
    queryFn: () => api<TelesalesTeam>(withUnit("/api/telesales/team", unit ? String(unit) : null)),
  });
  const data = query.data;
  if (!data || data.rows.length === 0) return null;
  const s = data.summary;
  // Until the team logs its calls here, the call figures fold into one tile and the table drops
  // their columns (rows of dashes say nothing).
  const calls = s.callsMonth > 0;
  // Sold, target and owed per person are in the channel's panel right above; this card adds what
  // the panel lacks: the calls and what came of them, the orders, new customers against repeat.
  const tiles: [string, string, string][] = [
    ...(calls
      ? ([
          ["Calls today", String(s.callsToday), `${s.callsMonth} this month`],
          ["Reached", String(s.reached), `${s.ordered} ended in an order`],
          ["Conversion", s.conversion === null ? "—" : `${s.conversion}%`, "calls to orders this month"],
          ["Callbacks due", String(s.callbacksDue), "promised for today or before"],
        ] as [string, string, string][])
      : ([["Calls", "None logged", "each call is logged under Calls"]] as [string, string, string][])),
    ["Orders", String(s.orders), s.stopped ? `this month · ${s.stopped} stopped now` : "this month, here and in Zoho"],
    ["New customers", String(s.newCustomers), "first order with us this month"],
    ["Repeat customers", String(s.repeatCustomers), "ordered before this month too"],
  ];
  return (
    <div className="space-y-3">
      <section className={`grid grid-cols-2 gap-3 ${calls ? "sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-4"}`}>
        {tiles.map(([label, value, hint]) => (
          <div key={label} className={`${CARD} p-3`}>
            <p className="text-[12px] text-slate-500">{label}</p>
            <p className={`mt-1 font-semibold tabular-nums ${value === "None logged" ? "text-base text-slate-500" : "text-xl text-slate-900"}`}>{value}</p>
            <p className="truncate text-[11.5px] text-slate-500" title={hint}>
              {hint}
            </p>
          </div>
        ))}
      </section>
      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
          Each person{" "}
          <span className="font-normal text-slate-400">
            · {calls ? "calls, " : ""}orders (here and in Zoho) and customers this month
          </span>
        </h3>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
              <th className="px-4 py-2">Person</th>
              {calls && (
                <>
                  <th className="px-3 py-2 text-right">Calls today</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Reached</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Callbacks due</th>
                </>
              )}
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">New customers</th>
              <th className="px-3 py-2 text-right">Repeat customers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...data.rows]
              .sort((a, b) => b.orders - a.orders || b.sold - a.sold)
              .map((one) => (
                <tr key={one.seatId}>
                  <td className="px-4 py-2">
                    <span className="font-semibold text-slate-900">{one.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      {[one.title, placeOf(one)].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  {calls && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">{one.callsToday || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{one.callsMonth || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{one.reached || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{one.ordered || "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${one.callbacksDue ? "font-semibold text-amber-700" : ""}`}>
                        {one.callbacksDue || "—"}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {one.orders || "—"}
                    {one.stopped > 0 && <span className="block text-[11px] text-rose-700">{one.stopped} stopped</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.newCustomers || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.customers - one.newCustomers || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
