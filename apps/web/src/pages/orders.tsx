// The log of every order (Management, Finance, Dispatch, CEO) and a MedRep's "My orders":
// one table with search and filters.

import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useMe } from "../auth";
import { PRIMARY_SM } from "../look";
import { OrdersTable } from "../orders/parts";
import { MyOrdersPage } from "./medrep-home";
import { OrdersToCheck } from "./orders-board";

export function Orders() {
  const me = useMe().data;
  // A MedRep's (and a team's) own orders are the same cards Management sees.
  if (me && ["medrep", "online", "team_lead", "manager"].includes(me.role)) return <MyOrdersPage />;
  const mine = me?.role === "medrep" || me?.role === "online";
  const team = me?.role === "team_lead" || me?.role === "manager";
  const places =
    me && ["medrep", "team_lead", "manager", "management", "online", "admin"].includes(me.role);
  // Management, Finance, Dispatch, the CEO: every order, drawn as Orders to check (Cards, Table, Board).
  if (!mine && !team) return <OrdersToCheck key="all" all />;
  return (
    <div className="mx-auto max-w-screen-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {mine ? "My orders" : team ? "Team orders" : "All orders"}
        </h1>
        {places && (
          <Link to="/orders/new" className={PRIMARY_SM}>
            <Plus className="size-4" /> New order
          </Link>
        )}
      </div>
      <OrdersTable title="Orders" />
    </div>
  );
}
