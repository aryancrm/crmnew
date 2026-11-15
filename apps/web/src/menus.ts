// Who sees which menu. A person works at their own **desk** (only their own work), and an
// **app** (Inventory, Customers, Reports) has a menu of its own that shows while one of its
// pages is open. The Admin and the CEO start on a page of apps. Nothing here leads to a
// screen that isn't built.

import type { Me, Role } from "@2mg/api/types";
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BellRing,
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileText,
  Gift,
  HandCoins,
  House,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  MessagesSquare,
  Network,
  PackageCheck,
  Pill,
  Radio,
  ShoppingCart,
  SlidersHorizontal,
  Stethoscope,
  Target,
  Timer,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  UserPlus,
  Users,
} from "lucide-react";

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
  | "updates";
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
  /** The button on top of the menu, as the hub has "Create New Order". */
  cta?: { to: string; label: string };
  /** The way back to the person's own desk, when this is an app they stepped into. */
  back?: { to: string; label: string };
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

/** A MedRep's or a team's orders, by where they stand (the Orders page's own tabs). */
const orderStages = (sentBack: string): MenuItem[] => [
  { to: "/orders", label: "All", icon: ClipboardList },
  { to: "/orders?stage=sent_back", label: sentBack, icon: Undo2, badge: "sentBack" },
  { to: "/orders?stage=management", label: "With Management", icon: ClipboardCheck },
  { to: "/orders?stage=finance", label: "With Finance", icon: HandCoins },
  { to: "/orders?stage=dispatch", label: "Packing or on the way", icon: Truck },
  { to: "/orders?stage=held", label: "On hold", icon: TriangleAlert },
  { to: "/orders?stage=delivered", label: "Delivered this month", icon: PackageCheck },
];

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
          { to: "/medicines", label: "All medicines", icon: Pill },
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
          { to: "/inventory", label: "Stock", icon: Boxes },
          { to: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
          { to: "/transfers", label: "Transfers", icon: ArrowLeftRight },
        ],
      },
      {
        title: "Purchases",
        items: [
          ...(seesCost
            ? [
                { to: "/suppliers", label: "Suppliers", icon: Factory },
                { to: "/purchases", label: "Purchase orders", icon: ShoppingCart },
              ]
            : []),
          { to: "/receives", label: "Receives", icon: PackageCheck },
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
  groups: [{ items: orderLinks }],
  ...(me.role === "admin" ? { cta: newOrder } : {}),
});

/** Finance's own lists, after Zoho Books: what customers owe, invoices, payments, refunds. */
const moneyLinks: MenuItem[] = [
  { to: "/owed", label: "Customers owe", icon: HandCoins },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/payments", label: "Payments received", icon: Banknote },
  { to: "/refunds", label: "Refunds owed", icon: Undo2, badge: "refunds" },
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
        ...moneyLinks,
      ],
    },
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
        { to: "/shipments", label: "Shipments", icon: Truck },
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
        { to: "/inbox", label: "Inbox", icon: MessagesSquare, badge: "inbox" },
        { to: "/leads", label: "Leads & enquiries", icon: Inbox },
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
        { to: "/targets", label: "Targets", icon: Target },
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
        reportsApp,
      ]
    : [];

/** How long each desk keeps an order, and who is late: for the desks, team leads and the CEO. */
const speedLink: MenuItem = { to: "/speed", label: "Speed", icon: Timer };
const SPEED_ROLES: Role[] = [
  "ceo",
  "admin",
  "management",
  "finance",
  "dispatch",
  "team_lead",
  "manager",
];

/** Messages on everyone's desk: what needs them, the news (no bell to miss), and the chats. */
const messagesLink: MenuItem = folder(
  "Messages",
  MessageCircle,
  [
    { to: "/messages?box=important", label: "Needs you", icon: BellRing, badge: "important" },
    { to: "/messages?box=updates", label: "Updates", icon: Inbox, badge: "updates" },
    { to: "/messages", label: "Chats", icon: MessageCircle, badge: "messages" },
  ],
  "Messages",
);

/** Each role's own desk, with Messages on it. */
function deskFor(me: Me): Space {
  const space = ownDesk(me);
  const [first, ...rest] = space.groups;
  if (!first) return space;
  const listed = allItems(space.groups.flatMap((group) => group.items));
  const extra =
    SPEED_ROLES.includes(me.role) && !listed.some((item) => item.to === "/speed")
      ? [speedLink, messagesLink]
      : [messagesLink];
  return { ...space, groups: [{ ...first, items: [...first.items, ...extra] }, ...rest] };
}

/** Each role's own desk: only that person's work, and one link into the shared stock. */
function ownDesk(me: Me): Space {
  const desk = (items: MenuItem[], icon: LucideIcon = House): Space => ({
    key: "desk",
    label: me.roleLabel,
    icon,
    tone: "bg-brand text-white",
    groups: [{ items: [...items, stockLink] }],
  });
  switch (me.role) {
    case "medrep":
      return {
        ...desk([
          home,
          folder("My orders", ClipboardList, orderStages("Sent back to me"), "Orders"),
          { to: "/my/area", label: "My area", icon: MapPin },
        ]),
        cta: { ...newOrder, label: "New order" },
      };
    case "management":
      // As designed on the canvas: its own work first, then what it looks things up in.
      return {
        key: "desk",
        label: me.roleLabel,
        icon: ClipboardCheck,
        tone: "bg-brand text-white",
        groups: [
          {
            items: [
              // Home is the queue to approve (the waiting count sits on it); what waits on
              // others or is stopped has its own link.
              { ...home, badge: "awaiting" },
              { to: "/orders/sent-back", label: "Sent back", icon: Undo2, badge: "sentBack" },
              { to: "/on-hold", label: "On hold", icon: TriangleAlert, badge: "flagged" },
              { to: "/orders", label: "All orders", icon: ClipboardList, short: "Orders" },
              {
                to: "/customers?review=1",
                label: "Not checked yet",
                icon: UserPlus,
                badge: "customers",
                short: "To check",
              },
            ],
          },
          {
            title: "Look up",
            items: [
              stockLink,
              { to: "/hospitals", label: "Hospitals", icon: Building2 },
              { to: "/doctors", label: "Doctors", icon: Stethoscope },
              { to: "/patients", label: "Patients", icon: User },
            ],
          },
        ],
      };
    case "team_lead":
    case "manager":
      // Home is the team's month: each person against their target.
      return {
        ...desk([
          home,
          folder(
            "My team",
            Users,
            [{ to: "/my-team", label: "Whole team", icon: Users, teams: true }],
            "Team",
          ),
          folder("Team orders", ClipboardList, orderStages("Sent back"), "Orders"),
          { to: "/targets", label: "Targets", icon: Target },
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
            { to: "/inbox", label: "Inbox", icon: MessagesSquare, badge: "inbox" },
            { to: "/leads", label: "Leads & enquiries", icon: Inbox },
            { to: "/orders", label: "My orders", icon: ClipboardList },
            customers,
            { to: "/points", label: "Points", icon: Gift },
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
            items: [
              { to: "/", label: "Orders to check", icon: ClipboardCheck, badge: "finance" },
              ...moneyLinks,
              { to: "/orders", label: "All orders", icon: ClipboardList },
            ],
          },
          {
            title: "Look up",
            items: [
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
              { ...home, badge: "dispatch" },
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
              { to: "/orders", label: "All orders", icon: ClipboardList, short: "Orders" },
            ],
          },
          {
            title: "Look up",
            items: [stockLink, { to: "/customers", label: "Customers", icon: Users }],
          },
        ],
      };
    case "inventory":
      return inventoryApp(me);
    case "ceo":
    case "admin":
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
                  { to: "/company", label: "Company chart", icon: Network },
                  { to: "/people", label: "Teams & people", icon: Users },
                  { to: "/people?tab=areas", label: "Areas", icon: MapPin },
                  {
                    to: "/people?tab=requests",
                    label: "Requests",
                    icon: UserPlus,
                    badge: "orgRequests",
                  },
                ],
                "Company",
              ),
            ],
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

/** The menu for the page that is open: an app's while inside it, else the person's desk. */
export function spaceFor(me: Me, pathname: string): Space {
  const desk = deskFor(me);
  // The CEO's and the Admin's sidebar holds every app as a folder: it never swaps for another.
  if (APP_ROLES.includes(me.role)) return desk;
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
