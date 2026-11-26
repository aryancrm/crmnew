// The books' frame, drawn as Zoho Inventory and Zoho Books draw their own (docs/PLAN.md 17,
// docs/BOOKS-PLAN.md; measured in Zoho on 17–18 Nov 2026): the dark 220px menu (#21263c) with Zoho's
// sections and the open list in blue (#408dfb), the light top bar with "Search in Bills ( / )", the
// company and the person. For Finance, the CEO and the Admin it is the Books app: "Books", its own
// Home dashboard, Zoho Books' menu, a "+" to make anything, and Finance's own pages (orders to
// check, customers owe, refunds owed…) opening inside it. Inventory and Management keep the
// Inventory frame with the purchases. One module: the same screens and the same data either way.

import { Avatar } from "../account/avatar";
import { ArrowLeft, BarChart3, BookOpen, BookOpenCheck, ChevronDown, ChevronRight, HandCoins, House, Landmark, PackageOpen, Plus, Search, ShoppingBag, ShoppingBasket, ShoppingCart } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { LeavesArrow, useLeavesTo } from "../app-switch";
import { useMe } from "../auth";
import { kindByPath, LEDGER_ROLES } from "./kinds";
import { useOwnCompanyCode } from "../companies";

/** `ledger`: Books' own money, for Finance, the CEO and the Admin only. */
type NavItem = { label: string; to: string; ledger?: boolean };
type NavGroup = { label: string; icon: ReactNode; items: NavItem[]; ledger?: boolean };

const GROUPS: NavGroup[] = [
  {
    label: "Items",
    icon: <ShoppingBasket size={16} />,
    // Where the work is done first (Aryan, 18 Nov: "where does he enter it, so nothing is
    // entered twice"): a medicine, its prices and promos on its own page; Zoho's lists after.
    items: [
      { label: "Medicines & Prices", to: "/medicines" },
      { label: "Items", to: "/books/items" },
      { label: "Price Lists", to: "/books/pricelists" },
    ],
  },
  {
    label: "Inventory",
    icon: <PackageOpen size={16} />,
    items: [
      { label: "Stock on the Shelf", to: "/inventory" },
      { label: "Inventory Adjustments", to: "/books/inventoryadjustments" },
      { label: "Packages", to: "/books/packages" },
      { label: "Shipments", to: "/books/shipments" },
      { label: "Transfer Orders", to: "/books/transferorders" },
    ],
  },
  {
    label: "Sales",
    icon: <ShoppingCart size={16} />,
    items: [
      { label: "Customers", to: "/books/customers" },
      { label: "Sales Orders", to: "/books/salesorders" },
      { label: "Invoices", to: "/books/invoices" },
      { label: "Payments Received", to: "/books/paymentsreceived" },
      { label: "Sales Returns", to: "/books/salesreturns" },
      { label: "Credit Notes", to: "/books/creditnotes" },
      { label: "Credit Note Refunds", to: "/books/refunds", ledger: true },
    ],
  },
  // Finance's own desk (the CRM's invoices, payments, refunds), the same pages, inside Books.
  {
    label: "Finance",
    icon: <HandCoins size={16} />,
    ledger: true,
    items: [
      { label: "Orders to Check", to: "/books/finance/checks" },
      { label: "Customers Owe", to: "/books/finance/owed" },
      { label: "CRM Invoices", to: "/books/finance/invoices" },
      { label: "CRM Payments", to: "/books/finance/payments" },
      { label: "Refunds Owed", to: "/books/finance/refunds" },
      { label: "Returns", to: "/books/finance/returns" },
    ],
  },
  {
    label: "Purchases",
    icon: <ShoppingBag size={16} />,
    items: [
      { label: "Vendors", to: "/books/vendors" },
      { label: "Purchase Orders", to: "/books/purchaseorders" },
      { label: "Purchase Receives", to: "/books/purchasereceives" },
      { label: "Bills", to: "/books/bills" },
      { label: "Payments Made", to: "/books/paymentsmade" },
      { label: "Vendor Credits", to: "/books/vendorcredits" },
      { label: "Expenses", to: "/books/expenses", ledger: true },
      { label: "Recurring Expenses", to: "/books/recurringexpenses", ledger: true },
      { label: "Recurring Bills", to: "/books/recurringbills", ledger: true },
    ],
  },
  // Zoho Books' own (docs/PLAN.md 17).
  {
    label: "Banking",
    icon: <Landmark size={16} />,
    ledger: true,
    items: [
      { label: "Banking Overview", to: "/books/banking" },
      { label: "Transfers", to: "/books/transfers" },
      { label: "Deposits", to: "/books/deposits" },
    ],
  },
  {
    label: "Accountant",
    icon: <BookOpenCheck size={16} />,
    ledger: true,
    items: [
      { label: "Manual Journals", to: "/books/journals" },
      { label: "Chart of Accounts", to: "/books/accounts" },
      { label: "Fixed Assets", to: "/books/fixedassets" },
      { label: "Transaction Locking", to: "/books/locking" },
    ],
  },
  // The statements (docs/ERP-PLAN.md phase 1).
  {
    label: "Reports",
    icon: <BarChart3 size={16} />,
    items: [
      { label: "All Reports", to: "/books/reports" },
      { label: "General Ledger", to: "/books/reports/general-ledger", ledger: true },
      { label: "AR Aging Summary", to: "/books/reports/ar-aging", ledger: true },
      { label: "Profit and Loss", to: "/books/reports/profit-and-loss", ledger: true },
      { label: "Balance Sheet", to: "/books/reports/balance-sheet", ledger: true },
      { label: "Cash Flow", to: "/books/reports/cash-flow", ledger: true },
      { label: "Gross Profit", to: "/books/reports/gross-profit", ledger: true },
      { label: "Stock by Age", to: "/books/reports/stock-aging" },
    ],
  },
];

/** Who opens the books: the stock and money desks (the API checks it on every call too). */
const BOOK_ROLES = ["inventory", "management", "finance", "ceo", "admin"];

export function BooksShell() {
  const ownCode = useOwnCompanyCode();
  const me = useMe();
  const location = useLocation();
  const leavesTo = useLeavesTo();
  const segment = location.pathname.split("/")[2];
  const openGroup =
    GROUPS.find((group) => group.items.some((item) => item.to === `/books/${segment}` || (segment === "finance" && location.pathname.startsWith(item.to))))?.label ??
    (segment === "banking" || segment === "bankstatement" || segment === "reconcile" ? "Banking" : segment === "reports" ? "Reports" : !segment || segment === "home" ? "" : "Purchases");
  const [open, setOpen] = useState<Record<string, boolean>>({ [openGroup]: true });
  if (me.isPending) return null;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!BOOK_ROLES.includes(me.data.role)) return <Navigate to="/" replace />;
  const ledger = LEDGER_ROLES.includes(me.data.role);
  const homeLeaves = leavesTo(ledger ? "/books/home" : "/");
  const reportsLeave = leavesTo("/reports");
  const groups = GROUPS.filter((group) => ledger || !group.ledger).map((group) => ({ ...group, items: group.items.filter((item) => ledger || !item.ledger) }));
  const listName =
    segment === "home" ? "Customers" : segment === "finance" ? "Customers" : segment === "vendors" ? "Vendors" : segment === "customers" ? "Customers" : segment === "items" ? "Items" : segment === "accounts" ? "Chart of Accounts" : segment === "locking" ? "Transaction Locking" : segment === "bankstatement" || segment === "reconcile" ? "Banking" : segment === "banking" ? "Banking" : segment === "reports" ? "Reports" : (kindByPath(segment)?.plural ?? "Purchases");
  return (
    <div className="flex h-dvh overflow-hidden bg-white font-sans text-[13px] leading-[1.6] text-black">
      <nav aria-label="Books menu" className="flex w-[220px] shrink-0 flex-col overflow-y-auto bg-[#21263c] pb-4 text-[#f0f0f0] print:hidden">
        <Link to={ledger ? "/books/home" : "/"} className="flex h-[52px] shrink-0 items-center gap-2.5 bg-[#191d2f] px-4 text-[17px] font-medium text-white">
          {ledger ? <BookOpen size={20} aria-hidden="true" /> : <PackageOpen size={20} aria-hidden="true" />} {ledger ? "Books" : "Inventory"}
        </Link>
        <div className="mt-3 space-y-0.5 px-2.5">
          <NavLink
            to={ledger ? "/books/home" : "/"}
            className={({ isActive }) => `flex h-[30px] items-center gap-2.5 rounded-md px-2 ${isActive && ledger ? "bg-[#408dfb] text-white" : "hover:bg-white/5"}`}
          >
            <House size={16} aria-hidden="true" /> <span className="flex-1">Home</span>
            {homeLeaves && <LeavesArrow app={homeLeaves} className="text-white/70" />}
          </NavLink>
          {groups.map((group) => {
            const isOpen = open[group.label] ?? false;
            return (
              <div key={group.label}>
                <button
                  type="button"
                  onClick={() => setOpen({ ...open, [group.label]: !isOpen })}
                  className={`flex h-[30px] w-full items-center gap-2.5 rounded-md pr-2 pl-0 text-left hover:bg-white/5 ${isOpen && group.label === openGroup ? "bg-white/[0.06]" : ""}`}
                  aria-expanded={isOpen}
                >
                  <span className="w-3 text-white/50">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                  {group.icon}
                  {group.label}
                </button>
                {isOpen &&
                  group.items.map((item) => (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      end={item.to === "/books/reports"}
                      className={({ isActive }) =>
                        `my-0.5 flex h-[30px] items-center rounded-md pr-2 pl-10 ${isActive ? "bg-[#408dfb] text-white" : "hover:bg-white/5"}`
                      }
                      title={leavesTo(item.to) ? `${item.label}: opens ${leavesTo(item.to)}` : undefined}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {leavesTo(item.to) && <LeavesArrow app={leavesTo(item.to) as string} className="text-white/70" />}
                    </NavLink>
                  ))}
              </div>
            );
          })}
          <NavLink to="/reports" className="mt-2 flex h-[30px] items-center gap-2.5 rounded-md pr-2 pl-5 hover:bg-white/5">
            <BarChart3 size={16} aria-hidden="true" /> <span className="flex-1">Sales reports</span>
            {reportsLeave && <LeavesArrow app={reportsLeave} className="text-white/70" />}
          </NavLink>
        </div>
        <Link to="/" className="mx-2.5 mt-auto flex h-[34px] items-center gap-2.5 rounded-md border border-white/10 px-3 text-white/80 hover:bg-white/5">
          <ArrowLeft size={15} aria-hidden="true" /> Back to the CRM
        </Link>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[#f0f0f0] bg-[#f7f7fe] px-4 print:hidden">
          <TopSearch listName={listName} />
          <div className="ml-auto flex items-center gap-3 text-[13px] text-[#222536]">
            <span className="hidden sm:inline">{ownCode}</span>
            {ledger && <QuickCreate />}
            <Link to="/profile" className="flex items-center gap-1.5" title={me.data.name} aria-label={`${me.data.name}: my profile`}>
              <Avatar person={me.data} size="xs" />
              <span className="hidden max-w-32 truncate md:inline">{me.data.name}</span>
            </Link>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** "Search in Bills ( / )": the open list, searched by number, reference or name; "/" jumps here. */
function TopSearch({ listName }: { listName: string }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState(params.get("q") ?? "");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => setText(params.get("q") ?? ""), [params]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <form
      className="flex h-[34px] w-[min(420px,50vw)] items-center rounded-[7px] bg-[#ededf7]"
      onSubmit={(event) => {
        event.preventDefault();
        // From a document, the search goes back to its list.
        const list = location.pathname.split("/").slice(0, 3).join("/");
        const next = new URLSearchParams(params);
        if (text.trim()) next.set("q", text.trim());
        else next.delete("q");
        next.delete("page");
        if (list !== location.pathname) navigate(`${list}?${next}`);
        else setParams(next);
      }}
    >
      <span className="flex h-full items-center gap-0.5 border-r border-[#d7d5e2] px-2 text-[#6c718a]">
        <Search size={15} aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </span>
      <input
        ref={box}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`Search in ${listName} ( / )`}
        aria-label={`Search in ${listName}`}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[#222536] outline-none placeholder:text-[#8e91a8]"
      />
    </form>
  );
}

/** Zoho Books' "+": make any document from anywhere in Books. Invoices come from an order. */
const QUICK: { group: string; items: [string, string][] }[] = [
  { group: "Sales", items: [["New Order (invoice)", "/orders/new"], ["Payment Received", "/books/paymentsreceived/new"], ["Credit Note", "/books/creditnotes/new"]] },
  { group: "Purchases", items: [["Expense", "/books/expenses/new"], ["Bill", "/books/bills/new"], ["Payment Made", "/books/paymentsmade/new"], ["Vendor Credit", "/books/vendorcredits/new"], ["Purchase Order", "/books/purchaseorders/new"], ["Vendor", "/books/vendors/new"]] },
  { group: "Banking", items: [["Transfer Fund", "/books/transfers/new"], ["Deposit", "/books/deposits/new"]] },
  { group: "Accountant", items: [["Manual Journal", "/books/journals/new"]] },
];
function QuickCreate() {
  const [open, setOpen] = useState(false);
  const leavesTo = useLeavesTo();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="relative">
      <button type="button" aria-label="Quick create" aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-[30px] place-items-center rounded-md bg-[#408dfb] text-white hover:bg-[#2f7ef0]">
        <Plus size={17} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 grid w-[min(560px,90vw)] gap-4 rounded-lg border border-[#ebeaf2] bg-white p-4 shadow-xl sm:grid-cols-4">
          {QUICK.map((group) => (
            <div key={group.group}>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-[#6c718a] uppercase">{group.group}</div>
              <ul className="space-y-1">
                {group.items.map(([label, to]) => (
                  <li key={to}>
                    <Link to={to} className="flex items-center gap-1 text-[13px] text-[#212529] hover:text-[#408dfb]">
                      <Plus size={12} /> {label}
                      {leavesTo(to) && <LeavesArrow app={leavesTo(to) as string} size={12} />}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** /books: Finance, the CEO and the Admin open Books' Home; Inventory and Management their purchases. */
export function BooksIndex() {
  const me = useMe();
  if (!me.data) return null;
  return <Navigate to={LEDGER_ROLES.includes(me.data.role) ? "/books/home" : "/books/purchaseorders"} replace />;
}

/** One of Finance's own pages, the very same component, inside the Books frame. */
export function InBooks({ children }: { children: ReactNode }) {
  const me = useMe();
  // Finance's pages open inside Books for those who keep the books; the others keep them in the CRM.
  if (me.data && !LEDGER_ROLES.includes(me.data.role)) return <Navigate to="/" replace />;
  return <div className="h-full overflow-y-auto bg-white p-4 sm:p-6">{children}</div>;
}
