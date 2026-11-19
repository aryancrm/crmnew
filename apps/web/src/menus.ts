// Who sees which menu. A person works at their own **desk** (only their own work), and an
// **app** (Inventory, Customers, Reports) has a menu of its own that shows while one of its
// pages is open. The Admin and the CEO start on a page of apps. Nothing here leads to a
// screen that isn't built.

import { officeMedrep } from "./auth";
import { b2bRole, seatWords } from "./seat-words";
import type { Me, Role } from "@2mg/api/types";
import {
  ArrowLeftRight,
  BookOpen,
  LayoutDashboard,
  FileBarChart,
  BookOpenCheck,
  Landmark,
  ListTree,
  Lock,
  Link2,
  Banknote,
  BarChart3,
  BellRing,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Factory,
  FlaskConical,
  FileText,
  Gauge,
  Gift,
  ShieldAlert,
  HandCoins,
  HeartHandshake,
  House,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Network,
  PackageCheck,
  PackageX,
  PhoneCall,
  TrendingUp,
  Pill,
  Radio,
  Receipt,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Stethoscope,
  Target,
  Timer,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  ListChecks,
  ScrollText,
  ScanSearch,
} from "lucide-react";
import { ZOHO_REPORT_GROUPS } from "./zoho-reports";

/** A count from the orders dashboard shown beside a link. "finance" is Finance's own work:
 *  payments to confirm and orders to invoice together. */
export type Badge =
  | "messages"
  | "onTheWay"
  | "dispatchHeld"
  | "sentBack"
  | "requests"
  | "awaiting"
  | "flagged"
  | "customers"
  | "finance"
  | "refunds"
  | "dispatch"
  | "inbox"
  | "orgRequests"
  | "important"
  | "updates"
  | "leave"
  | "decisions"
  | "refills"
  | "latePayments";
export type MenuItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: Badge;
  /** What the phone's tab bar calls it, where the label is too long for a tab. */
  short?: string;
  /** Its own pages, opened under it in the same sidebar (never a sidebar of their own). The
   *  item itself opens the first of them. */
  children?: MenuItem[];
  /** The company's teams (or the lead's) are listed under this link, each opening its page. */
  teams?: boolean;
};

/** A link with its pages under it: opens the first; open (unfolded) while any of them is. */
const folder = (
  label: string,
  icon: LucideIcon,
  children: MenuItem[],
  short?: string,
): MenuItem => ({
  to: children[0]?.to ?? "/",
  label,
  icon,
  children,
  ...(short ? { short } : {}),
});

/** Every link of a menu, the pages inside folders too. */
export const allItems = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => (item.children ? [item, ...allItems(item.children)] : [item]));
export type MenuGroup = { title?: string; items: MenuItem[] };

/** A desk or an app: its name, its tile and its menu. */
export type Space = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** The tile's colours. */
  tone: string;
  groups: MenuGroup[];
  /** The button on top of the menu, as the hub has "Create New Order": every seller's the same
   *  (Aryan, 19 Nov: one common way to start an order, whatever the seat). */
  cta?: { to: string; label: string };
  /** The seat's own second action under it (an Rx CHC's Log a call, Bidding's Record a tender). */
  cta2?: { to: string; label: string };
  /** The way back to the person's own desk, when this is an app they stepped into. */
  back?: { to: string; label: string };
  /** The phone's tab bar, when it isn't the menu's first links. */
  tabs?: MenuItem[];
};

const COST_ROLES: Role[] = ["inventory", "management", "finance", "ceo", "admin"];
const APP_ROLES: Role[] = ["ceo", "admin"];

const INVENTORY_PATHS = [
  "/inventory",
  "/medicines",
  "/adjustments",
  "/transfers",
  "/receives",
  "/purchases",
  "/suppliers",
];
const under = (pathname: string, paths: string[]) =>
  paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

const home: MenuItem = { to: "/", label: "Home", icon: House };
const customers: MenuItem = { to: "/customers", label: "Customers", icon: Users };
/** The one way into the shared stock from every desk. */
const stockLink: MenuItem = {
  to: "/medicines",
  label: "Medicines & stock",
  icon: Pill,
  short: "Stock",
};
const newOrder = { to: "/orders/new", label: "Create New Order" };

/** Management's order screens, in the hub's own order. */
const orderLinks: MenuItem[] = [
  { to: "/orders/check", label: "Orders to check", icon: ClipboardCheck, badge: "awaiting" },
  { to: "/on-hold", label: "On hold", icon: TriangleAlert, badge: "flagged" },
  { to: "/orders", label: "All orders", icon: ClipboardList },
];

/** A MedRep's or a team's orders: one link to all of them. Where they stand (sent back, with
 *  Management, ...) and Returns are tabs on the page itself, not more links here (Aryan, 17 Nov:
 *  "All" on top, less clutter). The badge counts what was sent back. */
const ordersLink = (label: string): MenuItem => ({
  to: "/orders",
  label,
  icon: ClipboardList,
  badge: "sentBack",
  short: "Orders",
});

/** Inventory, laid out the way Zoho Inventory lays out its own. */
function inventoryApp(me: Me): Space {
  const seesCost = COST_ROLES.includes(me.role);
  return {
    key: "inventory",
    label: "Inventory",
    icon: Boxes,
    tone: "bg-amber-500 text-white",
    groups: [
      { items: [{ to: "/inventory/overview", label: "Overview", icon: House }] },
      {
        title: "Items",
        items: [
          { to: "/medicines", label: "Medicines & prices", icon: Pill },
          {
            to: "/inventory/requests",
            label: "Medicine requests",
            icon: MessageSquarePlus,
            badge: "requests",
          },
        ],
      },
      {
        title: "Inventory",
        items: [
          { to: "/inventory", label: "Stock by warehouse", icon: Boxes },
          { to: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
          { to: "/transfers", label: "Transfers", icon: ArrowLeftRight },
          // Where a batch went, for a recall (ERP phase 3).
          { to: "/inventory/trace", label: "Batch trace", icon: ScanSearch },
          { to: "/field/samples", label: "Samples to reps", icon: Gift },
        ],
      },
      // Purchases in this CRM's own look (Aryan, 18 Nov): the same records as Zoho's screens,
      // which stay one press away ("Zoho view") for showing both. In the order the work goes
      // (Aryan: "vendors first, then the rest in order"): vendor → order → receive → bill → pay →
      // credit; the board of what is due and what to buy again after them.
      {
        title: "Purchases",
        items: [
          ...(seesCost
            ? [
                { to: "/purchases/vendors", label: "Vendors", icon: Factory },
                { to: "/purchases/orders", label: "Purchase orders", icon: ShoppingCart },
              ]
            : []),
          // The books are for the stock and money desks; the others see what came in on the shelf.
          seesCost
            ? { to: "/purchases/receives", label: "Receives", icon: PackageCheck }
            : { to: "/receives", label: "Receives", icon: PackageCheck },
          ...(seesCost
            ? [
                { to: "/purchases/bills", label: "Bills", icon: ReceiptText },
                { to: "/purchases/payments", label: "Payments made", icon: Banknote },
                { to: "/purchases/credits", label: "Vendor credits", icon: Undo2 },
                { to: "/purchases", label: "To do & buy again", icon: LayoutDashboard },
                { to: "/books/purchaseorders", label: "Zoho view", icon: BookOpen },
              ]
            : []),
        ],
      },
    ],
  };
}

const customersApp = (me: Me): Space => ({
  key: "customers",
  label: "Customers",
  icon: Users,
  tone: "bg-sky-600 text-white",
  groups: [
    {
      items: [
        { to: "/customers", label: "All customers", icon: Users },
        { to: "/hospitals", label: "Hospitals", icon: Building2 },
        { to: "/doctors", label: "Doctors", icon: Stethoscope },
        { to: "/patients", label: "Patients", icon: User },
        ...(me.role === "admin"
          ? [{ to: "/customers?review=1", label: "New customers to check", icon: UserPlus }]
          : []),
      ],
    },
  ],
});

const ordersApp = (me: Me): Space => ({
  key: "orders",
  label: "Orders",
  icon: ClipboardList,
  tone: "bg-emerald-600 text-white",
  // Management's whole desk, as the CEO steps into it (Aryan, 18 Nov: "are their full screens there").
  groups: [
    {
      items: [
        ...orderLinks,
        { to: "/orders/sent-back", label: "Sent back", icon: Undo2, badge: "sentBack" },
        { to: "/orders?stuck=1", label: "Stuck over 2 days", icon: Timer },
        { to: "/returns?status=requested", label: "Returns to approve", icon: PackageX },
        { to: "/customers?review=1", label: "Customers to check", icon: UserPlus, badge: "customers" },
        { to: "/desk/team?desk=management", label: "Management team figures", icon: BarChart3 },
      ],
    },
  ],
  ...(me.role === "admin" ? { cta: newOrder } : {}),
});

/** Finance's own lists, after Zoho Books: what customers owe, invoices, payments, refunds. */
const moneyLinks: MenuItem[] = [
  { to: "/owed", label: "Customers owe", icon: HandCoins },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/payments", label: "Payments received", icon: Banknote },
  { to: "/refunds", label: "Refunds owed", icon: Undo2, badge: "refunds" },
  { to: "/returns", label: "Returns", icon: PackageX },
];

/** Zoho Books' own, moved in (docs/PLAN.md 17): the banks, expenses, journals and the chart of
 *  accounts, for Finance, the CEO and the Admin. */
const booksLinks: MenuItem[] = [
  { to: "/books/home", label: "Open Books", icon: BookOpen },
  { to: "/books/banking", label: "Banking", icon: Landmark },
  { to: "/books/expenses", label: "Expenses", icon: Receipt },
  { to: "/books/journals", label: "Manual journals", icon: BookOpenCheck },
  { to: "/books/accounts", label: "Chart of accounts", icon: ListTree },
  { to: "/books/locking", label: "Transaction locking", icon: Lock },
];

const financeApp: Space = {
  key: "finance",
  label: "Finance",
  icon: HandCoins,
  tone: "bg-teal-600 text-white",
  groups: [
    {
      items: [
        { to: "/finance", label: "Orders to check", icon: ClipboardCheck, badge: "finance" },
        { to: "/finance/prepaid", label: "Prepaid orders", icon: CreditCard },
        { to: "/collect", label: "Due payments", icon: Wallet },
        { to: "/purchases/bills", label: "Supplier bills to pay", icon: Receipt },
        { to: "/desk/team?desk=finance", label: "Finance team figures", icon: BarChart3 },
        ...moneyLinks,
      ],
    },
    { title: "Books", items: booksLinks },
  ],
};

const dispatchApp: Space = {
  key: "dispatch",
  label: "Dispatch",
  icon: Truck,
  tone: "bg-sky-700 text-white",
  groups: [
    {
      items: [
        { to: "/dispatch", label: "Orders to check", icon: ClipboardCheck, badge: "dispatch" },
        { to: "/shipments", label: "On the road", icon: Truck },
        { to: "/dispatch/hold", label: "On hold", icon: TriangleAlert },
        { to: "/returns?status=approved", label: "Returns to check", icon: PackageX },
      ],
    },
  ],
};

/** The Online desk's enquiries, as the CEO and the Admin step into them. */
const onlineApp: Space = {
  key: "online",
  label: "Online",
  icon: Inbox,
  tone: "bg-emerald-700 text-white",
  groups: [
    {
      items: [
        { to: "/leads", label: "Leads & enquiries", icon: Inbox },
        { to: "/inbox", label: "Inbox", icon: MessagesSquare, badge: "inbox" },
        { to: "/to-call", label: "Refills due", icon: Pill, badge: "refills" },
        { to: "/patients", label: "Patients", icon: Users },
        { to: "/points", label: "Points", icon: Gift },
        { to: "/channels", label: "Channels", icon: Radio },
        { to: "/settings", label: "Company details", icon: Building2 },
      ],
    },
  ],
};

const reportsApp: Space = {
  key: "reports",
  label: "Reports",
  icon: BarChart3,
  tone: "bg-violet-600 text-white",
  groups: [
    { items: [{ to: "/reports", label: "All reports", icon: BarChart3 }] },
    {
      title: "Sales",
      items: [
        { to: "/reports/channels", label: "By channel", icon: Users },
        { to: "/team", label: "By person", icon: User },
        { to: "/team-scores", label: "Scorecards", icon: Gauge },
        { to: "/to-call", label: "Customers to call", icon: PhoneCall, badge: "refills" },
        { to: "/collections", label: "Collections", icon: HandCoins },
        { to: "/huddle", label: "Evening huddles", icon: Megaphone },
        { to: "/care-groups", label: "Care groups", icon: Users },
        { to: "/rx/field", label: "Rx field team", icon: Stethoscope },
        { to: "/b2b/team", label: "B2B team", icon: Building2 },
        { to: "/clidp/team", label: "CLIDP", icon: FileText },
        { to: "/tenders", label: "Tenders", icon: FileText },
        { to: "/targets", label: "Targets", icon: Target },
      ],
    },
    {
      title: "Office",
      items: [
        { to: "/work-logs", label: "Work logs", icon: NotebookPen },
        { to: "/reports/regulatory", label: "Pipeline & registrations", icon: FlaskConical },
      ],
    },
  ],
};

/** HR as the CEO and the Admin open it: the reports. HR's own desk does the work (joiners,
 *  records, putting days right, leave). */
const hrApp: Space = {
  key: "hr",
  label: "HR",
  icon: CalendarClock,
  tone: "bg-teal-600 text-white",
  groups: [
    {
      items: [
        { to: "/hr/report", label: "Attendance report", icon: BarChart3 },
        { to: "/hr/leave?view=approved", label: "Leave", icon: CalendarDays },
        { to: "/hr/payroll", label: "Payroll", icon: Wallet },
        { to: "/hr/people", label: "People", icon: Users },
      ],
    },
  ],
};

/** Field as the CEO and the Admin open it: the visits report (the MedReps' calls). */
const fieldApp: Space = {
  key: "field",
  label: "Field",
  icon: CalendarCheck,
  tone: "bg-sky-600 text-white",
  groups: [
    {
      items: [
        { to: "/field/report", label: "Visits report", icon: CalendarCheck },
        { to: "/visits/calendar", label: "Calendar", icon: CalendarDays },
        { to: "/field/live", label: "Where the team is", icon: MapPin },
        { to: "/field/samples", label: "Samples & gifts", icon: Gift },
      ],
    },
  ],
};

/** The apps on the Admin's and the CEO's page of apps, in order. */
export const appsFor = (me: Me): Space[] =>
  APP_ROLES.includes(me.role)
    ? [
        ordersApp(me),
        onlineApp,
        financeApp,
        dispatchApp,
        inventoryApp(me),
        customersApp(me),
        fieldApp,
        hrApp,
        reportsApp,
      ]
    : [];

/** How long each desk keeps an order, and who is late: for the desks, team leads and the CEO. */
const speedLink: MenuItem = { to: "/speed", label: "Speed", icon: Timer };
const SPEED_ROLES: Role[] = ["ceo", "management", "finance", "dispatch", "team_lead", "manager"];

/** Messages on everyone's desk: what needs them, the news (no bell to miss), and the chats. */
const messagesLink: MenuItem = folder(
  "Messages",
  MessageCircle,
  [
    // Every decision waiting on the person, from every desk, in one list (ERP phase 2).
    { to: "/decisions", label: "To decide", icon: ListChecks, badge: "decisions" },
    // A customer's complaint or a side-effect, reported by anyone, handled by Regulatory.
    { to: "/complaints", label: "Complaints & side-effects", icon: ShieldAlert },
    { to: "/messages?box=important", label: "Needs you", icon: BellRing, badge: "important" },
    { to: "/messages?box=updates", label: "Updates", icon: Inbox, badge: "updates" },
    { to: "/messages", label: "Chats", icon: MessageCircle, badge: "messages" },
  ],
  "Messages",
);

/** Each role's own desk, with "Me" (their own leave, forms and payslips) and Messages at the foot
 *  of its work, and Speed with what they look things up in: few links, folders for the rest
 *  (Aryan, 15 Nov: less clutter). */
function deskFor(me: Me): Space {
  const desk = ownDesk(me);
  const space = withSalesLinks(me, desk);
  const [first, ...rest] = space.groups;
  if (!first) return space;
  const listed = allItems(space.groups.flatMap((group) => group.items));
  // Everyone asks for their own leave, except the CEO and the Admin (HR records theirs).
  // The desk's common screen (signed in at its tile with the company's password) is nobody's own:
  // no "Me", no one person's messages (Aryan, 19 Nov). Each person's own login keeps them.
  const shared = Boolean(me.deskScreen);
  const mine: MenuItem[] =
    me.role === "ceo" || me.role === "admin" || shared
      ? []
      : [
          folder(
            "Me",
            User,
            [
              {
                to: "/me/leave",
                // HR's desk has the company's "Leave & forms": theirs is "My leave & forms".
                label: listed.some((item) => item.label === "Leave & forms")
                  ? "My leave & forms"
                  : "Leave & forms",
                icon: CalendarDays,
              },
              { to: "/me/payslips", label: "My payslips", icon: ReceiptText },
            ],
            "Me",
          ),
        ];
  const speed =
    SPEED_ROLES.includes(me.role) && !listed.some((item) => item.to === "/speed")
      ? [speedLink]
      : [];
  const [lookUp, ...others] = rest;
  // A lead's or a head's desk is long: the same links, under three headings (the day's work, the
  // team, what they look things up in) so it doesn't read as one long list. Nothing is taken off
  // (Aryan, 17 Nov), and the phone's tab bar keeps the links it had.
  const sorted = LEAD_ROLES.includes(me.role) ? sortLead(first.items) : null;
  const work = sorted ? sorted.work : first.items;
  const found = sorted ? sorted.lookUp : [];
  const team = sorted?.team ?? [];
  const lookUpItems = [...(lookUp?.items ?? []), ...found, ...speed];
  return {
    ...space,
    ...(sorted ? { tabs: first.items } : {}),
    groups: [
      { ...first, items: [...work, ...mine, ...(shared ? [] : [messagesLink])] },
      ...(team.length ? [{ title: "Team", items: team }] : []),
      ...(lookUpItems.length ? [{ title: "Look up", ...(lookUp ?? {}), items: lookUpItems }] : []),
      ...others,
    ],
  };
}

/** Calls and the daily sales performance on every selling desk and those above them (18 Nov,
 *  the B2B team's Google Form and end-of-day Excel, now here). */
const CALL_ROLES: Role[] = ["medrep", "team_lead", "manager", "online"];
const PERFORMANCE_ROLES: Role[] = [...CALL_ROLES, "ceo", "management", "admin"];
function withSalesLinks(me: Me, space: Space): Space {
  const [first, ...rest] = space.groups;
  if (!first || !PERFORMANCE_ROLES.includes(me.role)) return space;
  const listed = allItems(space.groups.flatMap((group) => group.items)).map((item) => item.to);
  const own = CALL_ROLES.includes(me.role) && !LEAD_ROLES.includes(me.role);
  const add: MenuItem[] = [
    // An Rx CHC's "Calls" are doctor visits: their phone log says so, so the two don't mix.
    ...(listed.includes("/calls")
      ? []
      : [{ to: "/calls", label: own ? (me.channel?.code === "RX" ? "My phone calls" : "My calls") : "Calls", icon: PhoneCall }]),
    // The Admin sets the company up; sales figures are the CEO's and the leads' (Aryan, 18 Nov).
    ...(listed.includes("/sales-performance") || me.role === "admin" ? [] : [{ to: "/sales-performance", label: "Sales performance", icon: TrendingUp }]),
  ];
  return { ...space, groups: [{ ...first, items: [...first.items, ...add] }, ...rest] };
}

const LEAD_ROLES: Role[] = ["team_lead", "manager"];
/** Links about the people under a lead: their team, scores, targets, visits and attendance. */
const TEAM_LINKS = ["/my-team", "/team-scores", "/targets", "/hr/attendance", "/field/report", "/rx/field", "/calls", "/sales-performance"];
/** What a lead looks things up in: customers and the stock. */
const LOOK_UP_LINKS = ["/customers", "/medicines"];
/** Splits a lead's links into the day's work, the team and the look-ups, keeping their order. A
 *  "Team" heading over a single link would say nothing, so one team link stays with the work. */
function sortLead(items: MenuItem[]): { work: MenuItem[]; team: MenuItem[]; lookUp: MenuItem[] } {
  const lookUp = items.filter((item) => LOOK_UP_LINKS.includes(item.to));
  const rest = items.filter((item) => !LOOK_UP_LINKS.includes(item.to));
  const team = rest.filter((item) => TEAM_LINKS.includes(item.to));
  if (team.length < 2) return { work: rest, team: [], lookUp };
  return { work: rest.filter((item) => !TEAM_LINKS.includes(item.to)), team, lookUp };
}

/** Each role's own desk: only that person's work, and one link into the shared stock. */
function ownDesk(me: Me): Space {
  const desk = (items: MenuItem[], icon: LucideIcon = House): Space => ({
    key: "desk",
    label: seatWords(me).desk,
    icon,
    tone: "bg-brand text-white",
    groups: [{ items: [...items, stockLink] }],
  });
  switch (me.role) {
    case "medrep": {
      // The Online channel's MedRep sits in the office: the Online desk first, then their orders.
      if (officeMedrep(me))
        return {
          ...desk([
            home,
            { to: "/leads", label: "Leads & enquiries", icon: Inbox },
            { to: "/inbox", label: "Inbox", icon: MessagesSquare, badge: "inbox" },
            { to: "/to-call", label: "Refills due", icon: Pill, badge: "refills", short: "Refills" },
            ordersLink("My orders"),
            { to: "/customers", label: "Patients", icon: Users },
            { to: "/points", label: "Points", icon: Gift },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: { to: "/leads?new=1", label: "New lead" },
        };
      // A Hospital CHC: the day of the Hospital CHC Playbook, in its order (docs/PLAN.md 16.1).
      if (me.channel?.code === "HOSP")
        return {
          ...desk([
            home,
            { to: "/my/area", label: "My hospitals", icon: Building2, short: "Hospitals" },
            ordersLink("My orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
            { to: "/to-call", label: "Hospitals to call", icon: PhoneCall, badge: "refills", short: "Call" },
            folder(
              "Visits",
              CalendarCheck,
              [
                { to: "/visits", label: "Today's visits", icon: CalendarCheck },
                { to: "/visits/calendar", label: "Calendar", icon: CalendarDays },
                { to: "/visits/plan", label: "Visit plan", icon: CalendarRange },
                { to: "/visits/expenses", label: "My expenses", icon: Receipt },
                { to: "/me/samples", label: "My samples & gifts", icon: Gift },
              ],
              "Visits",
            ),
            // The Government Account's bidding coachee works tenders; the CHCs declare the 7 PM huddle.
            ...(/bidding/i.test(me.title ?? "")
              ? [
                  { to: "/tenders", label: "Tenders", icon: FileText, short: "Tenders" },
                  { to: "/company-papers", label: "Documents", icon: ClipboardCheck },
                ]
              : [{ to: "/huddle", label: "Tonight's huddle", icon: Megaphone, short: "Huddle" }]),
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: newOrder,
        };
      // B2B Telesales (docs/PLAN.md 16.4): the NBD hunts new accounts, the CRR keeps them buying.
      if (b2bRole(me) === "nbd")
        return {
          ...desk([
            home,
            { to: "/b2b/prospects", label: "Prospects", icon: Building2, short: "Prospects" },
            ordersLink("My orders"),
            { to: "/b2b/prospects?view=handed", label: "Handed over", icon: UserCheck },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: newOrder,
        };
      if (b2bRole(me) === "crr")
        return {
          ...desk([
            home,
            { to: "/b2b/accounts", label: "Accounts", icon: Building2, short: "Accounts" },
            ordersLink("My orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: newOrder,
        };
      // Government Bidding's coachees and CHC (docs/PLAN.md 16.6): tenders from posting to payment.
      if (me.channel?.code === "BID")
        return {
          ...desk([
            home,
            { to: "/tenders", label: "Tenders", icon: FileText, short: "Tenders" },
            { to: "/company-papers", label: "Documents", icon: ClipboardCheck },
            ordersLink("My orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
          ]),
          cta: newOrder,
          cta2: { to: "/tenders", label: "Record a tender" },
        };
      // CLIDP (Sales and Marketing, docs/PLAN.md 16.5): bulk to distributors under their listings.
      if (b2bRole(me) === "clidp")
        return {
          ...desk([
            home,
            { to: "/my/area", label: "Accounts", icon: Building2, short: "Accounts" },
            { to: "/clidp/listings", label: "Listings", icon: FileText },
            ordersLink("My orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
          ]),
          cta: newOrder,
        };
      // MD Telesales Anesthesia (inside the Hospital Division): hospitals and doctors by phone.
      if (me.channel?.code === "TS" && me.business === "HOSP")
        return {
          ...desk([
            home,
            { to: "/to-call", label: "Customers to call", icon: PhoneCall, badge: "refills", short: "Call" },
            ordersLink("My orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
            { to: "/my/area", label: "My customers", icon: Building2 },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: newOrder,
        };
      // MD Telesales Oncology (the Prescription Business): care groups, refills, orders, the number
      // (docs/PLAN.md 16.2).
      if (me.channel?.code === "TS" && me.business === "RX")
        return {
          ...desk([
            home,
            { to: "/care-groups", label: "Care groups", icon: Users, short: "Groups" },
            { to: "/to-call", label: "Refills due", icon: Pill, badge: "refills", short: "Refills" },
            ordersLink("My orders"),
            { to: "/my/area", label: "My patients", icon: Users },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: newOrder,
        };
      // An Rx CHC: the doctors' day of the Rx CHC Play Book (docs/PLAN.md 16.2). Telesales take
      // the orders and hold the sales targets; the CHC builds the doctors.
      if (me.channel?.code === "RX")
        return {
          // My orders right under "Log a call" (Aryan, 19 Nov); Care groups (the doctor's patients
          // the CHC enrols for MD Telesales) after the calls.
          ...desk([
            home,
            ordersLink("My orders"),
            { to: "/rx/doctors", label: "My doctors", icon: Stethoscope, short: "Doctors" },
            folder(
              "Calls",
              CalendarCheck,
              [
                { to: "/visits", label: "Today's calls", icon: CalendarCheck },
                { to: "/visits/plan", label: "Route plan", icon: CalendarRange },
                { to: "/visits/calendar", label: "Calendar", icon: CalendarDays },
                { to: "/visits/expenses", label: "My expenses", icon: Receipt },
                { to: "/me/samples", label: "My samples & gifts", icon: Gift },
              ],
              "Calls",
            ),
            { to: "/care-groups", label: "Patient care groups", icon: Users, short: "Groups" },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          cta: newOrder,
          cta2: { to: "/visits", label: "Log a call" },
        };
      // A PAP MedRep's patients come as cases (the guarantee letter's road), not plain orders.
      const pap = me.channel?.code === "PAP";
      return {
        ...desk([
          home,
          ...(pap
            ? [{ to: "/pap", label: "PAP cases", icon: HeartHandshake, short: "Cases" }]
            : []),
          ordersLink("My orders"),
          folder(
            "Visits",
            CalendarCheck,
            [
              { to: "/visits", label: "Today's visits", icon: CalendarCheck },
              { to: "/visits/calendar", label: "Calendar", icon: CalendarDays },
              { to: "/visits/plan", label: "Visit plan", icon: CalendarRange },
              { to: "/visits/expenses", label: "My expenses", icon: Receipt },
                { to: "/me/samples", label: "My samples & gifts", icon: Gift },
            ],
            "Visits",
          ),
          { to: "/my/area", label: pap ? "My patients" : "My area", icon: pap ? Users : MapPin },
          { to: "/to-call", label: pap ? "Patients to call" : "Customers to call", icon: PhoneCall, badge: "refills", short: "Call" },
          { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
        ]),
        cta: newOrder,
        ...(pap ? { cta2: { to: "/pap?new=1", label: "New PAP case" } } : {}),
      };
    }
    case "management":
      // One common screen for the whole of Management (Aryan, 18 Nov): the desk's work first (its
      // people with their Start sit right under it in the menu), then what it looks things up in.
      return {
        key: "desk",
        label: me.roleLabel,
        icon: ClipboardCheck,
        tone: "bg-brand text-white",
        groups: [
          {
            items: [
              // Home is the desk: every order to approve, each with its person's name.
              { ...home, label: "Orders to approve", icon: ClipboardCheck, badge: "awaiting", short: "Approve" },
              // Each person's figures: hours started, given, approved, time per order, late.
              { to: "/desk/team", label: "Team figures", icon: BarChart3, short: "Team" },
              // What stopped: one folder (Aryan) for the lists.
              folder(
                "Stopped orders",
                TriangleAlert,
                [
                  { to: "/orders/sent-back", label: "Sent back", icon: Undo2, badge: "sentBack" },
                  { to: "/on-hold", label: "On hold", icon: TriangleAlert, badge: "flagged" },
                  // Orders that haven't moved for two days at Finance or Dispatch, to chase.
                  { to: "/orders?stuck=1", label: "Stuck over 2 days", icon: Timer },
                  { to: "/returns?status=requested", label: "Returns to approve", icon: PackageX },
                ],
                "Stopped",
              ),
              // Customers a MedRep added from the field that nobody has checked yet.
              {
                to: "/customers?review=1",
                label: "Customers to check",
                icon: UserPlus,
                badge: "customers",
                short: "To check",
              },
            ],
          },
          {
            title: "Look up",
            items: [
              { to: "/orders", label: "All orders", icon: ClipboardList, short: "Orders" },
              stockLink,
              folder(
                "Customers",
                Users,
                [
                  { to: "/hospitals", label: "Hospitals", icon: Building2 },
                  { to: "/doctors", label: "Doctors", icon: Stethoscope },
                  { to: "/patients", label: "Patients", icon: User },
                ],
                "Customers",
              ),
            ],
          },
        ],
      };
    case "team_lead":
    case "manager":
      // Modern Trade's COO (docs/PLAN.md 16.7): nobody under her; she looks after the chains.
      if (me.role === "manager" && me.channel?.code === "MT")
        return {
          ...desk([
            home,
            { to: "/my/area", label: "Chains", icon: Building2, short: "Chains" },
            { to: "/mt/listings", label: "Listings", icon: FileText },
            ordersLink("Orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
            { to: "/targets", label: "Targets", icon: Target },
          ]),
          icon: Users,
          cta: newOrder,
        };
      // The Government Bidding Admin: approves bid prices, keeps the company's papers, the team's tenders.
      if (me.role === "team_lead" && me.channel?.code === "BID")
        return {
          cta: newOrder,
          ...desk([
            home,
            { to: "/tenders", label: "Tenders", icon: FileText, short: "Tenders" },
            { to: "/company-papers", label: "Documents", icon: ClipboardCheck },
            ordersLink("Team orders"),
            { to: "/collections", label: "Collections", icon: HandCoins },
            folder(
              "My team",
              Users,
              [
                { to: "/my-team", label: "Whole team", icon: Users, teams: true },
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Team",
            ),
            { to: "/customers", label: "Agencies & hospitals", icon: Building2 },
          ]),
          icon: Users,
        };
      // The B2B Sales Coach (and the district coach): the NBD pipeline, the CRR accounts, hand-overs.
      if (me.role === "team_lead" && me.channel?.code === "B2B")
        return {
          cta: newOrder,
          ...desk([
            home,
            folder(
              "My team",
              Users,
              [
                { to: "/my-team", label: "Whole team", icon: Users, teams: true },
                { to: "/team-scores", label: "Scorecards", icon: Gauge },
              ],
              "Team",
            ),
            ordersLink("Team orders"),
            { to: "/targets", label: "Targets", icon: Target },
            { to: "/collections", label: "Collections", icon: HandCoins },
            folder(
              "Team attendance",
              CalendarClock,
              [
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Attendance",
            ),
            { to: "/customers", label: "Accounts", icon: Building2 },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          icon: Users,
        };
      // The Sales & Marketing Mentor: B2B (and Bidding and CLIDP as they are built).
      if (me.role === "manager" && me.channel?.code === "B2B")
        return {
          cta: newOrder,
          ...desk([
            home,
            { to: "/my-team", label: "Whole business", icon: Users, teams: true },
            { to: "/tenders", label: "Tenders", icon: FileText },
            { to: "/team-scores", label: "Scorecards", icon: Gauge, short: "Scores" },
            { to: "/targets", label: "Targets", icon: Target },
            { to: "/collections", label: "Collections", icon: HandCoins },
            ordersLink("Business orders"),
            folder(
              "Attendance",
              CalendarClock,
              [
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Attendance",
            ),
            { to: "/customers", label: "Accounts", icon: Building2 },
          ]),
          icon: Users,
        };
      // The Sales Coach of MD Telesales: the team's number, the groups answered in time, refills.
      if (me.role === "team_lead" && me.channel?.code === "TS" && me.business === "RX")
        return {
          cta: newOrder,
          ...desk([
            home,
            folder(
              "My team",
              Users,
              [
                { to: "/my-team", label: "Whole team", icon: Users, teams: true },
                { to: "/team-scores", label: "Scorecards", icon: Gauge },
              ],
              "Team",
            ),
            { to: "/care-groups", label: "Care groups", icon: Users, short: "Groups" },
            { to: "/to-call", label: "Refills due", icon: Pill, badge: "refills", short: "Refills" },
            ordersLink("Team orders"),
            { to: "/targets", label: "Targets", icon: Target },
            { to: "/collections", label: "Collections", icon: HandCoins },
            folder(
              "Team attendance",
              CalendarClock,
              [
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Attendance",
            ),
            { to: "/customers", label: "Patients & doctors", icon: Users },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          icon: Users,
        };
      // The Country Mentor, head of the Prescription business: field and telesales together.
      if (me.role === "manager" && me.channel?.code === "RX")
        return {
          cta: newOrder,
          ...desk([
            home,
            { to: "/rx/field", label: "Field team", icon: Stethoscope },
            { to: "/my-team", label: "Whole business", icon: Users, teams: true },
            { to: "/care-groups", label: "Care groups", icon: Users, short: "Groups" },
            { to: "/team-scores", label: "Scorecards", icon: Gauge, short: "Scores" },
            { to: "/targets", label: "Targets", icon: Target },
            { to: "/collections", label: "Collections", icon: HandCoins },
            ordersLink("Business orders"),
            folder(
              "Field visits",
              CalendarCheck,
              [
                { to: "/field/report", label: "Visits report", icon: BarChart3 },
                { to: "/field/live", label: "Where the team is", icon: MapPin },
                { to: "/visits/expenses?waiting=1", label: "Expenses to approve", icon: Receipt },
                { to: "/field/samples", label: "Team samples & gifts", icon: Gift },
              ],
              "Visits",
            ),
            folder(
              "Attendance",
              CalendarClock,
              [
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Attendance",
            ),
            { to: "/customers", label: "Doctors & patients", icon: Users },
          ]),
          icon: Users,
        };
      // A District Sales Coach of the Hospital Division: the coach's day (docs/PLAN.md 16.1).
      if (me.role === "team_lead" && me.channel?.code === "HOSP")
        return {
          ...desk([
            home,
            folder(
              "My team",
              Users,
              [
                { to: "/my-team", label: "Whole team", icon: Users, teams: true },
                { to: "/team-scores", label: "Scorecards", icon: Gauge },
              ],
              "Team",
            ),
            { to: "/huddle", label: "Team huddle", icon: Megaphone, short: "Huddle" },
            { to: "/to-call", label: "Hospitals to call", icon: PhoneCall, badge: "refills" },
            { to: "/collections", label: "Collections", icon: HandCoins },
            ordersLink("Team orders"),
            folder(
              "Team visits",
              CalendarCheck,
              [
                { to: "/field/report", label: "Visits report", icon: BarChart3 },
                { to: "/visits/calendar", label: "Team calendar", icon: CalendarDays },
                { to: "/field/live", label: "Where the team is", icon: MapPin },
                { to: "/visits/expenses?waiting=1", label: "Expenses to approve", icon: Receipt },
                { to: "/field/samples", label: "Team samples & gifts", icon: Gift },
              ],
              "Visits",
            ),
            { to: "/targets", label: "Targets", icon: Target },
            folder(
              "Team attendance",
              CalendarClock,
              [
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Attendance",
            ),
            { to: "/customers", label: "Hospitals & doctors", icon: Building2 },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ]),
          icon: Users,
          cta: newOrder,
        };
      // The Business Mentor, head of the Hospital Division: the division's month (docs/PLAN.md 16.1).
      if (me.role === "manager" && me.channel?.code === "HOSP")
        return {
          cta: newOrder,
          ...desk([
            home,
            folder(
              "Teams",
              Users,
              [
                { to: "/my-team", label: "Whole division", icon: Users, teams: true },
                { to: "/huddle", label: "Team huddle", icon: Megaphone },
              ],
              "Teams",
            ),
            { to: "/team-scores", label: "Scorecards", icon: Gauge, short: "Scores" },
            { to: "/targets", label: "Targets", icon: Target },
            { to: "/collections", label: "Collections", icon: HandCoins },
            { to: "/to-call", label: "Hospitals to call", icon: PhoneCall, badge: "refills" },
            { to: "/tenders", label: "Government tenders", icon: FileText },
            ordersLink("Division orders"),
            folder(
              "Visits",
              CalendarCheck,
              [
                { to: "/field/report", label: "Visits report", icon: BarChart3 },
                { to: "/field/live", label: "Where the team is", icon: MapPin },
                { to: "/visits/expenses?waiting=1", label: "Expenses to approve", icon: Receipt },
                { to: "/field/samples", label: "Team samples & gifts", icon: Gift },
              ],
              "Visits",
            ),
            folder(
              "Attendance",
              CalendarClock,
              [
                { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
                { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
              ],
              "Attendance",
            ),
            { to: "/customers", label: "Hospitals & doctors", icon: Building2 },
          ]),
          icon: Users,
        };
      // Home is the team's month: each person against their target.
      return {
        ...desk([
          home,
          // The PAP head approves the PAP orders (not Management): one link straight to them.
          ...(me.channel?.code === "PAP"
            ? [
                {
                  to: "/orders?stage=management",
                  label: "PAP orders to approve",
                  icon: ClipboardCheck,
                  short: "Approve",
                },
              ]
            : []),
          folder(
            "My team",
            Users,
            [
              { to: "/my-team", label: "Whole team", icon: Users, teams: true },
              { to: "/team-scores", label: "Scorecards", icon: Gauge },
              { to: "/to-call", label: "Customers to call", icon: PhoneCall, badge: "refills" },
              { to: "/my/score", label: "My score", icon: Gauge },
            ],
            "Team",
          ),
          ordersLink("Team orders"),
          folder(
            "Team visits",
            CalendarCheck,
            [
              { to: "/field/report", label: "Visits report", icon: BarChart3 },
              { to: "/visits/calendar", label: "Team calendar", icon: CalendarDays },
              { to: "/field/live", label: "Where the team is", icon: MapPin },
              { to: "/visits/expenses?waiting=1", label: "Expenses to approve", icon: Receipt },
                { to: "/field/samples", label: "Team samples & gifts", icon: Gift },
            ],
            "Visits",
          ),
          { to: "/targets", label: "Targets", icon: Target },
          folder(
            "Team attendance",
            CalendarClock,
            [
              { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
              { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
            ],
            "Attendance",
          ),
          customers,
        ]),
        icon: Users,
        cta: newOrder,
      };
    case "online":
      // Leads & enquiries is the desk: every order starts as a case there.
      return {
        ...desk(
          [
            // The B2C CHC's day (docs/PLAN.md 16.3): Home is the morning pulse and the waiting replies.
            home,
            { to: "/leads", label: "Leads & enquiries", icon: Inbox },
            { to: "/inbox", label: "Inbox", icon: MessagesSquare, badge: "inbox" },
            { to: "/to-call", label: "Refills due", icon: Pill, badge: "refills", short: "Refills" },
            { to: "/orders", label: "My orders", icon: ClipboardList },
            { to: "/customers", label: "Patients", icon: Users },
            { to: "/points", label: "Points", icon: Gift },
            { to: "/my/score", label: "My score", icon: Gauge, short: "Score" },
          ],
          Inbox,
        ),
        cta: { to: "/leads?new=1", label: "New lead" },
      };
    case "finance":
      // Its own work first (the board is its Home), then the money lists, then what it looks up.
      return {
        key: "desk",
        label: me.roleLabel,
        icon: HandCoins,
        tone: "bg-brand text-white",
        groups: [
          {
            // One common screen for the whole of Finance, like Management's (Aryan, 18 Nov): the
            // desk's work first (its people with their Start sit right under it in the menu).
            items: [
              // Finance's three main bars (Aryan, 18 Nov): the orders to check, the prepaid ones, and
              // the money that comes later by its terms (cash on delivery, 30 days, 45 days…).
              { to: "/", label: "Orders to check", icon: ClipboardCheck, badge: "finance" },
              { to: "/finance/prepaid", label: "Prepaid orders", icon: CreditCard, short: "Prepaid" },
              // Its count: the payments past their day (cash on delivery once delivered, credit's days).
              { to: "/collect", label: "Due payments", icon: Wallet, short: "Due", badge: "latePayments" },
              // Money going out, every day: refunds owed to customers and suppliers' bills to pay.
              { to: "/refunds", label: "Refunds owed", icon: Undo2, badge: "refunds", short: "Refunds" },
              { to: "/purchases/bills", label: "Supplier bills to pay", icon: Receipt, short: "Bills" },
              { to: "/desk/team", label: "Team figures", icon: BarChart3, short: "Team" },
              folder("Money", Banknote, moneyLinks.filter((link) => link.to !== "/refunds"), "Money"),
              folder("Books", Landmark, booksLinks, "Books"),
            ],
          },
          {
            title: "Look up",
            items: [
              { to: "/orders", label: "All orders", icon: ClipboardList },
              { to: "/finance/mine", label: "Confirmations by this login", icon: CheckCheck },
              { to: "/medicines", label: "Inventory", icon: Boxes },
              { to: "/customers", label: "Customers", icon: Users },
            ],
          },
        ],
      };
    case "dispatch":
      // Its own work first (the board is its Home), then what it looks up and moves.
      return {
        key: "desk",
        label: me.roleLabel,
        icon: Truck,
        tone: "bg-brand text-white",
        groups: [
          {
            // Home is the warehouse's queue (to pack, to ship, came back); the road and the
            // holds have their own links, like Management's.
            items: [
              { ...home, label: "Orders to pack & ship", icon: Truck, badge: "dispatch", short: "Pack" },
              // Each person's figures, like Management's: hours started, given, packed, time per order.
              { to: "/desk/team", label: "Team figures", icon: BarChart3, short: "Team" },
              { to: "/orders", label: "All orders", icon: ClipboardList, short: "Orders" },
              {
                to: "/shipments",
                label: "On the road",
                icon: Truck,
                badge: "onTheWay",
                short: "Road",
              },
              {
                to: "/dispatch/hold",
                label: "On hold",
                icon: TriangleAlert,
                badge: "dispatchHeld",
              },
              { to: "/returns?status=approved", label: "Returns to check", icon: PackageX },
            ],
          },
          {
            title: "Look up",
            items: [stockLink, { to: "/customers", label: "Customers", icon: Users }],
          },
        ],
      };
    case "hr":
      // HR's Home is People: everyone's record, new joiners, who left.
      return {
        ...desk([
          { ...home, label: "People", icon: Users },
          { to: "/hr/people?view=joining", label: "Joining", icon: UserPlus },
          { to: "/hr/attendance", label: "Who's working", icon: CalendarClock },
          { to: "/hr/leave", label: "Leave & forms", icon: CalendarDays, badge: "leave" },
          { to: "/hr/payroll", label: "Payroll", icon: Wallet },
          { to: "/hr/report", label: "Attendance report", icon: BarChart3 },
        ]),
        icon: Users,
      };
    case "staff":
      // The office staff (Digital Marketing, IT): their Home is their work log, written when they
      // like (Aryan, 17 Nov: optional). No stock, no customers.
      return {
        key: "desk",
        label: seatWords(me).desk,
        icon: NotebookPen,
        tone: "bg-brand text-white",
        groups: [{ items: [{ ...home, label: "My work log", icon: NotebookPen }] }],
      };
    case "regulatory":
      // In-licensing & Regulatory (docs/PLAN.md 16.9): the pipeline and the FDA registrations, their
      // own team's first; the medicines list to look things up; the work log if they want it.
      const mentorLogs = /mentor/i.test(me.title ?? "") ? [{ to: "/work-logs", label: "Team's work logs", icon: NotebookPen }] : [];
      return {
        ...desk(
          /in-?licens/i.test(me.title ?? "")
            ? [
                home,
                { to: "/regulatory/pipeline", label: "Pipeline", icon: FlaskConical },
                { to: "/regulatory/registrations", label: "Registrations (CPRs)", icon: ShieldCheck, short: "CPRs" },
                { to: "/work-log", label: "My work log", icon: NotebookPen },
                ...mentorLogs,
              ]
            : [
                home,
                { to: "/regulatory/registrations", label: "Registrations (CPRs)", icon: ShieldCheck, short: "CPRs" },
                { to: "/regulatory/pipeline", label: "Pipeline", icon: FlaskConical },
                { to: "/work-log", label: "My work log", icon: NotebookPen },
                ...mentorLogs,
              ],
          FlaskConical,
        ),
      };
    case "inventory":
      return inventoryApp(me);
    case "admin":
      // The Admin login's desk is the Admin panel: setting the company up, apart from the CEO.
      return adminPanel(me);
    case "ceo":
      return {
        key: "desk",
        label: me.roleLabel,
        icon: LayoutGrid,
        tone: "bg-brand text-white",
        groups: [
          {
            items: [
              home,
              folder(
                "Company",
                Network,
                [
                  { to: "/my-team", label: "Company view", icon: BarChart3, teams: true },
                  { to: "/company/sales", label: "Sales organisation", icon: Network },
                  { to: "/company/map", label: "Map", icon: MapPin },
                  { to: "/company", label: "Company chart", icon: Network },
                  { to: "/audit", label: "Audit", icon: ScrollText },
                ],
                "Company",
              ),
            ],
          },
          // The two reports that matter most (Aryan, 18 Nov): every customer, every channel.
          {
            title: "Key reports",
            items: [
              { to: "/key-reports/target-sheet", label: "Target sheet", icon: Target },
              { to: "/key-reports/customers", label: "Customers", icon: Users },
              { to: "/key-reports/channels", label: "Channels", icon: Network },
            ],
          },
          // Zoho CRM's reports, by name for now (Aryan, 18 Nov): one link per group.
          {
            title: "Zoho CRM reports",
            items: ZOHO_REPORT_GROUPS.map((group) => ({ to: `/zoho-reports/${group.key}`, label: group.label, icon: FileBarChart })),
          },
          {
            title: "Apps",
            // Each app opens under its own name here: the sidebar stays the CEO's.
            items: appsFor(me).map((app) =>
              folder(
                app.label,
                app.icon,
                app.groups.flatMap((group) => group.items),
              ),
            ),
          },
        ],
      };
  }
}

/** The Admin panel, the Admin login's own desk: where the company is set up (its channels, who
 *  heads each, the teams with their leads and MedReps, the areas, the asks for people, targets
 *  and the company's details), apart from the CEO's figures. The apps stay as folders, to look. */
function adminPanel(me: Me): Space {
  return {
    key: "desk",
    label: "Admin panel",
    icon: Settings,
    tone: "bg-slate-700 text-white",
    groups: [
      {
        items: [
          { to: "/", label: "Channels", icon: Network },
          { to: "/people", label: "Teams & people", icon: Users },
          { to: "/people?tab=areas", label: "Areas", icon: MapPin },
          {
            to: "/people?tab=requests",
            label: "Asks for people",
            icon: UserPlus,
            badge: "orgRequests",
          },
          { to: "/people?tab=approvers", label: "Who approves what", icon: ShieldCheck },
          { to: "/targets", label: "Targets", icon: Target },
          // Once, from the old system's orders: who sold to each old customer, placed in a seat here.
          { to: "/admin/zoho-sellers", label: "Old customers to seats", icon: Link2 },
          // The 2026 chart as the CRM is built to it: every box, seat, work and desk.
          { to: "/admin/company-chart", label: "Company chart (as built)", icon: Network },
        ],
      },
      {
        title: "Company",
        items: [
          { to: "/settings", label: "Company details", icon: Building2 },
          { to: "/channels", label: "Online pages & mail", icon: Radio },
          // The data checked against itself: every bill, payment, return and shelf adds up.
          { to: "/admin/data-checks", label: "Data checks", icon: ShieldCheck },
          { to: "/audit", label: "Audit", icon: ScrollText },
        ],
      },
    ],
  };
}
const ADMIN_PANEL_PATHS = ["/people"];

/** The menu for the page that is open: an app's while inside it, else the person's desk. */
export function spaceFor(me: Me, pathname: string): Space {
  const desk = deskFor(me);
  // The CEO's and the Admin's sidebar holds every app as a folder: it never swaps for another,
  // but for the Admin panel, which is its own place.
  if (me.role === "admin") return desk;
  if (me.role === "ceo")
    return under(pathname, ADMIN_PANEL_PATHS)
      ? { ...adminPanel(me), back: { to: "/", label: `Back to ${me.roleLabel}` } }
      : desk;
  // A page the person's own sidebar lists (Management's "Medicines & stock", say) keeps that
  // sidebar: following one's own link never swaps the menu for another app's.
  const listed = desk.groups.some((group) =>
    allItems(group.items).some((item) => {
      const path = item.to.split("?")[0] ?? "";
      return path !== "/" && (pathname === path || pathname.startsWith(`${path}/`));
    }),
  );
  if (listed) return desk;
  if (me.role !== "inventory" && under(pathname, INVENTORY_PATHS))
    return { ...inventoryApp(me), back: { to: "/", label: `Back to ${me.roleLabel}` } };
  return desk;
}
