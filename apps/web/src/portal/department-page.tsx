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
import { type ComponentType, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
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
    <div className="mx-auto w-[min(1240px,calc(100%-32px))] pt-2 pb-10" style={{ "--org-line": `${color}55` } as CSSProperties}>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-[#5b6472] hover:text-[#c2410c]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to departments
      </button>

      {/* Where you are: the department, across the whole width (orientation). */}
      <header className={`${card} flex items-center gap-5 px-6 py-5 sm:px-7`}>
        <span className="grid size-[56px] shrink-0 place-items-center rounded-full shadow-[0_16px_30px_-14px_rgba(20,30,50,0.45)]" style={{ background: color }}>
          <span className="grid size-[40px] place-items-center rounded-full bg-white/95">
            <span className="size-6">{TileIcon && <TileIcon />}</span>
          </span>
        </span>
        <div className="min-w-0">
          <h1 className="text-[clamp(22px,2.6vw,30px)] leading-tight font-semibold tracking-[-0.035em]">{workspace.label}</h1>
          {info && <p className="mt-1 max-w-[65ch] text-[14px] text-[#5b6472]">{info.about}</p>}
        </div>
      </header>

      {/* Two parts that don't touch: the department's information on the left, the sign-in on its
          own on the right, kept in view while the left scrolls. Phones: the sign-in comes first. */}
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] xl:gap-12">
        <section className="relative lg:sticky lg:top-6 lg:order-2" aria-label={`Sign in to ${workspace.label}`}>
          {/* A soft glow of the department's colour behind the sign-in: the page's focus. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-8 rounded-[2rem] opacity-25 blur-3xl" style={{ background: color }} />
          <div className="relative mx-auto w-full max-w-sm">{signIn}</div>
        </section>

        <div className="grid gap-6 lg:order-1">
          {/* What went well, counted. */}
          <section aria-label="Highlights" className="grid grid-cols-2 gap-3">
            {(stats.length ? stats : [null, null, null, null]).map((one, index) => {
              const tint = TINTS[index % TINTS.length] as (typeof TINTS)[number];
              const Mark = tint.icon;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: the four places are fixed
                  key={index}
                  className={`flex items-center gap-3 rounded-[1.2rem] border px-4 py-3 ${tint.bg} ${tint.ring} ${one ? "" : "h-[76px] animate-pulse"}`}
                >
                  {one && (
                    <>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/80">
                        <Mark className="size-[18px]" style={{ color: tint.dot }} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[22px] leading-none font-semibold tracking-[-0.03em] text-[#1f2733] tabular-nums">{one.value}</span>
                        <span className="mt-1 block text-[13px] leading-snug font-medium text-[#3c4452]">
                          {one.label}
                        </span>
                        <span className="block text-[11px] leading-snug text-[#5b6472]">
                          {one.hint}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </section>

          {/* What it handles · its team. */}
          <div className="grid gap-6 md:grid-cols-2">
            {info && (
              <section className={`${card} p-5`} aria-label="Key functions">
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
            <section className={`${card} p-5`} aria-label="Team structure">
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
                    className="mt-3 inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold hover:underline"
                    style={{ color }}
                  >
                    See the whole team <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <p className="mt-3 text-sm text-[#5b6472]">{data.isLoading ? "Loading…" : "No seats on the company chart yet."}</p>
              )}
            </section>
          </div>

          {/* How work moves through it. */}
          {info && (
            <section className={`${card} p-5`} aria-label="Workflow overview">
              <h2 className={heading}>
                <Workflow className="size-5" style={{ color }} aria-hidden="true" /> Workflow overview
              </h2>
              <ol className="mt-4 flex flex-wrap items-start justify-center gap-y-4">
                {info.flow.map((one, index) => {
                  const Mark = ICONS[FLOW_ICONS[workspace.key]?.[index] ?? "check"] ?? CheckCircle2;
                  return (
                    <li key={one.step} className="flex items-start">
                      <span className="flex w-[8.25rem] flex-col items-center text-center">
                        <span className="grid size-11 place-items-center rounded-full" style={{ background: `${color}1f` }}>
                          <Mark className="size-5" style={{ color }} />
                        </span>
                        <span className="mt-1.5 text-[13px] leading-snug font-semibold text-[#1f2733]">{one.step}</span>
                        <span className="mt-0.5 text-[11px] leading-snug text-[#5b6472]">{one.who}</span>
                      </span>
                      {index < info.flow.length - 1 && (
                        <ArrowRight className="mt-3.5 hidden size-4 shrink-0 text-[#9aa2b0] sm:block" aria-hidden="true" />
                      )}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 flex items-center justify-center gap-2 text-center text-[12px] text-[#5b6472]">
                <Sparkles className="size-4 shrink-0" style={{ color }} aria-hidden="true" />
                Every step works from the same record: no double entry, nothing lost between desks.
              </p>
            </section>
          )}
        </div>
      </div>

      {whole && page?.team && <WholeTeam tree={page.team} workspace={workspace} color={color} people={page.people} onClose={() => setWhole(false)} />}
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
/** The department's own top of the chart: below the company, except on the CEO's page. */
function deptRoot(tree: PortalTeamNode, workspace: Workspace): PortalTeamNode {
  let root: PortalTeamNode = tree;
  if (workspace.key === "ceo") return root;
  while (root.children.length === 1 && !root.members.length && (root.unit === "The company" || !root.lead))
    root = root.children[0] as PortalTeamNode;
  if (root.unit === "The company")
    root = { unit: workspace.label, kind: "department", lead: null, members: [], children: root.children };
  return root;
}

function OrgChart({ tree, workspace, color }: { tree: PortalTeamNode; workspace: Workspace; color: string }) {
  const root = deptRoot(tree, workspace);
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
  // Opens on the head of the tree, in the middle.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
  }, []);
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
        className="relative flex h-[90dvh] w-full max-w-6xl flex-col rounded-[1.6rem] bg-white shadow-[0_50px_100px_-30px_rgba(20,30,50,0.6)]"
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
        <div ref={scroller} className="flex-1 overflow-auto px-6 py-5">
          <div className="org-tree mx-auto w-max min-w-full">
            <TreeNode node={deptRoot(tree, workspace)} color={color} top />
          </div>
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

/** One person (a seat) on the tree with the people under them hanging below: the head on top,
 *  the teams under them side by side, and so on down (Aryan, 18 Nov: "a proper tree"). */
function TreeNode({ node, color, top = false }: { node: PortalTeamNode; color: string; top?: boolean }) {
  const title = node.lead ? node.lead.title : node.unit;
  const sub = node.lead ? node.unit : node.children.length ? "Team" : "Seats";
  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-48 rounded-xl border px-3 py-2 text-left shadow-[0_8px_18px_-14px_rgba(20,30,50,0.4)] ${top ? "border-transparent text-white" : "border-[#e3e6ee] bg-white"}`}
        style={top ? { background: color } : undefined}
      >
        <div className="flex items-center gap-2">
          <span className={`grid size-7 shrink-0 place-items-center rounded-full ${top ? "bg-white/25" : ""}`} style={top ? undefined : { background: `${color}22` }}>
            <UserRound className="size-3.5" style={{ color: top ? "#fff" : color }} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold" title={title}>
              {title}
              {node.lead && !node.lead.filled ? " (open)" : ""}
            </span>
            <span className={`block truncate text-[10px] ${top ? "text-white/85" : "text-[#7a8394]"}`} title={sub}>
              {sub}
            </span>
          </span>
        </div>
        {node.members.length > 0 && (
          <div className={`mt-1.5 border-t pt-1 ${top ? "border-white/30" : "border-[#eef0f4]"}`}>
            {node.members.slice(0, 3).map((one) => (
              <div key={one.title} className={`flex items-center gap-1 truncate text-[10px] ${top ? "text-white" : "text-[#3c4452]"}`} title={one.title}>
                <Users className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {one.title}
                  {one.seats > 1 ? ` × ${one.seats}` : ""}
                </span>
              </div>
            ))}
            {node.members.length > 3 && <div className="text-[10px] opacity-70">and {node.members.length - 3} more</div>}
          </div>
        )}
      </div>
      {/* Many teams with nobody under them: one column under their head, not a long row. */}
      {node.children.length > 3 && node.children.every((child) => !child.children.length) ? (
        <>
          <div className="org-stem" />
          <div className="relative flex flex-col gap-2 border-l-2 pl-3" style={{ borderColor: "var(--org-line)" }}>
            {node.children.map((child) => (
              <div key={child.unit} className="relative">
                <span aria-hidden="true" className="absolute top-5 -left-3 h-0.5 w-3" style={{ background: "var(--org-line)" }} />
                <TreeNode node={child} color={color} />
              </div>
            ))}
          </div>
        </>
      ) : node.children.length > 0 && (
        <>
          <div className="org-stem" />
          <div className="org-row">
            {node.children.map((child) => (
              <div key={child.unit} className="org-col">
                <TreeNode node={child} color={color} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
