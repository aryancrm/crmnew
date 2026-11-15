// The company tree, brought over from the old CRM as it was (frontend/components/company-tree.tsx
// and frontend/lib/company-tree.ts, copied unchanged into ./company/tree.ts): Org chart and Tree
// views, search, zoom, the details sheet. Its styles are scoped under `.ct`. The data is
// `/api/company/tree` in the shape the old tree draws; the month comes from the address.

import type { CompanyTreeData } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { mountTree, type TreeData } from "../company/tree";
import { PageState } from "../ui";

export function CompanyTreePage() {
  const [params] = useSearchParams();
  const asked = params.get("month") ?? "";
  const query = useQuery({
    queryKey: ["company", "tree", asked],
    queryFn: () => api<CompanyTreeData>(`/api/company/tree?month=${asked}`),
  });
  if (!query.data) return <PageState query={query} what="the company tree" />;
  // The page fills the space under the top bar, edge to edge, as the old one did.
  return (
    <div className="-mx-4 -mt-6 -mb-24 md:-mx-8 md:-mb-10">
      <CompanyTree data={query.data as unknown as TreeData} />
    </div>
  );
}

function CompanyTree({ data }: { data: TreeData }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    return mountTree(box.current, data);
  }, [data]);
  return (
    <>
      <style>{CSS}</style>
      <div ref={box} className="ct" />
    </>
  );
}

const CSS = `
.ct {
  --bg: #f4f3ee; --surface: #ffffff; --ink: #17201d; --muted: #69726e; --faint: #9aa29e; --line: #dcdfd8;
  --good: #168a52; --warn: #c27a0e; --bad: #d1463b; --none: #a7aeaa; --accent: #0f6b55; --on-accent: #ffffff;
  --glass: rgba(255, 255, 255, 0.88); --dot: rgba(23, 32, 29, 0.09);
  --shadow-lg: 0 30px 70px -28px rgba(20, 30, 26, 0.35), 0 2px 8px rgba(20, 30, 26, 0.06);
  --sans: "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  height: calc(100dvh - 3.5rem); display: grid; grid-template-rows: auto 1fr;
  background: var(--bg); color: var(--ink); font: 14px/1.45 var(--sans); -webkit-font-smoothing: antialiased;
}
@media (max-width: 767px) { .ct { height: calc(100dvh - 7.5rem - env(safe-area-inset-bottom)); } }
.ct [hidden] { display: none !important; }
.ct .top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; padding: 18px 24px 12px; }
.ct .over { margin: 0 0 6px; font: 700 11px/1 var(--sans); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.ct h1 { margin: 0; font: 700 26px/1.1 var(--sans); letter-spacing: -0.025em; }
.ct .sum { margin: 8px 0 0; font-size: 13px; color: var(--muted); }
.ct .sum b { color: var(--ink); font-weight: 700; }
.ct .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ct .seg { display: inline-flex; height: 38px; box-sizing: border-box; padding: 3px; border-radius: 19px; background: color-mix(in srgb, var(--ink) 7%, transparent); }
.ct .seg button { border: 0; border-radius: 16px; padding: 0 14px; background: transparent; color: var(--muted); font: 700 13px var(--sans); cursor: pointer; }
.ct .seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(20, 30, 26, 0.14); }
.ct .search { position: relative; }
.ct .search .mag { position: absolute; left: 13px; top: 11px; width: 16px; height: 16px; color: var(--faint); pointer-events: none; }
.ct .search input { width: 230px; height: 38px; box-sizing: border-box; padding: 0 14px 0 36px; border-radius: 19px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: 500 13px var(--sans); }
.ct .search input:focus { outline: none; border-color: var(--ink); }
.ct .results { position: absolute; z-index: 40; top: 44px; left: 0; width: 280px; max-width: 82vw; padding: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow-lg); display: grid; }
.ct .results button { all: unset; cursor: pointer; display: grid; padding: 8px 10px; border-radius: 10px; }
.ct .results button:hover, .ct .results button:focus-visible { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.ct .results small, .ct .results .empty { color: var(--muted); font-size: 12px; }
.ct .results .empty { padding: 8px 10px; }
.ct .ghost { height: 38px; padding: 0 14px; border: 0; border-radius: 19px; background: transparent; color: var(--ink); font: 700 13px var(--sans); cursor: pointer; }
.ct .ghost:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.ct .zoom { display: inline-flex; align-items: center; height: 38px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 19px; background: var(--surface); }
.ct .zoom button { width: 34px; height: 36px; border: 0; border-radius: 18px; background: transparent; color: var(--ink); font: 600 17px/1 var(--sans); cursor: pointer; }
.ct .zoom output { min-width: 42px; text-align: center; font: 700 12px var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.ct .vp { position: relative; overflow: hidden; touch-action: none; cursor: grab; min-height: 0; background-image: radial-gradient(var(--dot) 1.1px, transparent 1.3px); background-size: 24px 24px; }
.ct .vp.dragging { cursor: grabbing; }
.ct .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.ct .edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.ct .edges path { fill: none; stroke-width: 1.6; stroke-linecap: round; }
.ct .edges path.elbow { stroke: var(--line); stroke-width: 1.5; stroke-linecap: butt; }
.ct .node, .ct .row, .ct .card { appearance: none; margin: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; position: absolute; }
.ct .node { padding: 0; width: 188px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.ct .avawrap { position: relative; margin-bottom: 10px; }
.ct .ava { position: relative; display: grid; place-items: center; flex: none; border-radius: 50%; transition: box-shadow 0.2s; }
.ct .ava svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ct .track { fill: none; stroke: var(--line); stroke-width: 2.5; }
.ct .arc { fill: none; stroke-width: 2.5; stroke-linecap: round; }
.ct .arc.good { stroke: var(--good); } .ct .arc.warn { stroke: var(--warn); } .ct .arc.bad { stroke: var(--bad); }
.ct .disc { width: calc(100% - 12px); height: calc(100% - 12px); border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--hue) 14%, var(--surface)); color: color-mix(in srgb, var(--hue) 80%, var(--ink)); font-weight: 800; letter-spacing: 0.02em; line-height: 1; }
.ct .t-ceo .disc { background: var(--ink); color: var(--surface); }
.ct .t-channel .disc, .ct .t-dept .disc { background: var(--hue); color: #fff; letter-spacing: 0.08em; }
.ct .vacant .disc { background: transparent; border: 1.5px dashed var(--bad); color: var(--bad); box-sizing: border-box; }
.ct .t-rep.former .disc { background: transparent; border: 1.5px dashed var(--faint); color: var(--muted); box-sizing: border-box; }
.ct .node:hover .ava, .ct .row:hover .ava { box-shadow: 0 0 0 5px color-mix(in srgb, var(--hue) 13%, transparent); }
.ct .node.selected .ava, .ct .row.selected .ava { box-shadow: 0 0 0 6px color-mix(in srgb, var(--hue) 24%, transparent); }
.ct .node:focus-visible, .ct .row:focus-visible { outline: none; }
.ct .node:focus-visible .ava, .ct .row:focus-visible .ava { outline: 2px solid var(--ink); outline-offset: 4px; }
.ct .count { position: absolute; right: -4px; bottom: -2px; min-width: 22px; height: 20px; box-sizing: border-box; padding: 0 6px; border-radius: 10px; display: grid; place-items: center; background: var(--ink); color: var(--surface); font: 800 10.5px/1 var(--sans); border: 2px solid var(--bg); }
.ct .node .nm { max-width: 176px; font: 700 14.5px/1.25 var(--sans); letter-spacing: -0.005em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .t-head .nm { font-size: 16px; }
.ct .t-ceo .nm { font: 700 17px/1.2 var(--sans); letter-spacing: -0.015em; }
.ct .t-ceo .nm, .ct .t-ceo .meta { max-width: none; overflow: visible; }
.ct .node .meta { max-width: 176px; margin-top: 3px; font: 500 12px/1.3 var(--sans); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .node .fig { margin-top: 5px; font: 600 12.5px/1.3 var(--sans); color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ct .fig b, .ct .pc { font-weight: 800; font-variant-numeric: tabular-nums; }
.ct .good { color: var(--good); } .ct .warn { color: var(--warn); } .ct .bad { color: var(--bad); } .ct .none { color: var(--none); }
.ct .row { width: 172px; height: 52px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 6px; border-radius: 26px; text-align: left; transition: background 0.15s, box-shadow 0.15s; }
.ct .row:hover, .ct .row.selected { background: var(--surface); box-shadow: 0 8px 22px -12px rgba(20, 30, 26, 0.4); }
.ct .rt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.ct .row .nm { font: 700 13.5px/1.25 var(--sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .row .meta, .ct .row .money { display: block; margin-top: 1px; font: 500 11.5px/1.3 var(--sans); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .row .pc { flex: none; font-size: 12.5px; }
.ct .vac { margin-left: 6px; font: 800 9.5px var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--bad); }
.ct .card { height: 92px; box-sizing: border-box; display: grid; align-content: center; gap: 5px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); text-align: left; box-shadow: 0 1px 2px rgba(18, 38, 32, 0.06), 0 4px 14px rgba(18, 38, 32, 0.06); transition: border-color 0.15s, box-shadow 0.15s; }
.ct .card:hover { border-color: color-mix(in srgb, var(--hue) 55%, var(--line)); }
.ct .card:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ct .card.selected { border-color: color-mix(in srgb, var(--hue) 70%, var(--line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--hue) 18%, transparent), 0 4px 14px rgba(18, 38, 32, 0.08); }
.ct .card.t-ceo { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.ct .card.t-channel, .ct .card.t-dept { background: color-mix(in srgb, var(--hue) 8%, var(--surface)); border-color: transparent; }
.ct .card.vacant { border-style: dashed; border-color: var(--bad); }
.ct .card.former { border-style: dashed; }
.ct .card .row1 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.ct .card .name { font: 700 14px/1.25 var(--sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .card.t-ceo .name { font: 700 14.5px/1.2 var(--sans); }
.ct .card .pct { flex: none; font: 800 13px var(--sans); font-variant-numeric: tabular-nums; }
.ct .card .sub, .ct .card .nums { font: 500 11.5px/1.3 var(--sans); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ct .card.t-ceo .sub, .ct .card.t-ceo .nums, .ct .card.t-ceo .pct { color: color-mix(in srgb, var(--on-accent) 85%, transparent); }
.ct .cbar { position: relative; display: block; height: 5px; border-radius: 3px; background: var(--line); }
.ct .cbar i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; }
.ct .cbar i.good { background: var(--good); } .ct .cbar i.warn { background: var(--warn); } .ct .cbar i.bad { background: var(--bad); }
.ct .cbar b { position: absolute; top: -3px; bottom: -3px; width: 1.5px; background: var(--ink); opacity: 0.35; }
.ct .card.t-ceo .cbar { background: color-mix(in srgb, var(--on-accent) 25%, transparent); }
.ct .card.t-ceo .cbar i, .ct .card.t-ceo .cbar b { background: var(--on-accent); }
.ct .chip { position: absolute; right: -10px; top: 50%; transform: translateY(-50%); z-index: 2; width: 20px; height: 20px; border-radius: 10px; display: grid; place-items: center; font: 700 13px/1 var(--sans); background: var(--surface); color: var(--muted); border: 1px solid var(--line); }
.ct .vp.far .node .meta, .ct .vp.far .node .fig, .ct .vp.far .row .meta, .ct .vp.far .row .pc { visibility: hidden; }
.ct .vp:not(.near) .money { display: none; }
.ct .vp.near .row .meta { display: none; }
.ct .vp.far .card .sub, .ct .vp.far .card .cbar, .ct .vp.far .card .nums { display: none; }
.ct .enter { animation: ct-rise 0.28s ease-out both; }
@keyframes ct-rise { from { opacity: 0; transform: translateY(-6px); } }
.ct .flash .ava, .ct .card.flash { animation: ct-ping 1.3s ease-out; }
@keyframes ct-ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--hue) 55%, transparent); } 100% { box-shadow: 0 0 0 18px transparent; } }
.ct .legend { position: absolute; left: 20px; bottom: 18px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 9px 16px; border-radius: 999px; background: var(--glass); backdrop-filter: blur(10px); border: 1px solid var(--line); font: 600 11.5px var(--sans); color: var(--muted); cursor: auto; }
.ct .legend span { display: inline-flex; align-items: center; gap: 6px; }
.ct .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.ct .legend i.good { background: var(--good); } .ct .legend i.warn { background: var(--warn); } .ct .legend i.bad { background: var(--bad); } .ct .legend i.none { background: var(--line); }
.ct .panel { position: absolute; z-index: 30; top: 16px; right: 16px; bottom: 16px; width: 372px; max-width: calc(100% - 32px); box-sizing: border-box; overflow: auto; padding: 24px 24px 20px; background: var(--glass); backdrop-filter: blur(16px); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow-lg); display: grid; align-content: start; gap: 20px; cursor: auto; }
.ct .close { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border: 0; border-radius: 16px; background: transparent; color: var(--muted); font: 400 22px/1 var(--sans); cursor: pointer; }
.ct .close:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.ct .crumbs { margin: 0 40px -8px 0; font: 700 10.5px/1.4 var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.ct .ph { display: flex; align-items: center; gap: 16px; }
.ct .ph h2 { margin: 0; font: 700 23px/1.15 var(--sans); letter-spacing: -0.02em; }
.ct .ph .role { margin-top: 5px; font: 600 12.5px var(--sans); color: var(--muted); }
.ct .hero { display: flex; align-items: flex-end; gap: 12px; }
.ct .hero strong { font: 700 50px/0.9 var(--sans); letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.ct .hero span { padding-bottom: 4px; font: 600 12.5px/1.35 var(--sans); color: var(--muted); }
.ct .tbar { position: relative; display: block; height: 6px; margin-top: 18px; border-radius: 3px; background: var(--line); }
.ct .tbar i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; }
.ct .tbar i.good { background: var(--good); } .ct .tbar i.warn { background: var(--warn); } .ct .tbar i.bad { background: var(--bad); }
.ct .tbar b { position: absolute; top: -4px; bottom: -4px; width: 2px; border-radius: 1px; background: var(--ink); opacity: 0.45; }
.ct .pace { margin: 9px 0 0; font: 500 11.5px var(--sans); color: var(--muted); }
.ct .figs { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
.ct .figs div { padding: 13px 0; border-bottom: 1px solid var(--line); min-width: 0; }
.ct .figs div:nth-child(odd) { padding-right: 14px; border-right: 1px solid var(--line); }
.ct .figs div:nth-child(even) { padding-left: 16px; }
.ct .figs small { display: block; margin-bottom: 3px; font: 800 10px var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.ct .figs b { font: 700 16.5px var(--sans); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ct .who { margin: -6px 0 0; font: 600 13px var(--sans); color: var(--muted); }
.ct .facts { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: -4px 0 0; font-size: 13px; }
.ct .facts dt { color: var(--faint); font-weight: 600; }
.ct .facts dd { margin: 0; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
.ct .under h3 { margin: 0 0 6px; font: 800 10.5px var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.ct .under button { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 12px; padding: 7px 8px; border-radius: 16px; }
.ct .under button:hover, .ct .under button:focus-visible { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.ct .under .tx { flex: 1; min-width: 0; display: grid; }
.ct .under .n { font: 700 13.5px/1.3 var(--sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .under .m { font: 500 11.5px/1.3 var(--sans); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct .under .pc { font-size: 13px; }
.ct .note { margin: 0; font: 500 11.5px/1.5 var(--sans); color: var(--faint); }
@media (max-width: 640px) {
  .ct .top { padding: 14px 16px 10px; }
  .ct h1 { font-size: 22px; }
  .ct .tools { width: 100%; }
  .ct .search { flex: 1 1 100%; }
  .ct .search input { width: 100%; }
  .ct .legend { left: 12px; right: 12px; bottom: 10px; justify-content: center; font-size: 10.5px; gap: 4px 10px; padding: 7px 12px; }
  .ct .panel { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-width: none; max-height: 64%; }
}
@media (prefers-reduced-motion: reduce) { .ct .enter, .ct .flash .ava, .ct .card.flash { animation: none; } .ct .ava, .ct .row, .ct .card { transition: none; } }
`;
