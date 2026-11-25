// The department's side of the sign-in page as a collage (Aryan, 24 Nov, after a picture he gave):
// white dashboard cards, tilted, on an orange-red sky, with two floating logo tiles. The cards hold
// what the side held before: the department's name and line, its last 30 days (counts only, as
// before: no money and nobody's name before signing in), what it handles, and the systems it works
// with. The chart's blocks are only a picture; the numbers on it are the real counts.

import type { PortalDepartment } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CircleCheck, Eye, EllipsisVertical, Link2, Route, Users, Wallet } from "lucide-react";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { type Workspace, WORKSPACES } from "../workspaces";
import "./department-collage.css";
import { DEPARTMENTS } from "./departments";
import { heroLogo } from "./hero-logos";

/** The three systems each department works with most, for the chart's legend and the second tile. */
const WORKS_WITH: Record<string, [string, string, string]> = {
  sales: ["management", "finance", "dispatch"],
  leads: ["sales", "management", "heads"],
  heads: ["sales", "leads", "ceo"],
  management: ["sales", "finance", "inventory"],
  finance: ["management", "dispatch", "books"],
  dispatch: ["finance", "inventory", "sales"],
  inventory: ["dispatch", "management", "books"],
  online: ["sales", "management", "dispatch"],
  hr: ["office", "ceo", "admin"],
  regulatory: ["inventory", "management", "ceo"],
  office: ["hr", "admin", "ceo"],
  ceo: ["sales", "finance", "hr"],
  admin: ["hr", "office", "ceo"],
  books: ["finance", "ceo", "inventory"],
};

const nameOf = (key: string) => WORKSPACES.find((one) => one.key === key)?.label ?? key;

/** The last three months' short names, oldest first. */
function lastMonths() {
  const now = new Date();
  return [2, 1, 0].map((back) => new Date(now.getFullYear(), now.getMonth() - back, 1).toLocaleString("en-US", { month: "short" }));
}

/** The canvas is drawn at this size and scaled to the panel's height. */
const CANVAS_H = 920;

type Stat = { label: string; value: string };

function useStats(workspace: Workspace): Stat[] | null {
  const data = useQuery({
    queryKey: ["portal", "department", workspace.key],
    queryFn: () => api<PortalDepartment>(`/api/portal/departments/${workspace.key}`),
    staleTime: 60_000,
    retry: 1,
  });
  const page = data.data;
  if (!page) return null;
  return [
    ...page.stats.map((one) => ({
      label: one.label,
      value:
        one.value === null
          ? "—"
          : one.unit === "days"
            ? one.value === 0
              ? "Same day"
              : `${one.value} ${one.value === 1 ? "day" : "days"}`
            : one.value.toLocaleString("en-PH"),
    })),
    { label: "Team members", value: page.people.toLocaleString("en-PH") },
  ].slice(0, 4);
}

function Card(props: { className: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`dc-card ${props.className}`} style={props.style}>
      <EllipsisVertical className="dc-card__more" aria-hidden="true" />
      {props.children}
    </div>
  );
}

/** A count card: the icon in its soft square, the label, the big number, the green chip. */
function StatCard(props: { className: string; icon: ReactNode; tone: string; stat: Stat | undefined }) {
  return (
    <Card className={`dc-stat ${props.className}`}>
      <div className="dc-stat__head">
        <span className="dc-stat__icon" style={{ "--tone": props.tone } as CSSProperties}>
          {props.icon}
        </span>
        <span>{props.stat?.label ?? "…"}</span>
      </div>
      <b className="dc-stat__value">{props.stat?.value ?? "—"}</b>
      <div className="dc-stat__foot">
        <span className="dc-chip">
          Live <ArrowUpRight aria-hidden="true" />
        </span>
        <span>last 30 days</span>
      </div>
    </Card>
  );
}

/** The chart: rounded blocks stacked in three colours, faint ones between, as in the picture. */
const SERIES = ["#12c27a", "#ffcf6e", "#ec5b13"];
const COLUMNS = [
  { x: 0, blocks: [70, 44, 40], faded: true },
  { x: 88, blocks: [64, 48, 36], faded: false },
  { x: 176, blocks: [52, 40, 50], faded: false },
  { x: 264, blocks: [78, 42, 60], faded: false },
];

function Chart(props: { labels: [string, string]; months: string[] }) {
  return (
    <div className="dc-chart" aria-hidden="true">
      {/* The faint shapes joining one column to the next. */}
      <svg className="dc-chart__links" viewBox="0 0 330 230" preserveAspectRatio="none">
        <path d="M64 70 L88 40 L88 120 L64 150 Z" fill="#12c27a" opacity=".12" />
        <path d="M152 40 L176 90 L176 170 L152 140 Z" fill="#ffcf6e" opacity=".22" />
        <path d="M240 90 L264 30 L264 120 L240 170 Z" fill="#12c27a" opacity=".12" />
        <path d="M64 150 L88 170 L88 225 L64 225 Z" fill="#ec5b13" opacity=".1" />
        <path d="M152 170 L176 175 L176 225 L152 225 Z" fill="#ec5b13" opacity=".1" />
      </svg>
      {COLUMNS.map((column, c) => {
        let top = 230;
        return column.blocks.map((height, s) => {
          top -= height + 6;
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed picture
              key={`${c}-${s}`}
              className="dc-chart__block"
              style={{
                left: column.x,
                top: top - (c === 3 ? 30 : c === 1 ? 10 : 0),
                height,
                background: SERIES[2 - s],
                opacity: column.faded ? 0.18 : 1,
              }}
            />
          );
        });
      })}
      <span className="dc-chart__label" style={{ left: 54, top: 6 }}>
        {props.labels[0]}
      </span>
      <span className="dc-chart__label" style={{ left: 236, top: -36 }}>
        {props.labels[1]}
      </span>
      <span className="dc-chart__month" style={{ left: 128, top: 246 }}>
        {props.months[1]}
      </span>
      <span className="dc-chart__month" style={{ left: 282, top: 216 }}>
        {props.months[2]}
      </span>
    </div>
  );
}

function Legend({ keys }: { keys: string[] }) {
  return (
    <div className="dc-legend">
      {keys.map((key, i) => (
        <span key={key}>
          <i style={{ background: SERIES[i] }} />
          {nameOf(key)}
        </span>
      ))}
    </div>
  );
}

/** A floating white tile with one system's logo. */
function LogoTile(props: { system: string; className: string }) {
  return (
    <span className={`dc-tile ${props.className}`}>
      <img src={heroLogo(props.system)} alt="" />
    </span>
  );
}

export function DepartmentCollage({ workspace, brand }: { workspace: Workspace; brand: ReactNode }) {
  const info = DEPARTMENTS[workspace.key];
  const stats = useStats(workspace);
  const withKeys = WORKS_WITH[workspace.key] ?? ["sales", "management", "finance"];
  const months = lastMonths();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // The canvas keeps its proportions and fills the panel's height.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.45, el.offsetHeight / CANVAS_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="dc" ref={box}>
      <div className="dc-sky" aria-hidden="true">
        <span className="dc-sky__swirl dc-sky__swirl--1" />
        <span className="dc-sky__swirl dc-sky__swirl--2" />
        <span className="dc-sky__swirl dc-sky__swirl--3" />
      </div>

      <div className="dc-canvas" style={{ "--k": scale } as CSSProperties}>
        {/* Left column: the chart, a count with a logo tile, what it handles. */}
        <Card className="dc-chartcard dc-card--raised">
          <div className="dc-title">
            <img src={heroLogo(workspace.key)} alt="" />
            <span>
              <b>{workspace.label}</b>
              <small>{info?.about ?? workspace.about}</small>
            </span>
          </div>
          <Chart labels={[stats?.[1]?.value ?? "—", stats?.[0]?.value ?? "—"]} months={months} />
          <Legend keys={withKeys} />
        </Card>

        <StatCard className="dc-stat--a" icon={<Wallet aria-hidden="true" />} tone="#12c27a" stat={stats?.[0]} />
        <LogoTile system={withKeys[0]} className="dc-tile--b" />

        <Card className="dc-handles">
          <div className="dc-stat__head">
            <span className="dc-stat__icon" style={{ "--tone": "#ec5b13" } as CSSProperties}>
              <CircleCheck aria-hidden="true" />
            </span>
            <span>What it handles</span>
          </div>
          <ul>
            {(info?.handles ?? []).slice(0, 4).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>

        {/* Right column: the legend's tail, two counts with the department's own logo, the team. */}
        <Card className="dc-tail">
          <span className="dc-tail__month">{months[0]}</span>
          <Legend keys={withKeys.slice(0, 2)} />
        </Card>

        <StatCard className="dc-stat--b" icon={<Wallet aria-hidden="true" />} tone="#12c27a" stat={stats?.[1]} />
        <LogoTile system={workspace.key} className="dc-tile--a" />
        <StatCard className="dc-stat--c" icon={<Eye aria-hidden="true" />} tone="#7c6cf0" stat={stats?.[2]} />
        <StatCard className="dc-stat--d" icon={<Users aria-hidden="true" />} tone="#ec5b13" stat={stats?.[3]} />

        {/* Third column: how work moves through the desk, and the systems it works with. */}
        <Card className="dc-flow">
          <div className="dc-stat__head">
            <span className="dc-stat__icon" style={{ "--tone": "#2563eb" } as CSSProperties}>
              <Route aria-hidden="true" />
            </span>
            <span>How work moves</span>
          </div>
          <ol>
            {(info?.flow ?? []).slice(0, 4).map((one, i) => (
              <li key={one.step}>
                <i>{i + 1}</i>
                <span>
                  {one.step}
                  <small>{one.who}</small>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="dc-with dc-card--raised">
          <div className="dc-stat__head">
            <span className="dc-stat__icon" style={{ "--tone": "#7c6cf0" } as CSSProperties}>
              <Link2 aria-hidden="true" />
            </span>
            <span>Works with</span>
          </div>
          <ul>
            {withKeys.map((key) => (
              <li key={key}>
                <img src={heroLogo(key)} alt="" />
                {nameOf(key)}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="dc-tail dc-tail--b">
          <span className="dc-tail__month">{months[2]}</span>
          <Legend keys={withKeys.slice(1, 3)} />
        </Card>
      </div>

      <div className="dc-brand">{brand}</div>
    </div>
  );
}
