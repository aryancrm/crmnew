// The books' frame, drawn as Zoho Inventory draws its own (docs/PLAN.md 17; measured in Zoho on
// 17 Nov 2026): the dark 220px menu (#21263c) with Zoho's sections and the open list in blue
// (#408dfb), the light top bar with "Search in Bills ( / )", the company and the person. A screen
// not moved into the books yet opens the CRM's own page for it.

import { BarChart3, BookOpenCheck, ChevronDown, ChevronRight, CircleUserRound, House, Landmark, PackageOpen, Search, ShoppingBag, ShoppingBasket, ShoppingCart } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../auth";
import { kindByPath, LEDGER_ROLES } from "./kinds";

/** `ledger`: Books' own money, for Finance, the CEO and the Admin only. */
type NavItem = { label: string; to: string; ledger?: boolean };
type NavGroup = { label: string; icon: ReactNode; items: NavItem[]; ledger?: boolean };

const GROUPS: NavGroup[] = [
  {
    label: "Items",
    icon: <ShoppingBasket size={16} />,
    items: [
      { label: "Items", to: "/books/items" },
      { label: "Price Lists", to: "/books/pricelists" },
    ],
  },
  {
    label: "Inventory",
    icon: <PackageOpen size={16} />,
    items: [
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
    ],
  },
  // The statements (docs/ERP-PLAN.md phase 1).
  {
    label: "Reports",
    icon: <BarChart3 size={16} />,
    items: [
      { label: "All Reports", to: "/books/reports" },
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
  const me = useMe();
  const location = useLocation();
  const segment = location.pathname.split("/")[2];
  const openGroup = GROUPS.find((group) => group.items.some((item) => item.to === `/books/${segment}`))?.label ?? (segment === "banking" ? "Banking" : segment === "reports" ? "Reports" : "Purchases");
  const [open, setOpen] = useState<Record<string, boolean>>({ [openGroup]: true });
  if (me.isPending) return null;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!BOOK_ROLES.includes(me.data.role)) return <Navigate to="/" replace />;
  const ledger = LEDGER_ROLES.includes(me.data.role);
  const groups = GROUPS.filter((group) => ledger || !group.ledger).map((group) => ({ ...group, items: group.items.filter((item) => ledger || !item.ledger) }));
  const listName =
    segment === "vendors" ? "Vendors" : segment === "customers" ? "Customers" : segment === "items" ? "Items" : segment === "accounts" ? "Chart of Accounts" : segment === "banking" ? "Banking" : segment === "reports" ? "Reports" : (kindByPath(segment)?.plural ?? "Purchases");
  return (
    <div className="flex h-dvh overflow-hidden bg-white font-sans text-[13px] leading-[1.6] text-black">
      <nav aria-label="Books menu" className="flex w-[220px] shrink-0 flex-col overflow-y-auto bg-[#21263c] pb-4 text-[#f0f0f0] print:hidden">
        <Link to="/" className="flex h-[52px] shrink-0 items-center gap-2.5 bg-[#191d2f] px-4 text-[17px] font-medium text-white">
          <PackageOpen size={20} aria-hidden="true" /> Inventory
        </Link>
        <div className="mt-3 space-y-0.5 px-2.5">
          <NavLink to="/" className="flex h-[30px] items-center gap-2.5 rounded-md px-2 hover:bg-white/5">
            <House size={16} aria-hidden="true" /> Home
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
                        `my-0.5 flex h-[30px] items-center rounded-md pr-6 pl-10 ${isActive ? "bg-[#408dfb] text-white" : "hover:bg-white/5"}`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
              </div>
            );
          })}
          <NavLink to="/reports" className="mt-2 flex h-[30px] items-center gap-2.5 rounded-md pl-5 hover:bg-white/5">
            <BarChart3 size={16} aria-hidden="true" /> Sales reports
          </NavLink>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[#f0f0f0] bg-[#f7f7fe] px-4 print:hidden">
          <TopSearch listName={listName} />
          <div className="ml-auto flex items-center gap-3 text-[13px] text-[#222536]">
            <span className="hidden sm:inline">2MG Inc. / GetMeds</span>
            <span className="flex items-center gap-1.5" title={me.data.name}>
              <CircleUserRound size={22} className="text-[#f76831]" aria-hidden="true" />
              <span className="hidden max-w-32 truncate md:inline">{me.data.name}</span>
            </span>
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
