// What a Finance person confirmed, over the days picked (the hub's "My confirmations"): each
// order with when it was checked and its amount, and the total.

import type { MyConfirmations as Confirmed } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday, RangePicker } from "../team/range";
import { Card, count, PageHead, PageState, peso, timeLabel } from "../ui";

export function MyConfirmations() {
  const [params] = useSearchParams();
  const today = manilaToday();
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? today;
  const query = useQuery({
    queryKey: ["finance", "mine", from, to],
    queryFn: () => api<Confirmed>(`/api/finance/my-confirmations?from=${from}&to=${to}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  return (
    <div className="mx-auto max-w-[72rem]">
      <PageHead
        title="My confirmations"
        sub={
          data
            ? `${count(data.rows.length)} ${data.rows.length === 1 ? "order" : "orders"} · ${peso(data.total)}`
            : undefined
        }
      />
      <div className="mb-4">
        <RangePicker />
      </div>
      {!data ? (
        <PageState query={query} what="your confirmations" />
      ) : (
        <Card className="overflow-x-auto">
          {data.rows.length === 0 ? (
            <div className="p-8 text-center text-ink-2">Nothing confirmed on these days.</div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Confirmed</th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Now</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{timeLabel(row.at)}</td>
                    <td>
                      <Link
                        to={`/orders/${row.id}`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {row.code}
                      </Link>
                    </td>
                    <td>{row.customer}</td>
                    <td className="text-slate-600">{row.statusLabel}</td>
                    <td className="num tabular-nums">{peso(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="font-semibold">
                    Total
                  </td>
                  <td className="num font-semibold tabular-nums">{peso(data.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
