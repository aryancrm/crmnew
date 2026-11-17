// The map (the old CRM's Company → Map, brought back live): the Philippines by province and Metro
// Manila by city, each place coloured by how the seat that covers it is doing against its target,
// at the CRM's one pace. Nothing on it is typed for the map: the places come from each area's
// cities (read as PSGC codes by the API), the people from the chart's seats, the figures from the
// team board; a new area, a city added, a person joining or leaving shows by itself. Hover a place
// to see who covers it, under whom and their figures; click to open their page.

import type { TeamBoard, TeamTerritories } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { type MouseEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, shortPeso } from "../ceo";
import { TONE, type Tone, toneOf } from "../team/pace";
import { RangePicker, reportRange } from "../team/range";
import { TeamSwitch } from "../team/switch";
import { ZoomBox } from "../team/zoom";
import { PageState } from "../ui";

type MapData = {
  about: string;
  credit: string;
  viewBox: [number, number, number, number];
  insets: { ncr: [number, number, number, number] };
  regions: { code: string; name: string }[];
  areas: { code: string; name: string; level: string; region: string; d: string }[];
};

const NCR = "1300000000";
const FILL: Record<Tone | "empty", string> = {
  on: "#34d399",
  behind: "#fbbf24",
  far: "#fb7185",
  none: "#cbd5e1",
  vacant: "#fde68a",
  empty: "#eef2f6",
};

type Cover = TeamTerritories["territories"][number] & {
  sold: number;
  target: number | null;
  today: number;
};

export function CompanyMapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const unit = params.get("unit");
  const { from, to } = reportRange(params);
  const channel = params.get("channel") ?? "";
  const qs = new URLSearchParams();
  if (unit) qs.set("unit", unit);
  qs.set("from", from);
  qs.set("to", to);
  const map = useQuery({
    queryKey: ["maps", "ph-areas"],
    queryFn: async () => (await fetch("/maps/ph-areas.json")).json() as Promise<MapData>,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const board = useQuery({
    queryKey: ["team", "board", unit ?? "", from, to],
    queryFn: () => api<TeamBoard>(`/api/team/board${qs.size ? `?${qs}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const places = useQuery({
    queryKey: ["team", "territories", unit ?? ""],
    queryFn: () => api<TeamTerritories>(`/api/team/territories${unit ? `?unit=${unit}` : ""}`),
  });
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);

  // Each seat in view with its figures, and which seats cover each shape of the map.
  const covers = useMemo(() => {
    const bySeat = new Map((board.data?.seats ?? []).map((seat) => [seat.seatId, seat]));
    return (places.data?.territories ?? [])
      .filter((one) => !channel || one.channel === channel)
      .map((one): Cover => {
        const seat = bySeat.get(one.seatId);
        return { ...one, sold: seat?.sold ?? 0, target: seat?.target ?? null, today: seat?.today ?? 0 };
      });
  }, [board.data, places.data, channel]);
  const byShape = useMemo(() => {
    const out = new Map<string, Cover[]>();
    for (const cover of covers)
      for (const code of cover.shapes) out.set(code, [...(out.get(code) ?? []), cover]);
    return out;
  }, [covers]);

  if (!map.data || !board.data || !places.data)
    return <PageState query={!map.data ? map : !board.data ? board : places} what="the map" />;
  const data = map.data;
  const pace = board.data.pace;
  const regionName = new Map(data.regions.map((one) => [one.code, one.name]));
  const toneOfShape = (code: string): Tone | "empty" => {
    const list = byShape.get(code);
    if (!list?.length) return "empty";
    if (list.every((one) => !one.holder)) return "vacant";
    const target = list.reduce((sum, one) => sum + (one.target ?? 0), 0);
    return toneOf(
      list.reduce((sum, one) => sum + one.sold, 0),
      target || null,
      pace,
    );
  };
  const channels = [...new Set(places.data.territories.filter((one) => one.shapes.length).map((one) => one.channel ?? ""))]
    .filter(Boolean)
    .sort();
  const unread = places.data.territories.filter((one) => one.unread.length);
  const [nx, ny, nw, nh] = data.insets.ncr;
  const insetW = 260;
  const scale = insetW / nw;
  const insetH = nh * scale;
  const ncr = data.areas.filter((one) => one.region === NCR);
  const move = (code: string) => (event: MouseEvent) => {
    const box = (event.currentTarget.closest("[data-map]") as HTMLElement | null)?.getBoundingClientRect();
    setHover({ code, x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) });
  };
  const open = (code: string) => {
    const first = byShape.get(code)?.[0];
    if (first) navigate(`/my-team/seat/${first.seatId}${unit ? `?unit=${unit}` : ""}`);
  };
  const shape = (one: MapData["areas"][number], key: string) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: a map shape; its people are listed below too
    <path
      key={key}
      d={one.d}
      fill={FILL[toneOfShape(one.code)]}
      stroke={hover?.code === one.code ? "#0f172a" : "#ffffff"}
      strokeWidth={hover?.code === one.code ? 1.6 : 0.6}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: byShape.get(one.code)?.length ? "pointer" : "default" }}
      onMouseMove={move(one.code)}
      onMouseLeave={() => setHover(null)}
      onClick={() => open(one.code)}
    />
  );
  const hovered = hover ? data.areas.find((one) => one.code === hover.code) : null;
  const hoverCovers = hover ? (byShape.get(hover.code) ?? []) : [];

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Map</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Who covers each place and how they are doing against their target · from the chart and
          each area's cities, live
        </p>
      </header>
      <TeamSwitch />
      <RangePicker />
      <div className="flex flex-wrap items-center gap-1.5">
        {["", ...channels].map((code) => (
          <button
            key={code || "all"}
            type="button"
            onClick={() =>
              setParams(
                (now) => {
                  const next = new URLSearchParams(now);
                  if (code) next.set("channel", code);
                  else next.delete("channel");
                  return next;
                },
                { replace: true },
              )
            }
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${channel === code ? "bg-brand text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {code || "Every channel"}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          {(["on", "behind", "far", "none", "vacant"] as Tone[]).map((tone) => (
            <span key={tone} className="inline-flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ background: FILL[tone] }} />
              {TONE[tone].word}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="size-3 rounded-sm border border-slate-200" style={{ background: FILL.empty }} />
            Nobody's area
          </span>
        </span>
      </div>

      <div className="relative" data-map>
        <ZoomBox height={720}>
          <svg
            viewBox={`0 0 ${data.viewBox[2]} ${data.viewBox[3]}`}
            width={data.viewBox[2]}
            height={data.viewBox[3]}
            role="img"
            aria-label="The Philippines by province, Metro Manila by city"
          >
            <g>{data.areas.map((one) => shape(one, one.code))}</g>
            {/* Metro Manila, drawn large in a corner (it is a speck on the whole map). */}
            <g>
              <rect x={12} y={12} width={insetW + 24} height={insetH + 48} rx={14} fill="#ffffff" stroke="#e2e8f0" />
              <text x={28} y={38} fontSize={14} fontWeight={700} fill="#64748b" letterSpacing={1}>
                METRO MANILA
              </text>
              <g transform={`translate(24 48) scale(${scale}) translate(${-nx} ${-ny})`}>
                {ncr.map((one) => shape(one, `inset-${one.code}`))}
              </g>
            </g>
          </svg>
        </ZoomBox>
        {hover && hovered && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[12px] shadow-lg"
            style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 14 }}
          >
            <div className="text-sm font-semibold text-slate-900">{hovered.name}</div>
            <div className="text-slate-500">{regionName.get(hovered.region)}</div>
            {hoverCovers.length === 0 ? (
              <div className="mt-1 text-slate-500">Nobody's area{channel ? ` in ${channel}` : ""}.</div>
            ) : (
              hoverCovers.map((one) => (
                <div key={one.seatId} className="mt-1.5 border-t border-slate-100 pt-1.5">
                  <div>
                    <b className="text-slate-900">{one.holder ?? "VACANT"}</b> {one.title} · {one.area}
                    {one.channel ? ` · ${one.channel}` : ""}
                  </div>
                  {one.lead && <div className="text-slate-500">Under {one.lead}</div>}
                  <div className="text-slate-600">
                    {one.target
                      ? `${shortPeso(one.sold)} of ${shortPeso(one.target)} (${Math.round((one.sold / one.target) * 100)}%)`
                      : `${shortPeso(one.sold)} sold · no target`}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Territories on the map <span className="text-xs font-normal text-slate-500">({covers.filter((one) => one.shapes.length).length})</span>
        </h2>
        <div className="-mx-4 overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>Area</th>
                <th>Who</th>
                <th>Under</th>
                <th>Places</th>
                <th className="num">Sold</th>
                <th className="num">Target</th>
                <th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {covers
                .filter((one) => one.shapes.length)
                .map((one) => {
                  const tone: Tone = one.holder ? toneOf(one.sold, one.target, pace) : "vacant";
                  return (
                    <tr key={one.seatId}>
                      <td className="font-semibold">
                        {one.area}
                        <span className="block text-[11px] font-normal text-slate-500">{one.channel}</span>
                      </td>
                      <td>
                        <Link to={`/my-team/seat/${one.seatId}${unit ? `?unit=${unit}` : ""}`} className="hover:underline">
                          {one.holder ?? "VACANT"}
                        </Link>
                        <span className="block text-[11px] text-slate-500">{one.title}</span>
                      </td>
                      <td className="text-slate-600">{one.lead ?? "—"}</td>
                      <td className="max-w-64 text-[12px] text-slate-600">{one.places.join(", ")}</td>
                      <td className="num" title={exactPeso(one.sold)}>{shortPeso(one.sold)}</td>
                      <td className="num">{one.target ? shortPeso(one.target) : "No target"}</td>
                      <td className="num">
                        <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ring-1 ${TONE[tone].pill}`}>
                          {one.target ? `${Math.round((one.sold / one.target) * 100)}%` : TONE[tone].word}
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {unread.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            Not on the map yet (a city name the map can't read; put it right on the area in Teams &
            people → Areas):{" "}
            {unread.map((one) => `${one.area} (${one.unread.join(", ")})`).join("; ")}
          </p>
        )}
      </section>
      <p className="text-[11px] text-slate-400">{data.credit}</p>
    </div>
  );
}
