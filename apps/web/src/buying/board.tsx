// Purchases' first page: what the Inventory and Finance desks act on today — orders still to come
// in, goods in and not billed, bills to pay, credits not used — and what to buy again before it
// runs out (how fast it sells, how long it lasts, who sold it last and at what price). Zoho has no
// such page: its Purchases open on a list.

import type { PurchaseBoard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Factory, PackageCheck, Plus, ReceiptText, ShoppingCart, Undo2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useMay } from "../books/forms";
import { Button, count, PageHead, PageState, Tile } from "../ui";
import { Box, docPath, KIND_WORD, plainState, money, shortMoney, StatePill, TD, TH, TABLE, when, ZohoLink } from "./shared";

export function PurchasesBoard() {
  const may = useMay();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["books", "board"], queryFn: () => api<PurchaseBoard>("/api/buying/board") });
  const data = query.data;
  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Purchases"
        sub="What is coming in, what to bill and pay, and what to buy again before it runs out"
        actions={
          <>
            <ZohoLink to="/books/purchaseorders" />
            <Button onClick={() => navigate("/purchases/vendors")}>
              <Factory size={16} aria-hidden="true" /> Vendors
            </Button>
            {may.order && (
              <Button variant="primary" onClick={() => navigate("/purchases/orders/new")}>
                <Plus size={16} aria-hidden="true" /> New purchase order
              </Button>
            )}
          </>
        }
      />
      <PageState query={query} what="the purchases" />
      {data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              // Orders still open on the first purchase pages are received there: when they are all
              // that is coming, the tile opens them.
              to={data.toReceive.old > 0 && data.toReceive.old === data.toReceive.orders ? "/purchases/old" : "/purchases/orders?stage=to_receive"}
              icon={ShoppingCart}
              label="To receive"
              value={count(data.toReceive.orders)}
              sub={`${count(data.toReceive.pieces)} pieces · ${shortMoney(data.toReceive.value)}${data.toReceive.late ? ` · ${count(data.toReceive.late)} late` : ""}${data.toReceive.old > 0 && data.toReceive.old !== data.toReceive.orders ? ` · ${count(data.toReceive.old)} on the first pages` : ""}`}
              tone={data.toReceive.late ? "bad" : "info"}
            />
            <Tile
              to="/purchases/orders?stage=to_bill"
              icon={PackageCheck}
              label="Received, not billed"
              value={count(data.toBill.orders)}
              sub={data.toBill.orders ? `${shortMoney(data.toBill.value)} of goods without the vendor's bill` : "Every delivery has its bill"}
              tone={data.toBill.orders ? "violet" : "good"}
            />
            <Tile
              to="/purchases/bills?view=overdue"
              icon={ReceiptText}
              label="Bills to pay"
              value={shortMoney(data.bills.owed)}
              sub={`${count(data.bills.open)} bills · ${data.bills.overdue ? `${shortMoney(data.bills.overdueAmount)} overdue` : "none overdue"} · ${shortMoney(data.bills.dueThisWeek)} due this week`}
              tone={data.bills.overdue ? "bad" : "plain"}
            />
            <Tile
              to="/purchases/credits"
              icon={Undo2}
              label="Vendor credits & advances"
              value={shortMoney(data.unusedCredits)}
              sub="Not put on a bill yet: use them on the next bills"
              tone={data.unusedCredits ? "violet" : "plain"}
            />
          </section>

          <Box
            title={
              <>
                Buy again before it runs out{" "}
                <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{count(data.buyMore.length)}</span>
              </>
            }
            aside={<span className="text-[12px] text-slate-500">Medicines at or under their low-stock level</span>}
          >
            {data.buyMore.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                Nothing is under its low-stock level. A medicine's level is set on its page (Edit → Details).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>Medicine</th>
                      <th className={`${TH} text-right`}>Free on the shelf</th>
                      <th className={`${TH} text-right`}>Low at</th>
                      <th className={`${TH} text-right`}>Sold, 30 days</th>
                      <th className={`${TH} text-right`}>Lasts</th>
                      <th className={`${TH} text-right`}>Coming</th>
                      <th className={TH}>Bought last from</th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.buyMore.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className={TD}>
                          <Link to={`/medicines/${row.id}`} className="font-semibold text-slate-900 hover:text-brand">
                            {row.name}
                          </Link>
                          {row.pack && <div className="text-[12px] text-slate-500">{row.pack}</div>}
                        </td>
                        <td className={`${TD} text-right font-semibold tabular-nums ${row.free === 0 ? "text-rose-700" : "text-amber-700"}`}>
                          {count(row.free)}
                          {row.short > 0 && <div className="text-[11px] font-semibold text-rose-700">orders need {count(row.short)} more</div>}
                        </td>
                        <td className={`${TD} text-right tabular-nums text-slate-500`}>{count(row.reorderLevel)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{count(row.sold30)}</td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {row.daysLeft === null ? "—" : row.daysLeft === 0 ? <span className="font-semibold text-rose-700">Out</span> : `${row.daysLeft} days`}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{row.coming ? <span className="font-semibold text-sky-700">{count(row.coming)}</span> : "—"}</td>
                        <td className={TD}>
                          {row.vendor ? (
                            <>
                              <div className="truncate font-medium">{row.vendor}</div>
                              <div className="text-[12px] text-slate-500">
                                {row.lastRate !== null ? `${money(Math.round(row.lastRate * 100), row.lastCurrency ?? "PHP")} a piece` : ""} · {when(row.lastOn, data.today)}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">Never bought here</span>
                          )}
                        </td>
                        <td className={`${TD} text-right`}>
                          {may.order && (
                            <Link
                              to={`/purchases/orders/new?medicine=${row.id}${row.vendorId ? `&vendor=${row.vendorId}` : ""}`}
                              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12.5px] font-semibold text-white hover:bg-brand-dark"
                            >
                              Order
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Box>

          <Box title="Latest in Purchases" aside={<CalendarClock className="size-4 text-slate-400" aria-hidden="true" />}>
            <ul className="divide-y divide-slate-100">
              {data.recent.map((row) => (
                <li key={row.id}>
                  <Link to={docPath(row.kind, row.id)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13.5px] hover:bg-slate-50">
                    <span className="w-28 shrink-0 text-[12px] font-semibold text-slate-500">{KIND_WORD[row.kind] ?? row.kind}</span>
                    <span className="w-28 shrink-0 font-semibold text-brand">{row.number}</span>
                    <span className="min-w-0 flex-1 truncate">{row.party}</span>
                    <span className="text-[12px] text-slate-500">{when(row.date, data.today)}</span>
                    <StatePill state={plainState(row.status)} />
                    <span className="w-32 text-right font-semibold tabular-nums">{row.kind === "purchase_receive" ? "" : money(row.total, row.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Box>
        </>
      )}
    </div>
  );
}
