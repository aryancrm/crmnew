// The stock ledger as three lists, the way Zoho Inventory files them: Adjustments (stock
// counted and corrected), Transfers (stock moved between warehouses) and Receives (stock that
// came in). Nothing is typed here; the lines are written when stock is received, moved or counted.

import type { MoveKind, MoveList } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, Card, count, dayLabel, PageHead, PageState, timeLabel } from "../ui";
import { EmptyState } from "../no-results";

/** Where each is done from: a count or a move starts on the medicine in Stock by warehouse, a
 *  receive on its purchase order (Aryan, 23 Nov: the empty list didn't say where to begin). */
const START: Record<MoveKind, { to: string; label: string }> = {
  adjust: { to: "/inventory", label: "Count a medicine's stock" },
  transfer: { to: "/inventory", label: "Move stock to another warehouse" },
  receive: { to: "/purchases", label: "Receive a purchase order" },
};

const WORDS: Record<MoveKind, { title: string; sub: string; empty: string; emptySub: string }> = {
  adjust: {
    title: "Inventory adjustments",
    sub: "Stock counted on the shelf and corrected",
    empty: "No stock has been adjusted yet.",
    emptySub: "Open a medicine in Stock by warehouse and count it: the correction shows here.",
  },
  transfer: {
    title: "Transfers",
    sub: "Stock moved from one warehouse to another",
    empty: "No stock has been moved between warehouses yet.",
    emptySub: "Open a medicine in Stock by warehouse and move it: the move shows here.",
  },
  receive: {
    title: "Receives",
    sub: "Stock that came in, by batch",
    empty: "Nothing has been received yet.",
    emptySub: "Receive a purchase order to bring stock in.",
  },
};

export function Moves({ kind }: { kind: MoveKind }) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page")) || 1;
  const query = useQuery({
    queryKey: ["inventory", "moves", kind, page],
    queryFn: () => api<MoveList>(`/api/moves?kind=${kind}&page=${page}`),
    placeholderData: (previous) => previous,
  });
  const words = WORDS[kind];
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title={words.title}
        sub={
          data
            ? `${words.sub} · ${count(data.total)} ${data.total === 1 ? "line" : "lines"}`
            : words.sub
        }
        actions={
          <Link to={START[kind].to} className="inline-flex h-10 items-center rounded-[10px] bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark">
            {START[kind].label}
          </Link>
        }
      />
      {!data ? (
        <PageState query={query} what={words.title.toLowerCase()} />
      ) : data.rows.length === 0 ? (
        <Card>
          <EmptyState title={words.empty}>{words.emptySub}</EmptyState>
        </Card>
      ) : (
        <>
          <Card className={`overflow-x-auto ${query.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>{kind === "transfer" ? "From" : "Warehouse"}</th>
                  {kind === "transfer" && <th>To</th>}
                  <th className="num">{kind === "adjust" ? "Change" : "Pieces"}</th>
                  <th>{kind === "receive" ? "Reference" : "Reason"}</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{timeLabel(row.at)}</td>
                    <td>
                      <Link
                        to={`/medicines/${row.medicineId}`}
                        className="font-semibold whitespace-nowrap hover:underline"
                      >
                        {row.medicine}
                      </Link>
                    </td>
                    <td>{row.batchNo}</td>
                    <td className="whitespace-nowrap">{dayLabel(row.expiresOn)}</td>
                    <td className="whitespace-nowrap">{row.warehouse}</td>
                    {kind === "transfer" && (
                      <td className="whitespace-nowrap">{row.toWarehouse ?? "—"}</td>
                    )}
                    <td
                      className={`num font-semibold ${kind === "adjust" ? (row.qty > 0 ? "text-good" : "text-bad") : ""}`}
                    >
                      {kind === "adjust" && row.qty > 0 ? "+" : ""}
                      {count(kind === "transfer" ? Math.abs(row.qty) : row.qty)}
                    </td>
                    <td className="text-ink-2">
                      {(kind === "receive" ? row.ref : row.note) ?? row.note ?? row.ref ?? "—"}
                    </td>
                    <td className="whitespace-nowrap">{row.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-ink-2">
              Page {data.page} of {pages}
              <Button
                small
                disabled={data.page <= 1}
                onClick={() => setParams({ page: String(data.page - 1) })}
              >
                Previous
              </Button>
              <Button
                small
                disabled={data.page >= pages}
                onClick={() => setParams({ page: String(data.page + 1) })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
