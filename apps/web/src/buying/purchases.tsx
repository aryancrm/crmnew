// Purchase orders: everything ordered from suppliers. A table with tabs, as Zoho Inventory
// lists them: date, number, supplier, status, what was ordered, amount, when it is due.

import type { PurchaseList, PurchaseRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Card, dayLabel, PageHead, PageState, peso, Status, Tabs } from "../ui";

type View = "all" | "ordered" | "received" | "cancelled";

export function PurchaseStatus({
  row,
  today,
}: {
  row: Pick<PurchaseRow, "state" | "late" | "expectedOn">;
  today: string;
}) {
  if (row.state === "received") return <Status tone="good">Received</Status>;
  if (row.state === "cancelled") return <Status>Cancelled</Status>;
  return row.late ? (
    <Status tone="bad">Late · was due {dayLabel(row.expectedOn, today)}</Status>
  ) : (
    <Status tone="info">Issued · to be received</Status>
  );
}

export function Purchases() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const view = (params.get("view") ?? "all") as View;
  const query = useQuery({
    queryKey: ["inventory", "purchases"],
    queryFn: () => api<PurchaseList>("/api/purchases"),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the purchase orders" />;
  const of = (state: View) => data.rows.filter((row) => state === "all" || row.state === state);
  const rows = of(view);

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title="Purchase orders"
        sub="What was ordered from suppliers, and what it cost to land"
        actions={
          data.can.purchase && (
            <Link
              to="/purchases/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 font-semibold text-white hover:bg-brand-dark"
            >
              <Plus size={16} aria-hidden="true" /> New purchase order
            </Link>
          )
        }
      >
        <Tabs
          value={view}
          onChange={(key) => setParams(key === "all" ? {} : { view: key }, { replace: true })}
          tabs={[
            { key: "all", label: "All", count: data.rows.length },
            { key: "ordered", label: "To be received", count: of("ordered").length },
            { key: "received", label: "Received", count: of("received").length },
            { key: "cancelled", label: "Cancelled", count: of("cancelled").length },
          ]}
        />
      </PageHead>

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-ink-2">
            {data.rows.length === 0 ? "No purchase order yet." : "Nothing in this list."}
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Purchase order</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Medicines</th>
                <th className="num">Landed amount</th>
                <th>Delivery date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/purchases/${row.id}`)}
                >
                  <td className="whitespace-nowrap">{dayLabel(row.orderedOn, data.today)}</td>
                  <td>
                    <Link
                      to={`/purchases/${row.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-semibold hover:underline"
                    >
                      {row.code}
                    </Link>
                  </td>
                  <td>
                    <div className="font-semibold whitespace-nowrap">{row.supplier}</div>
                    {row.country && <div className="text-[13px] text-ink-2">{row.country}</div>}
                  </td>
                  <td>
                    <PurchaseStatus row={row} today={data.today} />
                  </td>
                  <td className="min-w-48 text-ink-2">{row.lines}</td>
                  <td className="num font-semibold whitespace-nowrap">{peso(row.total)}</td>
                  <td className="whitespace-nowrap">{dayLabel(row.expectedOn, data.today)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
