// Home, by who is asking. The Admin and the CEO get the page of apps; the Inventory officer
// starts in Inventory; everyone else gets their own desk: who they are, their area, and only
// the work that is theirs.

import type { MyArea, Overview, StockNews } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Building2, Stethoscope, User, UserPlus } from "lucide-react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { NewsList } from "../inventory/news";
import { count, Facts, PageHead, Panel, Tile } from "../ui";
import { CeoHomePage } from "./ceo-home";
import { Attention } from "./inventory-overview";
import { ManagementHome } from "./management-home";
import { MedrepHome } from "./medrep-home";
import { OrdersToCheck } from "./orders-board";
import { TeamSalesPage } from "./team";

export function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-PH", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Manila",
    }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export const todayWords = () =>
  new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Manila",
  }).format(new Date());

export function Home() {
  const me = useMe().data;
  if (!me) return null;
  if (me.role === "admin" || me.role === "ceo") return <CeoHomePage />;
  if (me.role === "team_lead" || me.role === "manager") return <TeamSalesPage />;
  if (me.role === "inventory") return <Navigate to="/inventory/overview" replace />;
  if (me.role === "management") return <ManagementHome />;
  if (me.role === "finance") return <OrdersToCheck desk="finance" />;
  if (me.role === "dispatch") return <OrdersToCheck desk="dispatch" />;
  if (me.role === "medrep") return <MedrepHome />;
  if (me.role === "online") return <Navigate to="/leads" replace />;
  return <Desk />;
}

function Desk() {
  const me = useMe().data;
  const reviews = me?.role === "management";
  const overview = useQuery({
    queryKey: ["inventory", "overview"],
    queryFn: () => api<Overview>("/api/overview"),
    enabled: Boolean(reviews),
  });
  const news = useQuery({
    queryKey: ["inventory", "news"],
    queryFn: async () => (await api<{ news: StockNews[] }>("/api/stock-news")).news,
    enabled: Boolean(me),
  });
  const area = useQuery({
    queryKey: ["customers", "area"],
    queryFn: () => api<MyArea>("/api/my/area"),
    enabled: Boolean(me?.area),
  });
  if (!me) return null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHead title={`${greeting()}, ${me.name.split(" ")[0]}`} sub={todayWords()}>
        <Facts
          rows={[
            [
              "Role",
              me.title && me.title !== me.roleLabel
                ? `${me.roleLabel} · ${me.title}`
                : me.roleLabel,
            ],
            ["Channel", me.channel ? `${me.channel.code} · ${me.channel.name}` : null],
            ["Area", me.area?.name],
            ["Cities", me.area?.cities.join(", ")],
            [
              "Reports to",
              me.reportsTo
                ? me.reportsTo.title
                  ? `${me.reportsTo.name}, ${me.reportsTo.title}`
                  : me.reportsTo.name
                : null,
            ],
          ]}
        />
      </PageHead>

      {reviews && Boolean(overview.data?.toReview) && (
        <Attention
          to="/customers?review=1"
          tone="warn"
          icon={UserPlus}
          value={overview.data?.toReview as number}
          label="New customers to check"
        />
      )}

      {area.data && me.area && (
        <div className="grid grid-cols-3 gap-3">
          <Tile
            to="/my/area?kind=hospital"
            label="My hospitals"
            value={count(area.data.counts.hospital ?? 0)}
            sub={me.area.name}
            icon={Building2}
          />
          <Tile
            to="/my/area?kind=doctor"
            label="My doctors"
            value={count(area.data.counts.doctor ?? 0)}
            sub="In my area"
            icon={Stethoscope}
          />
          <Tile
            to="/my/area?kind=patient"
            label="My patients"
            value={count(area.data.counts.patient ?? 0)}
            sub="In my area"
            icon={User}
          />
        </div>
      )}

      {news.data && news.data.length > 0 && (
        <Panel title="Stock news" count={news.data.length}>
          <div className="px-5">
            <NewsList news={news.data} />
          </div>
        </Panel>
      )}
    </div>
  );
}
