// A department's page on the portal (Aryan, 18 Nov, after his mock-up): who it is, what went well
// in its last 30 days, what it handles, the sign-in in the middle (the same box for everyone), its
// team as a chart and how work moves through it. Before signing in only counts and seat titles go
// out: no money and nobody's name.

import type { PortalDepartment, PortalTeamNode } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  X,
  BookOpen,
  Box,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  FlaskConical,
  Home,
  Inbox,
  KeyRound,
  Landmark,
  MapPin,
  MessageCircle,
  Network,
  Package,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  Workflow,
} from "lucide-react";
import { type ComponentType, type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import type { Workspace } from "../workspaces";
import { DEPARTMENTS, FLOW_ICONS, SEAT_DOES } from "./departments";
import { TILE_GLOW, TILE_ICONS } from "./tiles";

type Icon = ComponentType<{ className?: string; style?: CSSProperties }>;
const ICONS: Record<string, Icon> = {
  arrow: ArrowRight,
  bank: Landmark,
  book: BookOpen,
  box: Box,
  calendar: Calendar,
  card: CreditCard,
  cart: ShoppingCart,
  chart: BarChart3,
  chat: MessageCircle,
  check: CheckCircle2,
  clipboard: ClipboardList,
  clock: Clock,
  file: FileText,
  flask: FlaskConical,
  home: Home,
  inbox: Inbox,
  key: KeyRound,
  map: MapPin,
  network: Network,
  package: Package,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  shield: ShieldCheck,
  truck: Truck,
  user: UserRound,
  users: Users,
  wallet: Wallet,
  warehouse: Warehouse,
};

const card =
  "rounded-[1.4rem] border border-white/90 bg-white/80 shadow-[0_18px_40px_-26px_rgba(20,30,50,0.35)] backdrop-blur-xl";
const heading = "flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-[#1f2733]";
/** The highlight cards' tints, as the mock-up has them: blue, green, orange, violet. */
const TINTS = [
  { bg: "bg-[#eef4ff]", ring: "border-[#dbe6ff]", dot: "#2f6fe4", icon: Briefcase },
  { bg: "bg-[#ecfbf2]", ring: "border-[#d3f2df]", dot: "#1f9d55", icon: CheckCircle2 },
  { bg: "bg-[#fff4ea]", ring: "border-[#ffe3cc]", dot: "#f36b21", icon: TrendingUp },
  { bg: "bg-[#f4f0ff]", ring: "border-[#e6ddff]", dot: "#7c5cff", icon: Users },
];

export function DepartmentPage({
  workspace,
  onBack,
  signIn,
}: {
  workspace: Workspace;
  onBack: () => void;
  /** The sign-in, the same for every department. */
  signIn: ReactNode;
}) {
  const info = DEPARTMENTS[workspace.key];
  const color = TILE_GLOW[workspace.key] ?? "#f36b21";
  const TileIcon = TILE_ICONS[workspace.key];
  const data = useQuery({
    queryKey: ["portal", "department", workspace.key],
    queryFn: () => api<PortalDepartment>(`/api/portal/departments/${workspace.key}`),
    staleTime: 60_000,
    retry: 1,
  });
  const page = data.data;
  const [whole, setWhole] = useState(false);
  const stats = page
    ? [
        ...page.stats.map((one) => ({
          label: one.label,
          hint: one.hint,
          value:
            one.value === null
              ? "—"
              : one.unit === "days"
                ? one.value === 0
                  ? "Same day"
                  : `${one.value} ${one.value === 1 ? "day" : "days"}`
                : one.value.toLocaleString("en-PH"),
        })),
        { label: "Team members", hint: "on the company chart", value: page.people.toLocaleString("en-PH") },
      ].slice(0, 4)
    : [];

  return (
    <div className="mx-auto w-[min(1240px,calc(100%-32px))] pb-10" style={{ "--org-line": `${color}55` } as CSSProperties}>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5b6472] hover:text-[#c2410c]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to departments
      </button>

      {/* Who it is, with its picture. */}
      <header className="relative px-1 py-2">
        <div className="relative z-10 flex items-center gap-5 md:pr-72">
          <span className="grid size-[72px] shrink-0 place-items-center rounded-full shadow-[0_16px_30px_-14px_rgba(20,30,50,0.45)]" style={{ background: color }}>
            <span className="grid size-[52px] place-items-center rounded-full bg-white/95">
              <span className="size-8">{TileIcon && <TileIcon />}</span>
            </span>
          </span>
          <div className="min-w-0">
            <h1 className="text-[clamp(24px,3.2vw,34px)] leading-tight font-semibold tracking-[-0.035em]">{workspace.label}</h1>
            {info && <p className="mt-1 text-[15px] text-[#5b6472]">{info.about}</p>}
          </div>
        </div>
        <Picture color={color} TileIcon={TileIcon} first={stats[0]} />
      </header>

      {/* What went well, counted. */}
      <section aria-label="Highlights" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(stats.length ? stats : [null, null, null, null]).map((one, index) => {
          const tint = TINTS[index % TINTS.length] as (typeof TINTS)[number];
          const Mark = tint.icon;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the four places are fixed
              key={index}
              className={`flex items-center gap-3.5 rounded-[1.2rem] border px-4 py-3.5 ${tint.bg} ${tint.ring} ${one ? "" : "h-[82px] animate-pulse"}`}
            >
              {one && (
                <>
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/80">
                    <Mark className="size-5" style={{ color: tint.dot }} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[24px] leading-none font-semibold tracking-[-0.03em] text-[#1f2733] tabular-nums">{one.value}</span>
                    <span className="mt-1 block text-[13px] font-medium text-[#3c4452]">{one.label}</span>
                    <span className="block truncate text-[11px] text-[#7a8394]">{one.hint}</span>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </section>

      {/* What it handles · the sign-in · its team. */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem_minmax(0,1.25fr)]">
        {info && (
          <section className={`${card} order-2 p-5 lg:order-1`} aria-label="Key functions">
            <h2 className={heading}>
              <Settings className="size-5" style={{ color }} aria-hidden="true" /> Key functions
            </h2>
            <ul className="mt-3 grid gap-2.5">
              {info.handles.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[14px] text-[#3c4452]">
                  <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-[#1f9d55]" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="relative order-1 flex justify-center lg:order-2 lg:-mt-3" aria-label={`Sign in to ${workspace.label}`}>
          {/* A soft glow of the department's colour behind the sign-in: the page's focus. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-6 rounded-[2rem] opacity-30 blur-3xl" style={{ background: color }} />
          <div className="relative w-full max-w-sm">{signIn}</div>
        </section>
        <section className={`${card} order-3 p-5`} aria-label="Team structure">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={heading}>
              <Network className="size-5" style={{ color }} aria-hidden="true" /> Team structure
            </h2>
            {page && page.people > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e3e6ee] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#3c4452]">
                <Users className="size-3.5" style={{ color }} aria-hidden="true" /> Total team: {page.people}
              </span>
            )}
          </div>
          {page?.team ? (
            <>
              <OrgChart tree={page.team} workspace={workspace} color={color} />
              <button
                type="button"
                onClick={() => setWhole(true)}
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold hover:underline"
                style={{ color }}
              >
                See the whole team <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            </>
          ) : (
            <p className="mt-3 text-sm text-[#7a8394]">{data.isLoading ? "Loading…" : "No seats on the company chart yet."}</p>
          )}
        </section>
      </div>

      {whole && page?.team && <WholeTeam tree={page.team} workspace={workspace} color={color} people={page.people} onClose={() => setWhole(false)} />}

      {/* How work moves through it. */}
      {info && (
        <section className={`${card} mt-4 p-5`} aria-label="Workflow overview">
          <h2 className={heading}>
            <Workflow className="size-5" style={{ color }} aria-hidden="true" /> Workflow overview
          </h2>
          <ol className="mt-4 flex flex-wrap items-start justify-center gap-y-4">
            {info.flow.map((one, index) => {
              const Mark = ICONS[FLOW_ICONS[workspace.key]?.[index] ?? "check"] ?? CheckCircle2;
              return (
                <li key={one.step} className="flex items-start">
                  <span className="flex w-[9.5rem] flex-col items-center text-center">
                    <span className="grid size-14 place-items-center rounded-full" style={{ background: `${color}1f` }}>
                      <Mark className="size-6" style={{ color }} />
                    </span>
                    <span className="mt-2 text-[13px] leading-snug font-semibold text-[#1f2733]">{one.step}</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-[#7a8394]">{one.who}</span>
                  </span>
                  {index < info.flow.length - 1 && (
                    <ArrowRight className="mt-5 hidden size-5 shrink-0 text-[#9aa2b0] sm:block" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-[13px] text-[#5b6472]">
            <Sparkles className="size-4 shrink-0" style={{ color }} aria-hidden="true" />
            Every step works from the same record: no double entry, nothing lost between desks.
          </p>
        </section>
      )}
    </div>
  );
}

/** The header's picture: the department's mark on a floating card, its best number beside it. */
function Picture({ color, TileIcon, first }: { color: string; TileIcon?: () => ReactNode; first?: { label: string; value: string } }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-80 md:block">
      <svg viewBox="0 0 320 140" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMaxYMid slice">
        <path d="M0 120C80 100 140 40 320 30" stroke={color} strokeOpacity=".25" strokeWidth="2" fill="none" />
        <circle className="orbit-twinkle" cx="120" cy="36" r="7" fill={color} fillOpacity=".35" />
        <circle className="orbit-twinkle" style={{ animationDelay: "1.2s" }} cx="300" cy="118" r="4" fill={color} fillOpacity=".5" />
      </svg>
      <div className="absolute top-1/2 right-16 grid size-24 -translate-y-1/2 rotate-[-6deg] place-items-center rounded-[1.6rem] border border-white bg-white shadow-[0_24px_40px_-18px_rgba(20,30,50,0.45)]">
        <span className="size-14">{TileIcon && <TileIcon />}</span>
      </div>
      {first && (
        <div className="absolute top-5 right-44 rotate-[3deg] rounded-xl border border-white bg-white/95 px-3 py-1.5 shadow-[0_14px_28px_-16px_rgba(20,30,50,0.45)]">
          <div className="text-[15px] leading-none font-semibold text-[#1f2733] tabular-nums">{first.value}</div>
          <div className="mt-0.5 text-[10px] text-[#7a8394]">{first.label}</div>
        </div>
      )}
      <div className="absolute right-6 bottom-5 grid size-9 place-items-center rounded-full bg-white shadow-[0_10px_20px_-10px_rgba(20,30,50,0.4)]">
        <CheckCircle2 className="size-5 text-[#1f9d55]" />
      </div>
    </div>
  );
}

/** People in a part of the chart: its filled seats, its head's too. */
const peopleIn = (node: PortalTeamNode): number =>
  (node.lead?.filled ? 1 : 0) +
  node.members.reduce((sum, one) => sum + one.people, 0) +
  node.children.reduce((sum, one) => sum + peopleIn(one), 0);
const teamsIn = (node: PortalTeamNode): number => node.children.reduce((sum, one) => sum + 1 + teamsIn(one), 0);

/** The team as a chart, top-down: the head, then the teams (or seats) under it, then their people. */
function OrgChart({ tree, workspace, color }: { tree: PortalTeamNode; workspace: Workspace; color: string }) {
  // The department's own top: below the company, except on the CEO's page (the whole company).
  let root: PortalTeamNode = tree;
  if (workspace.key !== "ceo") {
    while (root.children.length === 1 && !root.members.length && (root.unit === "The company" || !root.lead))
      root = root.children[0] as PortalTeamNode;
    if (root.unit === "The company")
      root = { unit: workspace.label, kind: "department", lead: null, members: [], children: root.children };
  }
  const boxes = [
    ...root.members.map((one) => ({
      key: `m-${one.title}`,
      title: one.title,
      sub: one.seats > 1 ? `${one.seats} seats` : "1 seat",
      does: SEAT_DOES[one.module]?.does,
      below: [] as string[],
    })),
    ...root.children.map((child) => {
      const teams = teamsIn(child);
      return {
        key: `u-${child.unit}`,
        title: child.lead ? child.lead.title : child.unit,
        sub: child.lead ? child.unit : peopleIn(child) ? `${peopleIn(child)} people` : "Department",
        does: child.lead ? SEAT_DOES[child.lead.module]?.does : undefined,
        below: [
          ...child.members.map((one) => `${one.title}${one.seats > 1 ? ` × ${one.seats}` : ""}`),
          ...(teams ? [`${teams} ${teams === 1 ? "team" : "teams"} · ${peopleIn(child)} people`] : []),
        ],
      };
    }),
  ];
  // More than three side by side don't fit: two columns instead.
  const many = boxes.length > 3;
  const person = (title: string, sub: string, does?: string, strong = false) => (
    <div className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${strong ? "border-[#dbe2f0] bg-[#f5f8ff]" : "border-[#e8ebf2] bg-white"}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${color}22` }}>
        <UserRound className="size-4" style={{ color }} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-semibold text-[#1f2733]" title={title}>
          {title}
        </span>
        <span className="block truncate text-[11px] text-[#5b6472]" title={sub}>
          {sub}
        </span>
        {does && (
          <span className="hidden truncate text-[10px] text-[#8a93a3] xl:block" title={does}>
            {does}
          </span>
        )}
      </span>
    </div>
  );
  return (
    <div className="mt-4">
      <div className="mx-auto w-[min(15rem,100%)]">
        {person(
          root.lead ? `Head · ${root.lead.title}` : root.unit,
          root.lead ? root.unit : `${peopleIn(root)} people`,
          root.lead ? SEAT_DOES[root.lead.module]?.does : undefined,
          true,
        )}
      </div>
      {boxes.length > 0 && <div className="org-stem" />}
      {many ? (
        <div className="grid grid-cols-2 gap-2 border-t-2 pt-3" style={{ borderColor: `${color}55` }}>
          {boxes.map((one) => (
            <div key={one.key}>
              {person(one.title, one.sub)}
              {one.below.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-[#5b6472]">
                  <Users className="size-3 shrink-0" style={{ color }} aria-hidden="true" />
                  <span className="truncate">{one.below[one.below.length - 1]}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        boxes.length > 0 && (
          <div className="org-row">
            {boxes.map((one) => (
              <div key={one.key} className="org-col">
                {person(one.title, one.sub, one.does)}
                {one.below.length > 0 && (
                  <>
                    <div className="org-stem" />
                    <div className="w-full rounded-xl border border-[#e8ebf2] bg-[#fafbfd] px-2.5 py-1.5">
                      {one.below.slice(0, 4).map((line) => (
                        <div key={line} className="flex items-center gap-1.5 text-[11px] text-[#3c4452]" title={line}>
                          <Users className="size-3 shrink-0" style={{ color }} aria-hidden="true" />
                          <span className="truncate">{line}</span>
                        </div>
                      ))}
                      {one.below.length > 4 && <div className="text-[10px] text-[#8a93a3]">and {one.below.length - 4} more</div>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** The whole team in a pop-up, on the same page: every unit of the department's part of the chart,
 *  its head's seat, its seats by title and what each kind of seat does (no names). */
function WholeTeam({
  tree,
  workspace,
  color,
  people,
  onClose,
}: {
  tree: PortalTeamNode;
  workspace: Workspace;
  color: string;
  people: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [onClose]);
  const kinds = new Set<string>();
  const walk = (one: PortalTeamNode) => {
    if (one.lead) kinds.add(one.lead.module);
    for (const member of one.members) kinds.add(member.module);
    one.children.forEach(walk);
  };
  walk(tree);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#1f2733]/25 p-4 backdrop-blur-sm">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${workspace.label}: the whole team`}
        className="relative flex max-h-[88dvh] w-full max-w-3xl flex-col rounded-[1.6rem] bg-white shadow-[0_50px_100px_-30px_rgba(20,30,50,0.6)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#eceef3] px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-[18px] font-semibold">
              <Network className="size-5" style={{ color }} aria-hidden="true" /> {workspace.label}: the whole team
            </h2>
            <p className="text-[13px] text-[#7a8394]">{people} people · as the company chart has it today</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-[#7a8394] hover:bg-black/5">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4">
          <Branch node={tree} color={color} root />
          <dl className="mt-5 grid gap-1.5 border-t border-[#eceef3] pt-4 text-[13px] sm:grid-cols-2">
            {[...kinds].map((module) => SEAT_DOES[module]).filter(Boolean).map((one) => (
              <div key={one?.name} className="flex gap-2">
                <dt className="w-32 shrink-0 font-semibold text-[#3c4452]">{one?.name}</dt>
                <dd className="text-[#5b6472]">{one?.does}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

function Branch({ node, color, root = false }: { node: PortalTeamNode; color: string; root?: boolean }) {
  return (
    <div className={root ? "" : "relative mt-2.5 border-l-2 pl-4"} style={root ? undefined : { borderColor: `${color}40` }}>
      {!root && <span aria-hidden="true" className="absolute top-3.5 left-0 h-0.5 w-3" style={{ background: `${color}66` }} />}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[14px] font-semibold text-[#1f2733]">{node.unit}</span>
        {node.lead && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: color }}>
            Head · {node.lead.title}
            {node.lead.filled ? "" : " (open)"}
          </span>
        )}
      </div>
      {node.members.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {node.members.map((one) => (
            <span key={one.title} className="rounded-full border border-[#e3e6ee] bg-[#fafbfd] px-2 py-0.5 text-[12px] text-[#3c4452]">
              {one.title}
              {one.seats > 1 ? ` × ${one.seats}` : ""}
              {one.people < one.seats ? <span className="text-[#c2410c]"> · {one.seats - one.people} open</span> : null}
            </span>
          ))}
        </div>
      )}
      {node.children.map((child) => (
        <Branch key={child.unit} node={child} color={color} />
      ))}
    </div>
  );
}
