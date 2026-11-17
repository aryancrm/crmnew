// Brought from the old CRM (backend/apps/company/src/psgc.ts, 13 Nov 2026) for the map.
// The Philippines by PSGC code, 3Q 2026: 18 regions, 82 provinces (with Metro
// Manila's 4 districts, the City of Isabela and BARMM's Special Geographic
// Area), 1,642 cities and municipalities. psgc-2026q3.json is built with the
// map by frontend/scripts/build-ph-map.mjs from faeldon/philippines-json-maps
// v1.1.1 (codes and names as PSA publishes them).
//
// The one rule for reading the places a person typed ("Baguio | Ilocos | La
// Union") as codes. A name fits the places of that name (any case and accents;
// "City of", "City" and "Province" aside, unless the text says which it means:
// "Quezon City", "Quezon Province"). It is read when it fits one place; or one
// province and places inside it (Cebu: the province, which holds the City of
// Cebu); or one city and one town elsewhere (Bacolod: the City of Bacolod, not
// the town in Lanao del Norte). In a list, a name several places share is read
// when only one of them is in a region the list's other places are in
// ("Tuguegarao | Isabela": the province; "Nueva Ecija | Santa Rosa": the town
// there, not the city in Laguna). In a list, a city or town read by its name
// alone is doubted when the list's other places are all far from it: a town in
// another region, a city in another part of the country ("Davao del Norte |
// Samal" isn't Samal in Bataan; "Baguio | La Union" is still Baguio). A few
// names people use for several places are spelled out (Camanava, Mindoro,
// Ilocos, Bicol); Metro Manila's streets and districts that are also towns
// elsewhere (Taft, Sampaloc) are never read. Anything else ("Quezon" alone, "San
// Jose", "Cebu North") is left for a person to set on the map.
import { readFileSync } from "node:fs";

export type PlaceLevel = "region" | "province" | "city" | "municipality" | "other";
export type Place = {
  /** The 10-digit PSGC code, zero-padded. */
  code: string;
  name: string;
  level: PlaceLevel;
  /** The province (or Metro Manila district) it is in; itself for a province; none for a region. */
  province: string | null;
  region: string;
};

type Data = {
  regions: { code: string; name: string }[];
  provinces: { code: string; name: string; region: string; level: "province" | "other" }[];
  places: {
    code: string;
    name: string;
    province: string;
    region: string;
    level: "city" | "municipality";
  }[];
};

export const NCR = "1300000000";
/** Names people use that PSA doesn't: one place, or several spelled out. */
const ALIASES: [string, string[]][] = [
  ["Metro Manila", [NCR]],
  ["QC", ["1381300000"]],
  ["Bicol", ["0500000000"]],
  // Caloocan, Malabon, Navotas, Valenzuela
  ["Camanava", ["1380100000", "1380400000", "1380900000", "1381600000"]],
  // Occidental and Oriental Mindoro
  ["Mindoro", ["1705100000", "1705200000"]],
  // Ilocos Norte and Ilocos Sur (the region also holds La Union and Pangasinan)
  ["Ilocos", ["0102800000", "0102900000"]],
  // crmnew's sales areas (17 Nov 2026): the names the hospital territories go by.
  ["Gen San", ["1230800000"]],
  ["GenSan", ["1230800000"]],
  ["Davao North", ["1102300000"]],
  ["Davao South", ["1102400000"]],
  // Cebu's north and south territories: both on the province's shape.
  ["Cebu North", ["0702200000"]],
  ["Cebu South", ["0702200000"]],
];
/**
 * Streets and districts of Metro Manila that name a sales area or a hospital
 * cluster (RX | TAFT, B2B HQ Bambang). Several are also towns far away (Taft in
 * Eastern Samar, Bambang in Nueva Vizcaya), so none is read as a place.
 */
const METRO_STREETS = new Set(
  [
    "Taft",
    "Rodriguez",
    "Sampaloc",
    "Katipunan",
    "Bambang",
    "Kalaw",
    "Ortigas",
    "Commonwealth",
    "East Ave",
    "East Avenue",
  ].map((name) => fullKey(name)),
);
/** What an unread street or district is said to be. */
const METRO_STREET = "a street or district in Metro Manila";
/** Regions of the Visayas and of Mindanao, by their code's first two digits; the rest are Luzon's. */
const VISAYAS = ["06", "07", "08", "18"];
const MINDANAO = ["09", "10", "11", "12", "16", "19"];
/** Luzon, the Visayas or Mindanao: the part of the country a region is in. */
function partOf(region: string): "luzon" | "visayas" | "mindanao" {
  const r = region.slice(0, 2);
  return VISAYAS.includes(r) ? "visayas" : MINDANAO.includes(r) ? "mindanao" : "luzon";
}

/** A place name as compared: no accents, case, dots or extra spaces; Sta./Sto./Gen. spelled out. */
export function fullKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\bsta\b/g, "santa")
    .replace(/\bsto\b/g, "santo")
    .replace(/\bgen\b/g, "general")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
/** The same without "City of", "City", "Province of" and "Province". */
export function shortKey(name: string): string {
  return fullKey(name)
    .replace(/^(city|province) of /, "")
    .replace(/ (city|province)$/, "")
    .trim();
}

let loaded: {
  byCode: Map<string, Place>;
  byFull: Map<string, Place[]>;
  byShort: Map<string, Place[]>;
  /** Names that stand for several places (Camanava). */
  groups: Map<string, Place[]>;
  areas: Map<string, string[]>;
} | null = null;

function data() {
  if (loaded) return loaded;
  const raw = JSON.parse(
    readFileSync(new URL("./psgc-2026q3.json", import.meta.url), "utf8"),
  ) as Data;
  const all: Place[] = [
    ...raw.regions.map((r) => ({
      code: r.code,
      name: r.name,
      level: "region" as const,
      province: null,
      region: r.code,
    })),
    ...raw.provinces.map((p) => ({
      code: p.code,
      name: p.name,
      level: p.level,
      province: p.code,
      region: p.region,
    })),
    ...raw.places.map((p) => ({
      code: p.code,
      name: p.name,
      level: p.level,
      province: p.province,
      region: p.region,
    })),
  ];
  const byCode = new Map(all.map((p) => [p.code, p]));
  const byFull = new Map<string, Place[]>();
  const byShort = new Map<string, Place[]>();
  const add = (index: Map<string, Place[]>, key: string, p: Place) => {
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.includes(p)) list.push(p);
    index.set(key, list);
  };
  const names = (p: Place): string[] => {
    // "Region I (Ilocos Region)": also "Region I" and "Ilocos Region"
    const paren = /^(.+?)\s*\(([^)]+)\)$/.exec(p.name);
    if (p.level === "region" && paren) return [p.name, paren[1] ?? "", paren[2] ?? ""];
    // "City of Isabela (Not a Province)": "City of Isabela"; Metro Manila's
    // districts ("NCR, Second District") aren't names people type
    if (p.level === "other")
      return p.region === NCR ? [] : [p.name.replace(/\s*\(Not a Province\)$/i, "")];
    return [p.name];
  };
  for (const p of all)
    for (const n of names(p)) {
      add(byFull, fullKey(n), p);
      add(byShort, shortKey(n), p);
    }
  const groups = new Map<string, Place[]>();
  for (const [alias, codes] of ALIASES) {
    const places = codes.flatMap((c) => byCode.get(c) ?? []);
    if (places.length !== codes.length) throw Error(`Unknown PSGC code in the alias ${alias}`);
    const [one] = places;
    if (places.length === 1 && one) {
      add(byFull, fullKey(alias), one);
      add(byShort, shortKey(alias), one);
    } else groups.set(shortKey(alias), places);
  }
  // The map's areas: Metro Manila by city and municipality, elsewhere by province
  const areas = new Map<string, string[]>();
  for (const p of all) {
    if (p.level === "region") {
      const inside = all.filter((x) => x.region === p.code && x.code !== p.code);
      areas.set(
        p.code,
        inside
          .filter((x) =>
            p.code === NCR
              ? x.level === "city" || x.level === "municipality"
              : x.level === "province" || x.level === "other",
          )
          .map((x) => x.code),
      );
    } else if (p.region === NCR)
      areas.set(
        p.code,
        p.level === "other"
          ? all.filter((x) => x.province === p.code && x.code !== p.code).map((x) => x.code)
          : [p.code],
      );
    else areas.set(p.code, p.province ? [p.province] : []);
  }
  loaded = { byCode, byFull, byShort, groups, areas };
  return loaded;
}

/** The place with this PSGC code (any number of leading zeros), if there is one. */
export function placeByCode(code: string | number): Place | undefined {
  const c = String(code).trim();
  if (!/^\d{1,10}$/.test(c)) return undefined;
  return data().byCode.get(c.padStart(10, "0"));
}

/**
 * The map areas a place covers: a province (or a city in Metro Manila)
 * itself; a city or municipality elsewhere, its province; a region, all of
 * its provinces (Metro Manila: its 17 cities and municipalities).
 */
export function mapAreasOf(code: string): string[] {
  return data().areas.get(code) ?? [];
}

/**
 * What one typed name reads as: the place, with every place the name fits (the
 * City of Cebu beside the province; the town a city was taken over), or why it
 * can't be read (`street`: one of Metro Manila's streets or districts, with the
 * towns of its name elsewhere as candidates).
 */
export function placeNamed(
  text: string,
):
  | { place: Place; fits: Place[] }
  | { place: null; why: "unknown" | "ambiguous"; candidates: Place[]; street?: true } {
  const { byFull, byShort } = data();
  const full = fullKey(text);
  const short = shortKey(text);
  // "Quezon City" or "Quezon Province" says which; a bare name fits every place of that name
  const says = full !== short;
  let found = (says ? byFull.get(full) : undefined) ?? byShort.get(short) ?? [];
  if (METRO_STREETS.has(full) || METRO_STREETS.has(short))
    return {
      place: null,
      why: found.length ? "ambiguous" : "unknown",
      candidates: found,
      street: true,
    };
  if (says && found.length > 1) {
    const province = /\bprovince\b/.test(full);
    const narrowed = found.filter((p) =>
      province ? p.level === "province" || p.level === "other" : p.level === "city",
    );
    if (narrowed.length) found = narrowed;
  }
  const [first] = found;
  if (found.length === 1 && first) return { place: first, fits: found };
  if (!found.length) return { place: null, why: "unknown", candidates: [] };
  // One province, and only places inside it of the same name: the province
  const provinces = found.filter((p) => p.level === "province" || p.level === "other");
  const [province] = provinces;
  if (
    provinces.length === 1 &&
    province &&
    found.every((p) => p === province || p.province === province.code)
  )
    return { place: province, fits: found };
  // One city and one town of the same name: the city (Bacolod; not San Jose, a
  // city and a dozen towns, nor Roxas, which a list's region reads)
  const cities = found.filter((p) => p.level === "city");
  const [city] = cities;
  if (
    cities.length === 1 &&
    city &&
    found.length === 2 &&
    found.every((p) => p === city || p.level === "municipality")
  )
    return { place: city, fits: found };
  return { place: null, why: "ambiguous", candidates: found };
}

/**
 * The places a typed list names ("Baguio | Ilocos | La Union", "Pasay, Manila"),
 * as codes in their order, and the names that couldn't be read.
 */
export function readPlaces(text: string | string[]): {
  places: Place[];
  unread: { name: string; why: "unknown" | "ambiguous"; candidates: string[] }[];
} {
  const parts = (Array.isArray(text) ? text : [text])
    .flatMap((t) => String(t ?? "").split(/\s*(?:[|,;/&]|\band\b)\s*/i))
    .map((s) => s.trim())
    .filter(Boolean);
  const unread: { name: string; why: "unknown" | "ambiguous"; candidates: string[] }[] = [];
  const { groups } = data();
  /**
   * What each name read as, in the list's order. `loose`: a city or town read
   * by its name, which the list's other places may doubt (`out`); its `fits`
   * hold the town too when a city was taken over a town of its name.
   */
  type Read = { name: string; place: Place; fits: Place[]; loose: boolean; out?: true };
  const read: Read[] = [];
  const later: { name: string; candidates: Place[] }[] = [];
  for (const name of parts) {
    const group = groups.get(shortKey(name));
    if (group) {
      for (const place of group) read.push({ name, place, fits: [place], loose: false });
      continue;
    }
    const r = placeNamed(name);
    if (r.place)
      read.push({
        name,
        place: r.place,
        fits: r.fits,
        loose: r.place.level === "city" || r.place.level === "municipality",
      });
    else if (r.street)
      unread.push({
        name,
        why: r.why,
        candidates: [METRO_STREET, ...r.candidates.slice(0, 5).map((p) => describePlace(p))],
      });
    else if (r.why === "ambiguous") later.push({ name, candidates: r.candidates });
    else unread.push({ name, why: "unknown", candidates: [] });
  }
  /** Close enough to back a place read by its name: a town's region, a city's part of the country. */
  const near = (p: Place, q: Place) =>
    p.level === "municipality" ? q.region === p.region : partOf(q.region) === partOf(p.region);
  /** The list has other places, and every one of them is far from this one. */
  const far = (s: Read, others: Read[]) => {
    const backing = others.filter((o) => o !== s && !o.out && o.place !== s.place);
    return backing.length > 0 && !backing.some((o) => near(s.place, o.place));
  };
  // A city or town that is the only place of its name is doubted when the list's
  // other places are all far from it (until nothing changes: a doubted place
  // backs nothing). A city taken over a town waits for the next step.
  const settled = read.filter((s) => !s.loose || s.fits.length === 1);
  for (let changed = true; changed; ) {
    const doubted = settled.filter((s) => s.loose && !s.out && far(s, settled));
    for (const s of doubted) s.out = true;
    changed = doubted.length > 0;
  }
  // A city taken over a town of its name is read like any shared name: the one
  // of the two in a region the list's other places are in ("Nueva Ecija | Santa
  // Rosa": the town), else the city, doubted like any city
  for (const s of read.filter((x) => x.loose && x.fits.length > 1)) {
    const regions = new Set(settled.filter((o) => !o.out).map((o) => o.place.region));
    const inList = s.fits.filter((p) => regions.has(p.region));
    const [one] = inList;
    if (inList.length === 1 && one) s.place = one;
    else if (far(s, read)) s.out = true;
  }
  const places: Place[] = [];
  for (const s of read) {
    if (!s.out) {
      if (!places.includes(s.place)) places.push(s.place);
    } else if (!unread.some((u) => u.name === s.name))
      unread.push({
        name: s.name,
        why: "ambiguous",
        candidates:
          s.fits.length > 1
            ? s.fits.map((p) => describePlace(p))
            : [describePlace(s.place), "another place near the list's others"],
      });
  }
  // A name several places share is read when exactly one of them is in a region
  // the list's other places are in ("Tuguegarao | Isabela": Isabela the province)
  const regions = new Set(places.map((p) => p.region));
  for (const { name, candidates } of later) {
    const inList = candidates.filter((p) => regions.has(p.region));
    const [one] = inList;
    if (inList.length === 1 && one) {
      if (!places.includes(one)) places.push(one);
    } else
      unread.push({
        name,
        why: "ambiguous",
        candidates: candidates.slice(0, 6).map((p) => describePlace(p)),
      });
  }
  return { places, unread };
}

/** "City of Baguio, Benguet" / "La Union (province)" / "Region I (Ilocos Region)". */
export function describePlace(p: Place): string {
  if (p.level === "region") return p.name;
  if (p.level === "province" || p.level === "other") return `${p.name} (province)`;
  const province = p.province ? data().byCode.get(p.province) : undefined;
  return province && province.level === "province" ? `${p.name}, ${province.name}` : p.name;
}

/** Every code is a known PSGC code of a place (codes zero-padded, kept in order, once each). */
export function knownCodes(codes: unknown): string[] | null {
  if (!Array.isArray(codes)) return null;
  const out: string[] = [];
  for (const c of codes) {
    const p = typeof c === "string" || typeof c === "number" ? placeByCode(c) : undefined;
    if (!p) return null;
    if (!out.includes(p.code)) out.push(p.code);
  }
  return out;
}

/** The region, province and city (or municipality) a code stands in; a level above it is null below. */
export function placeChain(code: string | null | undefined): {
  region: Place | null;
  province: Place | null;
  city: Place | null;
} {
  const p = code ? placeByCode(code) : undefined;
  if (!p) return { region: null, province: null, city: null };
  const { byCode } = data();
  const region = byCode.get(p.region) ?? null;
  if (p.level === "region") return { region: p, province: null, city: null };
  const province = p.province ? (byCode.get(p.province) ?? null) : null;
  const isCity = p.level === "city" || p.level === "municipality";
  return { region, province, city: isCity ? p : null };
}

/** Every city and municipality in a province or region (Metro Manila: its 17), by name. */
export function placesIn(code: string): Place[] {
  const all = [...data().byCode.values()];
  return all
    .filter(
      (p) =>
        (p.level === "city" || p.level === "municipality") &&
        (p.province === code || p.region === code),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Cities and municipalities matching what was typed, best first (a name that
 * starts with it, then one that holds it; cities before towns): a place picker's
 * suggestions. "makati", "quezon city", "sta rosa" all read as people type them.
 */
export function searchPlaces(text: string, limit = 20): Place[] {
  const want = shortKey(text);
  if (want.length < 2) return [];
  const rank = (p: Place): number => {
    const key = shortKey(p.name);
    const full = fullKey(p.name);
    if (key === want || full === fullKey(text)) return 0;
    if (key.startsWith(want) || full.startsWith(want)) return 1;
    if (key.split(" ").some((w) => w.startsWith(want))) return 2;
    if (key.includes(want)) return 3;
    return 9;
  };
  return [...data().byCode.values()]
    .filter((p) => p.level === "city" || p.level === "municipality")
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 9)
    .sort(
      (a, b) =>
        a.r - b.r ||
        Number(a.p.level !== "city") - Number(b.p.level !== "city") ||
        a.p.name.localeCompare(b.p.name),
    )
    .slice(0, limit)
    .map((x) => x.p);
}

/**
 * The place a typed city (and province) reads as, by the one rule for reading
 * places (`readPlaces`): the city or municipality when it reads as one, else
 * the province, else the region; null when it reads as nothing. An account's
 * free-text address is placed this way until someone picks its place.
 */
export function placeFromText(
  city: string | null | undefined,
  province: string | null | undefined,
): Place | null {
  const parts = [city, province].map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!parts.length) return null;
  const { places } = readPlaces(parts);
  return (
    places.find((p) => p.level === "city" || p.level === "municipality") ??
    places.find((p) => p.level === "province" || p.level === "other") ??
    places.find((p) => p.level === "region") ??
    null
  );
}
