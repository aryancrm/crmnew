// Dispatch's stock news, as every screen shows it.

import type { NewsKind, StockNews } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Pill, timeLabel } from "../ui";

const KIND: Record<NewsKind, { label: string; tone: "bad" | "warn" | "good" | "plain" }> = {
  out: { label: "Out of stock", tone: "bad" },
  low: { label: "Low stock", tone: "warn" },
  back: { label: "Back in stock", tone: "good" },
  note: { label: "Note", tone: "plain" },
};

export function NewsList({ news, canClose }: { news: StockNews[]; canClose?: boolean }) {
  const queries = useQueryClient();
  async function close(id: number) {
    await api(`/api/stock-news/${id}/close`, { method: "POST" }).catch(() => undefined);
    await queries.invalidateQueries({ queryKey: ["inventory"] });
  }
  return (
    <ul className="flex flex-col">
      {news.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2.5 last:border-b-0"
        >
          <Link to={`/medicines/${item.medicineId}`} className="font-medium hover:text-brand">
            {item.medicine}
          </Link>
          <Pill tone={KIND[item.kind].tone}>{KIND[item.kind].label}</Pill>
          {item.message && (
            <span className="min-w-0 flex-1 basis-40 text-ink-2">{item.message}</span>
          )}
          <span className="ml-auto text-xs text-ink-2">
            {item.by} · {timeLabel(item.at)}
          </span>
          {canClose && (
            <button
              type="button"
              onClick={() => close(item.id)}
              className="text-[13px] font-medium text-brand"
            >
              Take down
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
