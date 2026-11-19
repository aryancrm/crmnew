// The Divisions app (Aryan, 19 Nov: "an app named for each division: Hospital, RX, every channel;
// a press opens all of its data"): each head's channels as tiles, in the sales tracker's order and
// words, each with its manager, its people, what it sold against the month's target at the CRM's
// one pace; a press opens the channel's own page (its people, orders, customers and figures).

import type { TeamBoard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { reportRange } from "../team/range";
import { PageState } from "../ui";
import { build, COLOR, type Node, pctOf, toneOfNode } from "./sales-tree";

export function DivisionsPage() {
  const { from, to } = reportRange(new URLSearchParams());
  const board = useQuery({
    queryKey: ["team", "board", "", from, to],
    queryFn: () => api<TeamBoard>(`/api/team/board?from=${from}&to=${to}`),
  });
  if (!board.data) return <PageState query={board} what="the divisions" />;
  const data = board.data;
  const tree = build(data, false);
  const heads = tree.level === "root" ? tree.children : [tree];
  const month = new Date(`${data.from}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Divisions</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Each channel of the sales tracker, {month}: press one for all of its data.
          </p>
        </div>
        <Link to="/company/sales" className="text-[13px] font-semibold text-emerald-700 hover:underline">
          The whole tree →
        </Link>
      </header>
      {heads.map((head) => (
        <section key={head.key}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-[15px] font-semibold text-slate-900">{head.name}</h2>
            <span className="text-[12px] text-slate-500">{head.sub}</span>
            <Share node={head} pace={data.pace} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {head.children.map((channel) => (
              <Tile key={channel.key} channel={channel} pace={data.pace} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Share({ node, pace }: { node: Node; pace: number }) {
  const share = pctOf(node.figures);
  return (
    <span className="text-[13px] font-bold tabular-nums" style={{ color: COLOR[toneOfNode(node, pace)] }}>
      {share === null ? shortPeso(node.figures.sold) : `${share}%`}
    </span>
  );
}

/** One channel: its code, name, manager, people, sold of target, the bar with the pace mark. */
function Tile({ channel, pace }: { channel: Node; pace: number }) {
  const share = pctOf(channel.figures);
  const tone = toneOfNode(channel, pace);
  const managers = channel.children.filter((one) => one.level === "manager").map((one) => one.name);
  return (
    <Link
      to={channel.unit ? `/my-team?unit=${channel.unit.id}` : "/my-team"}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-px hover:border-emerald-300 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl text-[12px] font-bold text-white"
          style={{ background: channel.hue }}
        >
          {channel.code}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-900 group-hover:text-emerald-800">
            {channel.name}
          </span>
          <span className="block truncate text-[12px] text-slate-500">
            {managers.length ? `${managers.length > 1 ? "Managers" : "Manager"}: ${managers.join(", ")}` : channel.sub}
          </span>
        </span>
        <span className="text-[15px] font-bold tabular-nums" style={{ color: COLOR[tone] }}>
          {share === null ? "—" : `${share}%`}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-slate-200">
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, share ?? 0)}%`, background: COLOR[tone] }} />
        <div className="absolute -top-0.5 h-3 w-[2px] rounded bg-slate-500" style={{ left: `${Math.min(100, pace * 100)}%` }} />
      </div>
      <div className="flex justify-between text-[12px] text-slate-600">
        <span>
          <b className="text-slate-900">{shortPeso(channel.figures.sold)}</b> of{" "}
          {channel.figures.target ? shortPeso(channel.figures.target) : "no target"}
        </span>
        <span>
          {channel.figures.people} people{channel.figures.vacant ? ` · ${channel.figures.vacant} vacant` : ""}
        </span>
      </div>
    </Link>
  );
}
