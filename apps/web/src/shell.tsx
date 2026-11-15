// The frame every signed-in screen sits in: the top bar, the role's menu down the left on a
// desk, the same menu as a tab bar on a phone.

import type { OrderDashboard, OrgMenuUnit, SearchResult } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  KeyRound,
  LogOut,
  Menu,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { initials, useMe } from "./auth";
import { allItems, type Badge, type MenuGroup, type MenuItem, spaceFor } from "./menus";
import { unreadIn, useUpdates } from "./updates";

export function Shell() {
  const me = useMe();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  // On a computer the menu button hides the sidebar for more room, and the choice is kept.
  const wide = useWide();
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem("crm:sidebar") === "hidden";
    } catch {
      return false;
    }
  });
  const fold = (hide: boolean) => {
    setFolded(hide);
    try {
      localStorage.setItem("crm:sidebar", hide ? "hidden" : "shown");
    } catch {
      // A private window keeps it for this visit only.
    }
  };
  // The counts beside the sidebar's links (a MedRep's Sent back, Inventory's requests too).
  const counted = [
    "management",
    "finance",
    "dispatch",
    "admin",
    "ceo",
    "medrep",
    "inventory",
  ].includes(me.data?.role ?? "");
  const badges = useQuery({
    queryKey: ["orders", "dashboard"],
    queryFn: () => api<OrderDashboard>("/api/orders/dashboard"),
    enabled: Boolean(counted),
  });
  // Conversations with something unread, beside Messages.
  const messages = useQuery({
    queryKey: ["messages"],
    queryFn: () => api<{ unread: number }>("/api/messages"),
    enabled: Boolean(me.data),
    refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
  });
  // Conversations waiting for a reply (and new email senders), beside the Inbox.
  const chats = useQuery({
    queryKey: ["inbox", "count"],
    queryFn: () => api<{ needs: number; held: number }>("/api/inbox/count"),
    enabled: ["online", "admin", "ceo"].includes(me.data?.role ?? ""),
    refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
  });

  if (me.isPending) return <Centered>Loading…</Centered>;
  if (me.isError)
    return (
      <Centered>
        <div className="text-center">
          <div className="font-semibold">Can't reach the server</div>
          <div className="mt-1 text-ink-2">{me.error.message}</div>
          <button
            type="button"
            onClick={() => me.refetch()}
            className="mt-4 h-10 rounded-[10px] bg-brand px-4 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </Centered>
    );
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (me.data.mustChangePassword && location.pathname !== "/password")
    return <Navigate to="/password" replace />;

  const space = spaceFor(me.data, location.pathname);
  const flat = space.groups.flatMap((group) => group.items);
  const menu = (onPick?: () => void) => (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{space.label}</div>
          <div className="truncate text-[11px] text-slate-500">2MG Inc.</div>
        </div>
      </div>
      {space.cta && (
        <NavLink
          to={space.cta.to}
          onClick={onPick}
          className="mx-3 mb-3 flex h-10 items-center gap-2 rounded-[10px] bg-brand px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
        >
          <CirclePlus size={17} aria-hidden="true" /> {space.cta.label}
        </NavLink>
      )}
      {space.back && (
        <NavLink
          to={space.back.to}
          onClick={onPick}
          className="mx-3 mb-1 flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-brand-dark hover:bg-white"
        >
          <ArrowLeft size={15} aria-hidden="true" /> {space.back.label}
        </NavLink>
      )}
      <MenuList
        groups={space.groups}
        onPick={onPick}
        badges={
          {
            ...(badges.data
              ? {
                  ...badges.data.attention,
                  finance: badges.data.attention.toConfirm + badges.data.attention.toInvoice,
                  dispatch: badges.data.attention.toPack + badges.data.attention.toShip,
                  dispatchHeld: badges.data.attention.heldByDispatch,
                }
              : {}),
            inbox: (chats.data?.needs ?? 0) + (chats.data?.held ?? 0),
            messages: messages.data?.unread ?? 0,
          } as Record<Badge, number>
        }
      />
    </>
  );

  const viewer = me.data?.viewedBy;
  return (
    <div className="flex min-h-dvh flex-col">
      {viewer && (
        <LookingBar
          name={me.data?.name ?? ""}
          role={me.data?.roleLabel ?? ""}
          viewer={viewer.name}
        />
      )}
      <header className="sticky top-0 z-30 flex h-14 print:hidden shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white px-3 md:gap-3 md:px-4">
        <button
          type="button"
          aria-label={wide ? (folded ? "Show the menu" : "Hide the menu") : "Menu"}
          title={wide ? (folded ? "Show the menu" : "Hide the menu") : undefined}
          aria-expanded={wide ? !folded : drawer}
          onClick={() => (wide ? fold(!folded) : setDrawer(true))}
          className="flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-head"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        {/* The company's mark, then the workspace: the old CRM's top bar as it is. */}
        <NavLink to="/" aria-label="Home" className="hidden min-w-0 items-center gap-2 md:flex">
          <img
            src="/2mg-inc-logo.png"
            alt="2MG Inc."
            className="h-7 w-auto max-w-[120px] object-contain"
          />
        </NavLink>
        <span aria-hidden="true" className="hidden h-6 w-px bg-slate-200 md:block" />
        <NavLink
          to="/"
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50"
        >
          <span className="truncate text-sm font-semibold text-slate-900">{space.label}</span>
        </NavLink>
        <div className="ml-auto flex w-full max-w-xl justify-end">
          <SearchBox />
        </div>
        <Account name={me.data.name} role={me.data.roleLabel} />
      </header>

      <div className="flex min-w-0 flex-1">
        <aside
          aria-label={`${space.label} menu`}
          className={`sticky top-14 hidden print:!hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-slate-200/80 bg-ground ${folded ? "" : "md:block"}`}
        >
          {menu()}
        </aside>
        <main className="min-w-0 flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-10 print:p-0">
          {/* The way back sits in the page, as on a team's page: a small ‹ and where you are. */}
          {location.pathname !== "/" && !OWN_BACK.some((test) => test.test(location.pathname)) && (
            <PageBack trail={trailOf(space, location.pathname)} />
          )}
          <Outlet />
        </main>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setDrawer(false)}
          />
          <aside
            aria-label={`${space.label} menu`}
            className="absolute inset-y-0 left-0 w-[264px] max-w-[85vw] overflow-y-auto bg-ground shadow-pop"
          >
            {menu(() => setDrawer(false))}
          </aside>
        </div>
      )}

      <nav
        aria-label="Shortcuts"
        className="fixed inset-x-0 bottom-0 z-20 flex items-end print:hidden border-t border-slate-200 bg-white px-2 pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden"
      >
        {(() => {
          // With a main action (the MedRep's New order) it sits raised in the middle of the bar, the
          // tabs either side of it, as phone apps do.
          const tabs = flat.slice(0, space.cta ? 4 : 5);
          const half = Math.ceil(tabs.length / 2);
          const openOf = linkOpen(location, flat);
          const tab = (item: (typeof flat)[number]) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={
                item.to === "/" ||
                item.to.includes("?") ||
                ["/inventory", "/customers", "/reports", "/orders"].includes(item.to)
              }
              className={({ isActive }) =>
                `flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  (item.children ? inFolder(item, location.pathname) : openOf(item.to, isActive))
                    ? "font-semibold text-brand"
                    : "text-slate-500"
                }`
              }
            >
              <item.icon size={20} strokeWidth={1.8} aria-hidden="true" />
              <span className="max-w-full truncate px-1">{item.short ?? item.label}</span>
            </NavLink>
          );
          return (
            <>
              {tabs.slice(0, space.cta ? half : tabs.length).map(tab)}
              {space.cta && (
                <NavLink
                  to={space.cta.to}
                  aria-label={space.cta.label}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5 text-[11px] font-semibold text-brand"
                >
                  {/* Raised in the middle of the bar; flat on its own page, where the page's own
                      bottom button (Place order) sits just above the bar. */}
                  {({ isActive }) => (
                    <>
                      <span
                        className={`flex items-center justify-center rounded-full bg-brand text-white ${
                          isActive ? "size-7" : "-mt-7 size-14 shadow-lg ring-[5px] ring-white"
                        }`}
                      >
                        <Plus size={isActive ? 18 : 28} strokeWidth={2.4} aria-hidden="true" />
                      </span>
                      <span className="max-w-full truncate px-1">{space.cta?.label}</span>
                    </>
                  )}
                </NavLink>
              )}
              {space.cta && tabs.slice(half).map(tab)}
            </>
          );
        })()}
      </nav>
    </div>
  );
}

/** Whether a menu link is the open page. A link with a filter ("Sent back to me" is
 *  /orders?stage=sent_back) is open only with that filter, and then its plain sibling (My orders)
 *  isn't; other links are as the router says. */
function linkOpen(location: { pathname: string; search: string }, items: { to: string }[]) {
  const filtered = (to: string) => {
    const [path, query] = to.split("?");
    if (!query || location.pathname !== path) return false;
    const now = new URLSearchParams(location.search);
    return [...new URLSearchParams(query)].every(([key, value]) => now.get(key) === value);
  };
  return (to: string, isActive: boolean) =>
    to.includes("?")
      ? filtered(to)
      : isActive && !items.some((other) => other.to.startsWith(`${to}?`) && filtered(other.to));
}

/** Pages that draw their own way back (a team's page, a record's crumbs, an order, a case). */
const OWN_BACK = [
  /^\/my-team/,
  /^\/customers\/\d+/,
  /^\/orders\/\d+/,
  /^\/leads\/\d+/,
  /^\/messages\/\d+/,
];

/** "Orders › All orders": where the open page sits in the sidebar (the closest link). */
function trailOf(space: { groups: MenuGroup[] }, pathname: string): string[] {
  let best: { length: number; trail: string[] } = { length: 0, trail: [] };
  const consider = (item: MenuItem, parent?: MenuItem) => {
    const path = item.to.split("?")[0] ?? "";
    if (path === "/" || !(pathname === path || pathname.startsWith(`${path}/`))) return;
    if (path.length > best.length)
      best = { length: path.length, trail: parent ? [parent.label, item.label] : [item.label] };
  };
  for (const group of space.groups)
    for (const item of group.items) {
      consider(item);
      for (const child of item.children ?? []) consider(child, item);
    }
  return best.trail;
}

/** A small round ‹ (to the page before, else Home) and where the page sits. */
function PageBack({ trail }: { trail: string[] }) {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="Where you are"
      className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500 print:hidden"
    >
      <button
        type="button"
        onClick={() =>
          (window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate("/")
        }
        aria-label="Back"
        title="Back to the page before"
        className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
      >
        <ChevronLeft className="size-3.5" />
      </button>
      {trail.map((part, n) => (
        <span key={part} className="flex items-center gap-1">
          {n > 0 && <ChevronRight className="size-3" />}
          <span className={n === trail.length - 1 ? "font-semibold text-slate-700" : ""}>
            {part}
          </span>
        </span>
      ))}
    </nav>
  );
}

/** Whether a page of a folder (or the folder's own) is open: it then shows unfolded. */
function inFolder(item: MenuItem, pathname: string): boolean {
  return allItems(item.children ?? [item]).some((one) => {
    const path = one.to.split("?")[0] ?? "";
    return path !== "/" && (pathname === path || pathname.startsWith(`${path}/`));
  });
}

const PILL = (badge: Badge) =>
  `rounded-full px-1.5 text-[11px] font-semibold ${badge === "flagged" || badge === "refunds" ? "bg-rose-100 text-rose-700" : badge === "inbox" ? "bg-sky-100 text-sky-800" : badge === "messages" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`;

function MenuList({
  groups,
  onPick,
  badges,
}: {
  groups: MenuGroup[];
  onPick?: () => void;
  badges?: Record<Badge, number>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const every = allItems(groups.flatMap((group) => group.items));
  const openOf = linkOpen(location, every);
  // Folders the person unfolded or folded by hand; the rest follow the page that is open.
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  // The teams listed under Company (the CEO) or My team (a lead), read once.
  const wantsTeams = every.some((item) => item.teams || item.badge === "orgRequests");
  const teams = useQuery({
    queryKey: ["org", "menu"],
    queryFn: () => api<{ units: OrgMenuUnit[]; openRequests: number }>("/api/org/menu"),
    enabled: wantsTeams,
    staleTime: 5 * 60_000,
  });
  // The asks for people, regions and areas waiting (the CEO's) count beside Requests.
  const news = useUpdates();
  const counts = (
    badges
      ? {
          ...badges,
          orgRequests: teams.data?.openRequests ?? 0,
          important: unreadIn(news.data, "important"),
          updates: unreadIn(news.data, "updates"),
        }
      : undefined
  ) as Record<Badge, number> | undefined;
  const unitHere =
    location.pathname === "/my-team" ? Number(new URLSearchParams(location.search).get("unit")) : 0;
  const teamLinks = () => {
    const units = teams.data?.units ?? [];
    const tops = units.filter((unit) => unit.level === 0);
    // One box led (and it is the whole team): its own boxes straight under "Whole team".
    const shown = tops.length === 1 ? units.filter((unit) => unit.level === 1) : tops;
    const openTop = units.find((unit) => unit.id === unitHere)?.topId;
    return shown.flatMap((unit) => {
      const kids =
        tops.length > 1 && unit.id === openTop
          ? units.filter((one) => one.level === 1 && one.topId === unit.id)
          : [];
      return [unit, ...kids].map((one) => {
        const deep = one.level === 1 && tops.length > 1;
        const on = one.id === unitHere;
        return (
          <NavLink
            key={`team-${one.id}`}
            to={`/my-team?unit=${one.id}`}
            onClick={onPick}
            className={`relative flex h-7 items-center gap-2 rounded-md pr-2 text-[12px] transition-colors ${
              deep ? "pl-7" : "pl-4"
            } ${on ? "bg-emerald-50 font-semibold text-emerald-800" : "text-slate-500 hover:bg-white hover:text-slate-900"}`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${on ? "bg-emerald-600" : deep ? "bg-slate-300" : "bg-slate-400"}`}
            />
            <span className="flex-1 truncate">{one.name}</span>
            {one.people > 0 && (
              <span className="text-[10.5px] text-slate-400 tabular-nums">{one.people}</span>
            )}
          </NavLink>
        );
      });
    });
  };

  const link = (item: MenuItem, inner = false) => {
    // "Company view" / "Whole team" isn't lit while one of the teams under it is open.
    const lit = (isActive: boolean) => openOf(item.to, isActive) && !(item.teams && unitHere);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={
          item.to === "/" ||
          item.to.includes("?") ||
          [
            "/inventory",
            "/customers",
            "/reports",
            "/orders",
            "/finance",
            "/dispatch",
            "/people",
          ].includes(item.to)
        }
        onClick={onPick}
        className={({ isActive }) =>
          `group relative flex items-center gap-2.5 rounded-lg px-2.5 transition-colors ${
            inner ? "h-8 text-[12.5px]" : "h-9 text-[13px]"
          } ${
            lit(isActive)
              ? "bg-emerald-50 font-semibold text-emerald-800"
              : "text-slate-600 hover:bg-white hover:text-slate-900"
          }`
        }
      >
        {({ isActive }) => (
          <>
            {lit(isActive) && (
              <span
                aria-hidden="true"
                className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-emerald-600"
              />
            )}
            <item.icon
              size={inner ? 15 : 17}
              className={
                lit(isActive) ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"
              }
              aria-hidden="true"
            />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && counts && counts[item.badge] > 0 && (
              <span className={PILL(item.badge)}>{counts[item.badge]}</span>
            )}
          </>
        )}
      </NavLink>
    );
  };

  const folder = (item: MenuItem) => {
    const here = inFolder(item, location.pathname);
    const open = folded[item.label] ?? here;
    // Folded, it still says what waits inside.
    const waiting = allItems(item.children ?? []).reduce(
      (sum, one) => sum + (one.badge && counts ? (counts[one.badge] ?? 0) : 0),
      0,
    );
    return (
      <div key={`folder-${item.label}`} className="flex flex-col">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            if (!open && !here) {
              navigate(item.to);
              onPick?.();
            }
            setFolded((now) => ({ ...now, [item.label]: !open }));
          }}
          className={`group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors ${
            here
              ? "font-semibold text-slate-900"
              : "text-slate-600 hover:bg-white hover:text-slate-900"
          }`}
        >
          <item.icon
            size={17}
            className={here ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}
            aria-hidden="true"
          />
          <span className="flex-1 truncate">{item.label}</span>
          {!open && waiting > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">
              {waiting}
            </span>
          )}
          <ChevronDown
            size={15}
            className={`text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div className="mt-0.5 mb-1 ml-[18px] flex flex-col gap-0.5 border-l border-slate-200 pl-2">
            {(item.children ?? []).flatMap((child) =>
              child.teams ? [link(child, true), ...teamLinks()] : [link(child, true)],
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-0.5 px-3 pb-4">
      {groups.map((group, index) => (
        <div key={group.title ?? index} className="flex flex-col gap-0.5">
          {group.title && (
            <div className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              {group.title}
            </div>
          )}
          {group.items.map((item) => (item.children ? folder(item) : link(item)))}
        </div>
      ))}
    </div>
  );
}

/** The top bar's search: medicines and the customers this person may see. */
function SearchBox() {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setAsked(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const found = useQuery({
    queryKey: ["search", asked],
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(asked)}`),
    enabled: asked.length >= 2,
    placeholderData: (previous) => previous,
  });
  const results: { to: string; label: string; sub: string }[] = [
    // An order code or PO typed: the order first.
    ...(found.data?.orders ?? []).map((row) => ({
      to: `/orders/${row.id}`,
      label: `${row.code} · ${row.customer}`,
      sub: `Order · ${row.status}`,
    })),
    ...(found.data?.people ?? []).map((row) => ({
      to: row.seatId ? `/my-team/seat/${row.seatId}` : `/people?q=${encodeURIComponent(row.name)}`,
      label: row.name,
      sub: ["Person", row.title, row.team, row.login].filter(Boolean).join(" · "),
    })),
    ...(found.data?.medicines ?? []).map((row) => ({
      to: `/medicines/${row.id}`,
      label: [row.name, row.strength].filter(Boolean).join(" "),
      sub: row.sku ? `Medicine · ${row.sku}` : "Medicine",
    })),
    ...(found.data?.customers ?? []).map((row) => ({
      to: `/customers/${row.id}`,
      label: row.name,
      sub: [row.kind[0]?.toUpperCase() + row.kind.slice(1), row.city].filter(Boolean).join(" · "),
    })),
  ];
  const go = (to: string) => {
    setOpen(false);
    setText("");
    navigate(to);
  };

  return (
    <div ref={box} className="relative w-full">
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
        aria-hidden="true"
      />
      <input
        type="search"
        aria-label="Search medicines, customers, orders and people"
        placeholder="Search medicines, customers, orders, people"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && results[0]) go(results[0].to);
        }}
        className="h-10 w-full rounded-[10px] border border-transparent bg-slate-100 pr-3 pl-9 text-[13px] placeholder:text-slate-500 hover:bg-slate-200/70 focus:border-brand focus:bg-white focus:outline-none"
      />
      {open && asked.length >= 2 && (
        <div className="absolute inset-x-0 top-full mt-1 overflow-hidden rounded-xl bg-white py-1 shadow-pop">
          {found.isPending ? (
            <div className="px-3 py-2.5 text-ink-2">Searching…</div>
          ) : found.isError ? (
            <div className="px-3 py-2.5 text-bad">Search didn't work. Try again.</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2.5 text-ink-2">Nothing found for "{asked}".</div>
          ) : (
            results.map((row) => (
              <button
                key={row.to}
                type="button"
                onClick={() => go(row.to)}
                className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-hover"
              >
                <span className="text-[13px] font-semibold">{row.label}</span>
                <span className="text-xs text-ink-2">{row.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Account({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queries = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    queries.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-1 hover:bg-head"
        aria-label={`${name}, ${role}`}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-sky-700 text-[13px] font-semibold text-white">
          {initials(name)}
        </span>
        <ChevronDown size={15} className="hidden text-slate-400 sm:block" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-xl bg-white p-1.5 text-[13px] shadow-pop"
        >
          <div className="border-b border-line-soft px-3 pt-1.5 pb-2.5">
            <div className="font-semibold">{name}</div>
            <div className="text-xs text-ink-2">{role}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/password");
            }}
            className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-hover"
          >
            <KeyRound size={17} aria-hidden="true" /> Change password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-hover"
          >
            <LogOut size={17} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6 text-ink-2">{children}</div>
  );
}

/** True on a screen wide enough for the sidebar (the phone opens the menu as a drawer). */
function useWide(): boolean {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return wide;
}

/** While the CEO (or the Admin) looks as someone: whose screens these are, and the way back. */
function LookingBar({ name, role, viewer }: { name: string; role: string; viewer: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-1.5 text-center text-[13px] font-medium text-amber-950 print:hidden">
      <span>
        You are looking as <b>{name}</b> ({role}): you see what they see, and nothing can be
        changed.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api("/api/auth/view/back", { method: "POST" }).catch(() => undefined);
          window.location.href = "/";
        }}
        className="rounded-md bg-amber-950 px-2.5 py-0.5 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
      >
        {busy ? "Going back…" : `Back to ${viewer}`}
      </button>
    </div>
  );
}

/** The CEO (or the Admin) starts looking as someone, then the app opens as they see it. */
export async function lookAs(personId: number): Promise<void> {
  await api(`/api/auth/view/${personId}`, { method: "POST" });
  window.location.href = "/";
}
