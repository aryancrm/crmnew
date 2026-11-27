// Reports: sales by channel (each channel's sales against its people's targets, its head, its
// team by who reports to whom, its areas and customers), sales by person, and the company tree.

import { LeavesArrow } from "../app-switch";
import type { ChannelFigures, ChannelReport, ChannelSalesDetail, MonthFacts } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Network, User, Users } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { EmptyState, NoInvoicesArt } from "../no-results";
import { reportsFor } from "../books/reports";
import { exactPeso, monthName, shiftMonth, shortPeso } from "../ceo";
import { Bars } from "../team/charts";
import { Card, count, PageHead, PageState } from "../ui";

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

/** The books' reports this person opens (sales, stock, taxes; the statements for the money desks). */
function MoreReports() {
  const me = useMe();
  const shown = reportsFor(me.data?.role ?? "");
  if (!shown.length) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">More reports</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((one) => (
          <Link key={one.key} to={`/books/reports/${one.key}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-emerald-300">
            <div className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
              {one.title} <LeavesArrow app="Books" className="text-slate-500" />
            </div>
            <div className="text-xs text-slate-500">{one.about}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

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
      <MoreReports />
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
      {/* Each channel against its target; opening one shows its sales inside: who sold, to
          whom, which medicines. Data only: the company's tree is in Company. */}
      <section className="space-y-2">
        {[...data.channels]
          .sort((a, b) => (figuresOf(b.code)?.sold ?? 0) - (figuresOf(a.code)?.sold ?? 0))
          .map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              figures={figuresOf(channel.code)}
              month={month?.month ?? ""}
              pace={month?.pace ?? 1}
            />
          ))}
      </section>
    </div>
  );
}

const toneBar = (sold: number, target: number | null, pace: number) =>
  !target
    ? "bg-slate-400"
    : sold / target >= pace
      ? "bg-emerald-500"
      : sold / target >= pace / 2
        ? "bg-amber-400"
        : "bg-rose-500";

/** One channel: its head, its sold against its target; opened, its sellers, customers and
 *  medicines for the month. */
function ChannelRow({
  channel,
  figures,
  month,
  pace,
}: {
  channel: ChannelReport["channels"][number];
  figures: ChannelFigures | undefined;
  month: string;
  pace: number;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["reports", "channel-sales", channel.code, month],
    queryFn: () =>
      api<ChannelSalesDetail>(
        `/api/channel-sales/${channel.code}${month ? `?month=${month}` : ""}`,
      ),
    enabled: open,
  });
  const sold = figures?.sold ?? 0;
  const target = figures?.target ?? null;
  return (
    <div
      id={channel.code}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="grid w-full grid-cols-[1.25rem_minmax(0,1.4fr)_minmax(0,2fr)_6rem] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 md:grid-cols-[1.25rem_minmax(0,1.4fr)_minmax(0,2fr)_6rem_10rem]"
      >
        {open ? (
          <ChevronDown className="size-4 text-slate-400" />
        ) : (
          <ChevronRight className="size-4 text-slate-400" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {channel.code} · {channel.name}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {channel.head ? channel.head.name : "No head named"} · {channel.people} people ·{" "}
            {count(channel.customers)} customers
          </span>
        </span>
        <span className="relative h-2.5 rounded-full bg-slate-100">
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${toneBar(sold, target, pace)}`}
            style={{ width: `${target ? Math.min(100, (sold / target) * 100) : sold ? 100 : 0}%` }}
          />
        </span>
        <span className="text-right text-sm font-semibold tabular-nums" title={exactPeso(sold)}>
          {shortPeso(sold)}
        </span>
        <span className="hidden text-right text-xs text-slate-500 md:block">
          {target ? `${Math.round((sold / target) * 100)}% of ${shortPeso(target)}` : "No target"}
          {figures?.today ? ` · today ${shortPeso(figures.today)}` : ""}
        </span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-100 bg-slate-50/50 p-4 lg:grid-cols-3">
          {!detail.data ? (
            <p className="text-sm text-slate-500">
              {detail.isError ? "Couldn't read it." : "Reading…"}
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold text-slate-700">Who sold</h3>
                {detail.data.people.length ? (
                  <Bars
                    rows={detail.data.people.map((person) => ({
                      key: person.id,
                      label: person.name,
                      sub: [
                        person.area,
                        `${person.orders} ${person.orders === 1 ? "order" : "orders"}`,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      value: person.sold,
                      mark: person.target,
                      tone: toneBar(person.sold, person.target, pace),
                    }))}
                  />
                ) : (
                  <EmptyState art={<NoInvoicesArt size={72} />} title="Nobody in this channel yet.">
                    The people in this channel show here with what each sold.
                  </EmptyState>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold text-slate-700">Customers</h3>
                {detail.data.customers.length ? (
                  <Bars
                    rows={detail.data.customers.map((customer) => ({
                      key: customer.id,
                      label: customer.name,
                      sub: `${customer.orders} ${customer.orders === 1 ? "order" : "orders"}`,
                      value: customer.sold,
                    }))}
                    color="bg-violet-500"
                  />
                ) : (
                  <EmptyState art={<NoInvoicesArt size={72} />} title="No sale this month.">
                    Customers who bought this month show here with their orders.
                  </EmptyState>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold text-slate-700">Medicines</h3>
                {detail.data.medicines.length ? (
                  <Bars
                    rows={detail.data.medicines.map((medicine) => ({
                      key: medicine.name,
                      label: medicine.name,
                      sub: `${count(medicine.qty)} pcs`,
                      value: medicine.value,
                    }))}
                    color="bg-sky-500"
                  />
                ) : (
                  <EmptyState art={<NoInvoicesArt size={72} />} title="No sale this month.">
                    Medicines sold this month show here with the pieces sold.
                  </EmptyState>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
