// Reports: sales by channel (each channel's sales against its people's targets, its head, its
// team by who reports to whom, its areas and customers), sales by person, and the company tree.

import type { ChannelFigures, ChannelPerson, ChannelReport, MonthFacts } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Network, User, Users } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, monthName, shiftMonth, shortPeso } from "../ceo";
import { Card, count, PageHead, PageState, Pill } from "../ui";
import { PACE_TEXT, PaceBar } from "./ceo-home";

const REPORTS = [
  {
    to: "/reports/channels",
    icon: Users,
    tint: "bg-violet-50 text-violet-700",
    name: "Sales by channel",
    line: "Each channel against its target, its head, its team, its areas and customers",
  },
  {
    to: "/team",
    icon: User,
    tint: "bg-emerald-50 text-emerald-700",
    name: "Sales by person",
    line: "Every seller against their target, by who reports to whom",
  },
  {
    to: "/company",
    icon: Network,
    tint: "bg-fuchsia-50 text-fuchsia-700",
    name: "Company tree",
    line: "The CEO, the channels, their heads and teams, each area with its month",
  },
];

export function Reports() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHead title="Reports" />
      <Card>
        {REPORTS.map((report) => (
          <Link
            key={report.to}
            to={report.to}
            className="flex items-center gap-3 border-b border-line-soft px-5 py-4 last:border-b-0 hover:bg-hover"
          >
            <span className={`flex size-10 items-center justify-center rounded-xl ${report.tint}`}>
              <report.icon size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{report.name}</div>
              <div className="text-[13px] text-ink-2">{report.line}</div>
            </div>
            <ChevronRight size={18} className="text-slate-300" aria-hidden="true" />
          </Link>
        ))}
      </Card>
    </div>
  );
}

export function ChannelsReport() {
  const [params] = useSearchParams();
  const asked = params.get("month") ?? "";
  const query = useQuery({
    queryKey: ["reports", "channels"],
    queryFn: () => api<ChannelReport>("/api/reports/channels"),
  });
  const sales = useQuery({
    queryKey: ["reports", "channel-sales", asked],
    queryFn: () =>
      api<MonthFacts & { channels: ChannelFigures[] }>(`/api/channel-sales?month=${asked}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the channels" />;
  const people = data.channels.reduce((sum, channel) => sum + channel.people, 0);
  const month = sales.data;
  const figuresOf = (code: string) => month?.channels.find((row) => row.code === code);
  const current = month?.today.slice(0, 7) ?? "";
  const href = (value: string) =>
    value >= current ? "/reports/channels" : `/reports/channels?month=${value}`;
  const sold = month?.channels.reduce((sum, row) => sum + row.sold, 0) ?? 0;

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title="Sales by channel"
        sub={`${data.channels.length} channels · ${count(people)} people${month ? ` · ${shortPeso(sold)} sold in ${monthName(month.month)}` : ""}. Sold is what Finance invoiced.`}
        actions={
          month && (
            <nav
              aria-label="Month"
              className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5"
            >
              <Link
                to={href(shiftMonth(month.month, -1))}
                aria-label="Previous month"
                className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <ChevronLeft className="size-4" />
              </Link>
              <span className="min-w-32 px-1 text-center text-sm font-semibold">
                {monthName(month.month)}
              </span>
              {month.running ? (
                <span aria-hidden className="grid size-8 place-items-center text-slate-300">
                  <ChevronRight className="size-4" />
                </span>
              ) : (
                <Link
                  to={href(shiftMonth(month.month, 1))}
                  aria-label="Next month"
                  className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
                >
                  <ChevronRight className="size-4" />
                </Link>
              )}
            </nav>
          )
        }
      />
      <Card className="mb-4 overflow-x-auto">
        <table className="t">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Head</th>
              <th className="min-w-44">Against target</th>
              <th className="num">Sold</th>
              <th className="num">Target</th>
              <th className="num">People</th>
              <th className="num">MedReps</th>
              <th className="num">Areas</th>
              <th className="num">Customers</th>
            </tr>
          </thead>
          <tbody>
            {data.channels.map((channel) => (
              <tr key={channel.id}>
                <td>
                  <a href={`#${channel.code}`} className="font-semibold">
                    {channel.code}
                  </a>
                  <span className="text-ink-2"> · {channel.name}</span>
                </td>
                <td>
                  {channel.head ? (
                    channel.head.name
                  ) : (
                    <span className="text-ink-2">No head named</span>
                  )}
                </td>
                <td>
                  {(() => {
                    const figures = figuresOf(channel.code);
                    if (!figures)
                      return (
                        <span className="text-ink-2">{sales.isError ? "Couldn't read" : "…"}</span>
                      );
                    return (
                      <span className="flex items-center gap-2">
                        <span className="flex-1">
                          <PaceBar
                            pct={figures.pct}
                            pace={month?.running ? month.pace : null}
                            tone={figures.tone}
                          />
                        </span>
                        <span
                          className={`w-10 text-right text-[13px] tabular-nums ${figures.pct === null ? "text-slate-400" : `font-semibold ${PACE_TEXT[figures.tone]}`}`}
                        >
                          {figures.pct === null ? "—" : `${Math.round(figures.pct)}%`}
                        </span>
                      </span>
                    );
                  })()}
                </td>
                <td
                  className="num font-semibold whitespace-nowrap"
                  title={exactPeso(figuresOf(channel.code)?.sold ?? 0)}
                >
                  {shortPeso(figuresOf(channel.code)?.sold ?? 0)}
                </td>
                <td className="num whitespace-nowrap text-ink-2">
                  {figuresOf(channel.code)?.target != null
                    ? shortPeso(figuresOf(channel.code)?.target ?? 0)
                    : "—"}
                </td>
                <td className="num">{count(channel.people)}</td>
                <td className="num">{count(channel.medreps)}</td>
                <td className="num">{count(channel.areas)}</td>
                <td className="num">{count(channel.customers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {data.channels.map((channel) => (
          <Card key={channel.id} className="scroll-mt-20 p-5">
            <div id={channel.code} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-base font-semibold">{channel.code}</span>
                <span className="text-ink-2"> · {channel.name}</span>
              </div>
              {channel.head ? (
                <Pill tone="brand">Head: {channel.head.name}</Pill>
              ) : (
                <Pill tone="warn">No head named</Pill>
              )}
            </div>
            {channel.tree.length === 0 ? (
              <div className="mt-3 text-[13px] text-ink-2">Nobody works in this channel yet.</div>
            ) : (
              <ul className="mt-3 flex flex-col">
                {channel.tree.map((person) => (
                  <PersonRow key={person.id} person={person} depth={0} headId={channel.head?.id} />
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function PersonRow({
  person,
  depth,
  headId,
}: {
  person: ChannelPerson;
  depth: number;
  headId?: number;
}) {
  return (
    <>
      <li
        className="flex flex-wrap items-center gap-x-2 border-b border-line-soft py-2 last:border-b-0"
        style={{ paddingLeft: depth * 20 }}
      >
        {depth > 0 && (
          <span className="text-slate-300" aria-hidden="true">
            └
          </span>
        )}
        <span className="text-[13px] font-semibold">{person.name}</span>
        <span className="text-[13px] text-ink-2">
          {[person.title ?? person.roleLabel, person.area].filter(Boolean).join(" · ")}
        </span>
        {person.id === headId && <Pill tone="brand">Head</Pill>}
      </li>
      {person.team.map((member) => (
        <PersonRow key={member.id} person={member} depth={depth + 1} headId={headId} />
      ))}
    </>
  );
}
