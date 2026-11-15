// Draws the company tree (/team) into a container: the two approved views of
// docs/prototypes/sales-tree.html (Org chart: vertical, round avatars whose ring
// is achieved ÷ target; Tree: left to right, cards), pan and zoom, search and a
// details sheet. Plain DOM, redrawn on each click (a few hundred nodes at most),
// so opening, zooming and searching never wait on React or the server. The data
// is the server's `team.tree`: the sales structure (channels and territories with
// the month's figures in centavos: achieved is the sales sheet's entered figure
// plus the CRM's own sales on the territory; today the sheet's, on the day it was
// entered, plus what the CRM delivered today) and the company's people. The tree
// is built here: CEO → heads → channels → managers → the people holding
// territories, and everyone else under the person they report to, else under
// their department.
// With HR's organizational chart loaded (units), the tree is the chart's: the
// founder, each unit with its leads, people (and the areas they cover) and units,
// the territories' figures on the people holding them, each seller under the
// manager the newer sales sheet names (inside the unit that sells for them),
// Online's lead sources under Online, and whoever isn't on the chart apart.
// In both, the CRM's sales that no territory holds (the desk's, a business
// buyer's, a rep's with no territory) sit under their channel as "Sales without
// a territory"; a channel's territories closed since keep the month's figures in
// its "Former territories", and the channels closed since (with their territories
// and their sales) in "Former channels": the root adds up to Finance's grand
// total, and closing or moving anything never changes it.

export type TreeData = {
  month: string;
  today: string;
  asOf: string | null;
  company: string;
  ceo: string | null;
  ceoId: string | null;
  branch?: boolean;
  channels: {
    id: string;
    code: string;
    name: string;
    head: string | null;
    headId: string | null;
    sort: number;
    /** The CRM's sales on the channel with no territory, and today's of them. */
    crmAchieved?: number;
    crmToday?: number;
  }[];
  /**
   * What has closed since, with the month as it was: territories closed under an
   * open channel, and channels closed with their territories and their sales with
   * no territory (owners and admins). Never on the map: only `territories` are.
   */
  former?: {
    territories: FormerTerritory[];
    channels: {
      id: string;
      code: string;
      name: string;
      sort: number;
      crmAchieved: number;
      crmToday: number;
      territories: FormerTerritory[];
    }[];
  } | null;
  /** The drawn structure: the open territories under the open channels. */
  territories: {
    id: string;
    name: string;
    hq: string | null;
    channelId: string;
    manager: string | null;
    managerId: string | null;
    holder: string | null;
    holderId: string | null;
    note: string | null;
    target: number;
    achieved: number;
    today: number;
    sort: number;
    /** The places it covers, as PSGC codes (named in placeNames). */
    places?: string[];
  }[];
  people: {
    id: string;
    name: string;
    code: string | null;
    department: string | null;
    position: string | null;
    reportsToId: string | null;
    status: string;
    hasLogin: boolean;
    userId: string | null;
    rep: boolean;
  }[];
  units?: {
    id: string;
    name: string;
    kind: string;
    parentId: string | null;
    channelId: string | null;
    region: string | null;
    sort: number;
    vacancies: { title: string; areas: string[]; places?: string[] }[];
  }[];
  members?: {
    id?: string;
    unitId: string;
    contactId: string;
    title: string | null;
    lead: boolean;
    areas: string[];
    places?: string[];
    sort: number;
  }[];
  /** Each PSGC code in a `places`: its name and the map areas it colours. */
  placeNames?: Record<string, { name: string; areas: string[] }>;
  leadSources?:
    | {
        key: string;
        label: string;
        count: number;
        children: { key: string; label: string; count: number }[];
      }[]
    | null;
  /** Saved professional-account pins and recorded check-ins; never live tracking. */
  geo?: {
    accounts: {
      id: string;
      name: string;
      kind: "doctors" | "hospitals" | "buyers";
      lat: number;
      lng: number;
      city: string | null;
      province: string | null;
      channelId: string | null;
      repId: string | null;
      repName: string | null;
      href: string;
      mapsUrl: string | null;
      source: "pin" | "maps";
    }[];
    activity: {
      id: string;
      repId: string;
      repName: string;
      accountId: string | null;
      accountName: string;
      lat: number;
      lng: number;
      at: string;
      state: string;
      channelId: string | null;
      locationCheck: string | null;
      distance: number | null;
      href: string | null;
    }[];
    unpinned: number;
  } | null;
};

/** A territory closed since (or of a channel closed since): its month as it was (centavos). */
type FormerTerritory = {
  id: string;
  name: string;
  hq: string | null;
  channelId: string;
  manager: string | null;
  managerId?: string | null;
  holder: string | null;
  holderId?: string | null;
  note?: string | null;
  /** The territory itself is archived (a closed channel's territory may still be open). */
  closed: boolean;
  target: number;
  achieved: number;
  today: number;
  sort: number;
};

type Kind = "ceo" | "head" | "channel" | "manager" | "rep" | "person" | "dept";
type Person = TreeData["people"][number];
type TNode = {
  id: string;
  type: Kind;
  name: string;
  role: string;
  hue: string;
  kids: TNode[];
  parent: TNode | null;
  contactId?: string | null;
  info?: Person;
  code?: string;
  zoho?: string;
  hq?: string;
  vacant?: boolean;
  sheetName?: string | null;
  ledBy?: string;
  /** The areas a person covers, as the chart names them. */
  areas?: string;
  /** Territories a chart person holds on the sheet (their figures are on them). */
  held?: number;
  /** A selling unit's node: its own channel, as the chart sets it. */
  unitChannel?: string;
  /** A vacant seat on the chart (it counts only the sheet's territories it took). */
  seat?: boolean;
  /** Drawn again from the sales sheet: the manager of people the chart puts elsewhere. */
  sheet?: boolean;
  /** The CRM's sales no territory holds (a channel's, or of a channel since closed): no target. */
  crm?: boolean;
  /**
   * What has closed since: "Former territories", "Former channels", a closed
   * channel, or one territory of them. Its figures count; it is no one's place
   * (no person, territory or vacancy counted).
   */
  former?: boolean;
  /** A former territory's last holder. */
  heldBy?: string;
  /** What it is, said in the details panel. */
  note?: string;
  row?: boolean;
  target: number;
  ach: number;
  today: number;
  people: Set<string>;
  territories: number;
  vacantCount: number;
  x: number;
  y: number;
};

const HUES = ["#0f7490", "#4f46e5", "#8b3dc4", "#52627a", "#b45309", "#0e7a5a", "#be185d"];
const DIRECT_HUE = "#1d4ed8";
const DEPT_HUE = "#64748b";
/** The code of the group holding people the chart doesn't name (it is no one's boss). */
const NOT_ON_CHART = "NOC";
const INK = "#17201d";
const PEOPLE_KINDS: Kind[] = ["ceo", "head", "manager", "rep", "person"];

/** A department's short code for its disc: initials of its words, else its first letters. */
const deptCode = (name: string) => {
  const words = name.split(/[\s&/-]+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 3))
    .slice(0, 4)
    .toUpperCase();
};

type NodeValues = Partial<TNode> & { type: Kind; name: string };

/**
 * A channel's CRM sales with no territory, as one node under the channel (pesos;
 * no target, never a person); null when there are none.
 */
function withoutTerritory(c: {
  code: string;
  crmAchieved?: number;
  crmToday?: number;
}): NodeValues | null {
  const ach = (c.crmAchieved ?? 0) / 100;
  const today = (c.crmToday ?? 0) / 100;
  if (!ach && !today) return null;
  return {
    type: "dept",
    crm: true,
    name: "Sales without a territory",
    code: c.code,
    // Short enough for the chart's line; the details panel says the rest (`note`)
    role: "Recorded in the CRM",
    note: "Sales the CRM recorded on this channel that no territory holds: the desk's (website, Messenger, email, phone), a business buyer's, or a rep's who holds no territory. They have no target.",
    ach,
    today,
  };
}

/** A territory closed since (or of a channel closed since), as a node: its month's figures, no one's place. */
function formerTerritory(t: FormerTerritory): NodeValues {
  return {
    type: "rep",
    former: true,
    name: t.holder ?? t.hq ?? t.name,
    role: t.closed ? "Closed territory" : "Channel closed",
    zoho: t.name,
    hq: t.hq ?? "",
    heldBy: t.holder ?? undefined,
    ledBy: t.manager ?? undefined,
    sheetName: t.note ? t.note.replace(/^On the sheet: /, "") : null,
    note: t.closed
      ? "This territory is closed. What it had for the month (the sales sheet's target and figures, and the CRM's sales on it) stays in the total, as on Finance's sales sheet."
      : "This territory's channel is closed. What it had for the month stays in the total, under Former channels, as on Finance's sales sheet.",
    target: t.target / 100,
    ach: t.achieved / 100,
    today: t.today / 100,
  };
}

type Make = (parent: TNode | null, v: NodeValues) => TNode;

/** A channel's territories closed since, as one node under it (none: nothing drawn). */
function formerTerritories(make: Make, parent: TNode, data: TreeData, channelId: string) {
  const list = (data.former?.territories ?? []).filter((t) => t.channelId === channelId);
  if (!list.length) return;
  const group = make(parent, {
    type: "dept",
    former: true,
    name: "Former territories",
    code: "FT",
    role: "Closed since",
    note: "Territories of this channel closed since. Their figures for the month stay in the channel's total, as on Finance's sales sheet.",
  });
  for (const t of list) make(group, formerTerritory(t));
}

/** The channels closed since (owners and admins), as one node under the root: each with its territories and its sales with no territory. */
function formerChannels(make: Make, root: TNode, data: TreeData) {
  const list = data.former?.channels ?? [];
  if (!list.length) return;
  const node = make(root, {
    type: "dept",
    former: true,
    name: "Former channels",
    // The code Finance's sales sheet shows on its "Former channels" row
    code: "OLD",
    role: `Channels since closed: ${list.map((c) => c.code).join(", ")}`,
    note: "Sales channels closed since. Their figures for the month (their territories, closed or not, and their sales with no territory) stay in the total, as on Finance's sales sheet.",
    hue: DEPT_HUE,
  });
  for (const c of list) {
    const ch = make(node, {
      type: "channel",
      former: true,
      name: c.name,
      code: c.code,
      role: "Channel closed since",
      note: "This sales channel is closed. Its figures for the month stay in the total.",
    });
    for (const t of c.territories) make(ch, formerTerritory(t));
    const own = withoutTerritory(c);
    if (own) make(ch, own);
  }
}

/** The tree from the server's structure and people (pesos from here on). */
export function buildTree(data: TreeData): { root: TNode; nodes: Map<string, TNode> } {
  let seq = 0;
  const nodes = new Map<string, TNode>();
  const info = new Map(data.people.map((p) => [p.id, p]));
  const byContact = new Map<string, TNode>();
  const make = (parent: TNode | null, v: NodeValues): TNode => {
    const n: TNode = {
      id: `n${seq++}`,
      role: "",
      hue: parent?.hue ?? INK,
      kids: [],
      parent,
      target: 0,
      ach: 0,
      today: 0,
      people: new Set(),
      territories: 0,
      vacantCount: 0,
      x: 0,
      y: 0,
      ...v,
    };
    if (n.contactId) {
      n.info = info.get(n.contactId);
      if (!byContact.has(n.contactId)) byContact.set(n.contactId, n);
    }
    parent?.kids.push(n);
    nodes.set(n.id, n);
    return n;
  };
  const root = make(null, {
    type: "ceo",
    name: data.ceo ?? data.company,
    // A manager's own branch has them at the top
    role: data.branch
      ? data.channels.some((c) => c.headId && c.headId === data.ceoId)
        ? "Head"
        : "Manager"
      : data.ceo
        ? "CEO"
        : "Company",
    hue: INK,
    contactId: data.ceoId,
  });

  if (data.units?.length) {
    buildUnits(data, root, make, byContact, info);
    // The channels closed since: kept in the total, as Finance keeps them
    formerChannels(make, root, data);
    totals(root);
    return { root, nodes };
  }

  // The sales structure: heads, channels, managers, territories
  const heads = new Map<string, TNode>();
  // A channel is also the department of the same name: the Online desk's people go under Online
  const channelByName = new Map<string, TNode>();
  for (const c of data.channels) {
    let parent = root;
    // The person at the top (a manager's own branch) is never drawn again below themself
    if (c.head && c.headId !== data.ceoId) {
      const hk = c.headId ?? c.head;
      let h = heads.get(hk);
      if (!h) {
        h = make(root, {
          type: "head",
          name: c.head,
          role: "Head",
          hue: HUES[heads.size % HUES.length],
          contactId: c.headId,
        });
        heads.set(hk, h);
      }
      parent = h;
    }
    const ch = make(parent, {
      type: "channel",
      name: c.name,
      code: c.code,
      role: "Channel",
      // Under a head: the head's colour; a head's own branch (they are the top): the first colour
      hue: parent !== root ? parent.hue : c.head ? HUES[0] : DIRECT_HUE,
    });
    channelByName.set(c.name.toLowerCase(), ch);
    channelByName.set(c.code.toLowerCase(), ch);
    const managers = new Map<string, TNode>();
    for (const t of data.territories.filter((x) => x.channelId === c.id)) {
      let p = ch;
      const runByHead = t.managerId
        ? t.managerId === c.headId || t.managerId === data.ceoId
        : t.manager === c.head;
      if (t.manager && runByHead) ch.ledBy = t.manager ?? undefined;
      else if (t.manager) {
        const mk = t.managerId ?? t.manager;
        let m = managers.get(mk);
        if (!m) {
          m = make(ch, {
            type: "manager",
            name: t.manager,
            role: "Manager",
            contactId: t.managerId,
          });
          managers.set(mk, m);
        }
        p = m;
      }
      make(p, {
        type: "rep",
        name: t.holder ?? t.hq ?? t.name,
        role: t.holder ? "Sales person" : "Vacant territory",
        contactId: t.holderId,
        zoho: t.name,
        hq: t.hq ?? "",
        vacant: !t.holder,
        sheetName: t.note ? t.note.replace(/^On the sheet: /, "") : null,
        target: t.target / 100,
        ach: t.achieved / 100,
        today: t.today / 100,
      });
    }
    // Its CRM sales that no territory holds (Online's desk, B2B's business buyers)
    const own = withoutTerritory(c);
    if (own) make(ch, own);
    // Its territories closed since: the month as it was
    formerTerritories(make, ch, data, c.id);
  }
  // The channels closed since: kept in the total, as Finance keeps them
  formerChannels(make, root, data);

  // Everyone else: under the person they report to, else under their department
  const depts = new Map<string, TNode>();
  const deptOf = (name: string | null) => {
    if (!name) return root;
    const channel = channelByName.get(name.toLowerCase());
    if (channel) return channel;
    let d = depts.get(name);
    if (!d) {
      d = make(root, {
        type: "dept",
        name,
        code: deptCode(name),
        role: "Department",
        hue: DEPT_HUE,
      });
      depts.set(name, d);
    }
    return d;
  };
  const place = (p: Person, parent: TNode) =>
    make(parent, {
      type: "person",
      name: p.name,
      role: p.position ?? (p.rep ? "Sales person" : "Employee"),
      contactId: p.id,
    });
  let pending = data.people.filter((p) => !byContact.has(p.id));
  for (let pass = 0; pass < 30 && pending.length; pass++) {
    const waiting: Person[] = [];
    for (const p of pending) {
      const boss = p.reportsToId ? byContact.get(p.reportsToId) : undefined;
      // Someone in a channel's department sits inside that channel, under their boss
      // when the boss is in it too (Online: Aryan and Saurav, their agents under them)
      const team = p.department ? channelByName.get(p.department.toLowerCase()) : undefined;
      const inside = (n: TNode | undefined, top: TNode) => {
        for (let at = n; at; at = at.parent ?? undefined) if (at === top) return true;
        return false;
      };
      if (boss && (!team || inside(boss, team))) place(p, boss);
      else if (p.reportsToId && pending.some((q) => q.id === p.reportsToId)) waiting.push(p);
      else place(p, team ?? deptOf(p.department));
    }
    if (waiting.length === pending.length) {
      for (const p of waiting) place(p, deptOf(p.department));
      break;
    }
    pending = waiting;
  }

  totals(root);
  return { root, nodes };
}

/** Each node's figures, people, territories and vacancies, summed up the tree. */
function totals(root: TNode) {
  const keyOf = (n: TNode) =>
    n.contactId ? `c:${n.contactId}` : n.type === "rep" ? `r:${n.zoho}` : `p:${n.name}`;
  (function total(n: TNode) {
    if (n.type === "rep") {
      // A chart's vacant seat counts the sheet's vacant territories it took (none: none);
      // a territory closed since is no one's place: its figures count, nothing else
      n.territories = n.former ? 0 : n.seat ? (n.held ?? 0) : 1;
      n.vacantCount = n.vacant ? n.territories : 0;
    } else n.territories = n.held ?? 0;
    for (const k of n.kids) {
      total(k);
      n.target += k.target;
      n.ach += k.ach;
      n.today += k.today;
      n.territories += k.territories;
      n.vacantCount += k.vacantCount;
      for (const p of k.people) n.people.add(p);
      if (PEOPLE_KINDS.includes(k.type) && !(k.type === "rep" && (k.vacant || k.former)))
        n.people.add(keyOf(k));
    }
    if (PEOPLE_KINDS.includes(n.type)) n.people.delete(keyOf(n));
  })(root);
}

const KIND_ROLE: Record<string, string> = {
  division: "Division",
  department: "Department",
  team: "Team",
  area: "Area",
};

/**
 * The organizational chart: the founder (the root), each unit with its leads,
 * the people in it (and the areas they cover) and its units under the lead
 * their people report to (else the first); the sheet's territories on the
 * chart people who hold them, a vacant one on the chart's vacant seat for its
 * place, the rest under their channel's unit; Online's lead sources under
 * Online; someone who isn't on the chart inside the unit their department
 * names (under their boss when the boss is in it too: Online's agents), else
 * under "Not on the org chart". In a manager's own branch they are the root,
 * never drawn again inside their unit. Then the sales sheet, newer than the
 * chart, says who the people of a selling unit report to (see `answerTo`).
 */
function buildUnits(
  data: TreeData,
  root: TNode,
  makeNode: (parent: TNode | null, v: NodeValues) => TNode,
  byContact: Map<string, TNode>,
  info: Map<string, Person>,
) {
  const units = data.units ?? [];
  // Someone the server no longer lists (HR marked them former) isn't drawn in a unit
  const members = (data.members ?? []).filter(
    (m) => info.has(m.contactId) || m.contactId === data.ceoId,
  );
  const channelById = new Map(data.channels.map((c) => [c.id, c]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  /** The channel a unit sells for: its own, else the nearest unit's above it. */
  const sellsFor = (u: (typeof units)[number]) => {
    let at: (typeof units)[number] | undefined = u;
    for (let hops = 0; at && hops < 50; hops++) {
      if (at.channelId) return at.channelId;
      at = at.parentId ? unitById.get(at.parentId) : undefined;
    }
    return null;
  };
  // Every node of each person: someone in two units, or drawn again from the sheet, has two
  const drawn = new Map<string, TNode[]>(root.contactId ? [[root.contactId, [root]]] : []);
  const make = (parent: TNode | null, v: NodeValues) => {
    const n = makeNode(parent, v);
    if (n.contactId) drawn.set(n.contactId, [...(drawn.get(n.contactId) ?? []), n]);
    return n;
  };
  /** Each unit's node: where its people hang (its first lead, else itself) and its leads. */
  const unitAt = new Map<TNode, { anchor: TNode; leads: Map<string, TNode> }>();
  /** The chart's people who aren't a unit's lead, as drawn (the sheet may move them). */
  const memberNodes: TNode[] = [];
  /** The sheet's territories held off the chart, and the manager the sheet names. */
  const offChart: { node: TNode; managerId: string | null }[] = [];
  const kidsOf = new Map<string | null, typeof units>();
  for (const u of units) {
    const at = u.parentId && units.some((x) => x.id === u.parentId) ? u.parentId : null;
    kidsOf.set(at, [...(kidsOf.get(at) ?? []), u]);
  }
  const membersOf = new Map<string, typeof members>();
  for (const m of members) membersOf.set(m.unitId, [...(membersOf.get(m.unitId) ?? []), m]);
  const nameOf = (id: string) => info.get(id)?.name ?? "—";
  /** Who a unit's people answer to: its first lead's boss, else its first member's. */
  const bossOfUnit = (unitId: string) => {
    const own = membersOf.get(unitId) ?? [];
    const first = own.find((m) => m.lead) ?? own[0];
    return first ? (info.get(first.contactId)?.reportsToId ?? null) : null;
  };
  const isRoot = (contactId: string) => data.branch && contactId === data.ceoId;
  const unitOfChannel = new Map<string, TNode>();
  /** A unit by its name and its channel's name: its node, and where its people hang. */
  const unitByName = new Map<string, { node: TNode; anchor: TNode }>();
  /** The chart's vacant seats under each channel's unit, by the areas they cover. */
  const seatsOf = new Map<
    string,
    { node: TNode; areas: string[]; taken: number; managers: Set<string | null> }[]
  >();
  let hues = 0;
  const unitNode = (
    u: (typeof units)[number],
    parent: TNode,
    depth: number,
    /** The channel of the nearest unit above that sells (a seat's territories are its). */
    channelUnit: string | null = null,
  ) => {
    const channel = u.channelId ? channelById.get(u.channelId) : undefined;
    const hue = depth === 0 ? (HUES[hues++ % HUES.length] ?? INK) : parent.hue;
    const node = make(parent, {
      type: channel ? "channel" : "dept",
      name: u.name,
      code: channel?.code ?? deptCode(u.name),
      role: [KIND_ROLE[u.kind] ?? "Unit", u.kind === "area" ? null : u.region]
        .filter(Boolean)
        .join(" · "),
      hue,
      unitChannel: u.channelId ?? undefined,
    });
    if (channel && !unitOfChannel.has(channel.id)) unitOfChannel.set(channel.id, node);
    const own = membersOf.get(u.id) ?? [];
    let anchor = node;
    const leads = new Map<string, TNode>();
    for (const m of own.filter((x) => x.lead)) {
      // A manager's own branch: they are the root already
      if (isRoot(m.contactId)) continue;
      const lead = make(node, {
        type: depth === 0 ? "head" : "manager",
        name: nameOf(m.contactId),
        role: m.title ?? "Lead",
        contactId: m.contactId,
        areas: m.areas.join(" | ") || undefined,
      });
      if (!leads.size) anchor = lead;
      leads.set(m.contactId, lead);
    }
    unitAt.set(node, { anchor, leads });
    for (const name of [u.name, channel?.name, channel?.code])
      if (name && !unitByName.has(name.trim().toLowerCase()))
        unitByName.set(name.trim().toLowerCase(), { node, anchor });
    for (const m of own.filter((x) => !x.lead)) {
      if (isRoot(m.contactId)) continue;
      // Under the co-lead they report to, else the first lead
      const boss = info.get(m.contactId)?.reportsToId;
      memberNodes.push(
        make((boss && leads.get(boss)) || anchor, {
          type: "person",
          name: nameOf(m.contactId),
          role: m.title ?? "",
          contactId: m.contactId,
          areas: m.areas.join(" | ") || undefined,
        }),
      );
    }
    // A manager's branch draws the vacant seats of the channels it holds only
    const sells = sellsFor(u);
    if (!data.branch || (sells && channelById.has(sells)))
      for (const v of u.vacancies) {
        const seat = make(anchor, {
          type: "rep",
          name: v.areas.join(" | ") || "Vacant",
          role: `Vacant ${v.title}`,
          vacant: true,
          seat: true,
          hq: v.areas.join(" | "),
          zoho: `${u.name}: vacant`,
        });
        const top = channel ? channel.id : channelUnit;
        const areas = v.areas.map((a) => a.trim().toLowerCase()).filter(Boolean);
        if (top && areas.length)
          seatsOf.set(top, [
            ...(seatsOf.get(top) ?? []),
            { node: seat, areas, taken: 0, managers: new Set() },
          ]);
      }
    for (const child of kidsOf.get(u.id) ?? []) {
      // A unit hangs under the co-lead its people report to (Finance under Sarla Devi)
      const boss = bossOfUnit(child.id);
      unitNode(
        child,
        (boss && leads.get(boss)) || anchor,
        depth + 1,
        channel ? channel.id : channelUnit,
      );
    }
    // Online: where its enquiries come from
    if (channel?.code === "ONLINE" && data.leadSources)
      for (const g of data.leadSources) {
        const group = make(anchor, {
          type: "dept",
          name: g.label,
          code: deptCode(g.label),
          role: enquiriesIn(g.count, data.month),
          hue,
        });
        for (const c of g.children)
          make(group, {
            type: "dept",
            name: c.label,
            code: deptCode(c.label),
            role: enquiriesIn(c.count, data.month),
            hue,
          });
      }
    return node;
  };
  for (const u of kidsOf.get(null) ?? []) unitNode(u, root, 0);

  // Whoever isn't on the chart, apart (so a missing person is seen, never lost)
  let apart: TNode | null = null;
  const notOnChart = () => {
    apart ??= make(root, {
      type: "dept",
      name: "Not on the org chart",
      code: NOT_ON_CHART,
      role: "Sales sheet and HR, not on the chart",
      hue: DEPT_HUE,
    });
    return apart;
  };
  // The sheet's territories: on the chart person holding them; a vacant one on the
  // chart's vacant seat covering its place; else under their channel's unit (one
  // node per territory: only people drawn from the chart take a territory's figures;
  // `answerTo` then hangs it under its manager when the manager is in that unit)
  const onChart = new Map(byContact);
  for (const t of data.territories) {
    // Only the drawn structure: a territory whose channel is closed since comes in
    // `former` (drawn under "Former channels"); an older server listed it here too
    if (!channelById.has(t.channelId)) continue;
    const holder = t.holderId ? onChart.get(t.holderId) : undefined;
    if (holder && t.holder) {
      holder.target += t.target / 100;
      holder.ach += t.achieved / 100;
      holder.today += t.today / 100;
      holder.held = (holder.held ?? 0) + 1;
      holder.zoho = [holder.zoho, t.name].filter(Boolean).join(", ");
      continue;
    }
    const sheetName = t.note ? t.note.replace(/^On the sheet: /, "") : null;
    if (!t.holder) {
      const place = [t.hq, t.name.split("|").pop()]
        .map((x) => (x ?? "").trim().toLowerCase())
        .filter(Boolean);
      const seat = (seatsOf.get(t.channelId) ?? []).find((s) =>
        s.areas.some((a) => place.some((p) => p === a || p.startsWith(a) || a.startsWith(p))),
      );
      if (seat) {
        seat.node.target += t.target / 100;
        seat.node.ach += t.achieved / 100;
        seat.node.today += t.today / 100;
        seat.node.zoho = seat.taken ? `${seat.node.zoho}, ${t.name}` : t.name;
        if (sheetName)
          seat.node.sheetName = seat.node.sheetName
            ? `${seat.node.sheetName}, ${sheetName}`
            : sheetName;
        seat.taken += 1;
        seat.node.held = seat.taken;
        seat.managers.add(t.managerId);
        continue;
      }
    }
    const node = make(unitOfChannel.get(t.channelId) ?? notOnChart(), {
      type: "rep",
      name: t.holder ?? t.hq ?? t.name,
      role: t.holder ? "Sales person" : "Vacant territory",
      contactId: t.holderId,
      zoho: t.name,
      hq: t.hq ?? "",
      vacant: !t.holder,
      sheetName,
      // Who they answer to on the sheet
      ledBy: t.manager ?? undefined,
      target: t.target / 100,
      ach: t.achieved / 100,
      today: t.today / 100,
    });
    offChart.push({ node, managerId: t.managerId });
  }
  // Each channel's CRM sales that no territory holds, and its territories closed
  // since: under the unit that sells for the channel (Online's desk under Online),
  // else apart so they are never lost
  for (const c of data.channels) {
    const own = withoutTerritory(c);
    if (own) make(unitOfChannel.get(c.id) ?? notOnChart(), own);
    if ((data.former?.territories ?? []).some((t) => t.channelId === c.id))
      formerTerritories(make, unitOfChannel.get(c.id) ?? notOnChart(), data, c.id);
  }
  const place = (p: Person, parent: TNode) =>
    make(parent, {
      type: "person",
      name: p.name,
      role: p.position ?? (p.rep ? "Sales person" : "Employee"),
      contactId: p.id,
    });
  const within = (n: TNode | undefined, top: TNode) => {
    for (let at = n; at; at = at.parent ?? undefined) if (at === top) return true;
    return false;
  };
  const unitOf = (p: Person) =>
    p.department ? unitByName.get(p.department.trim().toLowerCase()) : undefined;
  let pending = data.people.filter((p) => !byContact.has(p.id) && p.id !== data.ceoId);
  for (let pass = 0; pass < 30 && pending.length; pass++) {
    const waiting: Person[] = [];
    for (const p of pending) {
      const unit = unitOf(p);
      const boss = p.reportsToId ? byContact.get(p.reportsToId) : undefined;
      if (unit && boss && within(boss, unit.node)) place(p, boss);
      else if (unit && p.reportsToId && pending.some((q) => q.id === p.reportsToId))
        waiting.push(p);
      else place(p, unit?.anchor ?? notOnChart());
    }
    if (waiting.length === pending.length) {
      for (const p of waiting) place(p, unitOf(p)?.anchor ?? notOnChart());
      break;
    }
    pending = waiting;
  }

  // The sales sheet is newer than the chart: who a seller reports to is the sheet's
  // manager. Each chart member, then each vacant seat holding the sheet's territories
  // and each territory held off the chart, hangs under that person inside the unit
  // that sells for them, so the person's node carries their figures. Nobody leaves
  // their selling unit, so every channel's and division's total stays as it is.
  /** The nearest unit that sells (its node), as the chart sets its channel. */
  const sellingUnit = (n: TNode) => {
    for (let at: TNode | null = n; at; at = at.parent) if (at.unitChannel) return at;
    return null;
  };
  /** The nearest person above: whoever carries their figures in the drawing now. */
  const personAbove = (n: TNode) => {
    for (let at = n.parent; at; at = at.parent)
      if (PEOPLE_KINDS.includes(at.type) && !(at.type === "rep" && at.vacant)) return at;
    return null;
  };
  const move = (n: TNode, to: TNode) => {
    if (n.parent === to) return;
    n.parent?.kids.splice(n.parent.kids.indexOf(n), 1);
    n.parent = to;
    to.kids.push(n);
  };
  /**
   * Hangs `n` under `bossId` inside its selling unit: under their node there; when
   * they are above the unit (the founder, a division's head), right under the unit,
   * so nobody inside it carries what isn't theirs; when they are under another
   * channel or off the chart, and `draw`, under their node drawn once more in the
   * unit (as its members are: under the co-lead they report to, else its first lead).
   */
  const answerTo = (n: TNode, bossId: string | null | undefined, draw: boolean) => {
    if (!bossId || bossId === n.contactId) return;
    const unit = sellingUnit(n);
    const above = personAbove(n);
    const boss = drawn.get(bossId) ?? [];
    if (!unit || !boss.length || above?.contactId === bossId) return;
    const inUnit = boss.filter((b) => sellingUnit(b) === unit);
    if (inUnit.length) {
      // Never under someone who is under them (a loop in who reports to whom)
      const to = inUnit.find((b) => !within(b, n));
      if (to) move(n, to);
      return;
    }
    if (boss.some((b) => within(unit, b))) {
      if (above && within(above, unit)) move(n, unit);
      return;
    }
    if (!draw) return;
    const at = unitAt.get(unit);
    const up = info.get(bossId)?.reportsToId;
    const manager = make((up && at?.leads.get(up)) || at?.anchor || unit, {
      type: "manager",
      name: nameOf(bossId),
      role: "Manager (sales sheet)",
      contactId: bossId,
      sheet: true,
    });
    move(n, manager);
  };
  for (const n of memberNodes) answerTo(n, n.info?.reportsToId, true);
  // A seat holding the sheet's territories goes with them when they have one manager
  for (const s of [...seatsOf.values()].flat())
    if (s.managers.size === 1) answerTo(s.node, [...s.managers][0], false);
  for (const t of offChart) answerTo(t.node, t.managerId, false);
}

const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
const peso = (v: number) => `₱${Math.round(v).toLocaleString("en-PH")}`;
const short = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6
    ? `₱${(a / 1e6).toFixed(2)}M`
    : a >= 1e3
      ? `₱${Math.round(a / 1e3)}K`
      : `₱${Math.round(a)}`;
};
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;
/** "12 enquiries in Nov": a lead source's cards first written that month. */
const enquiriesIn = (n: number, month: string) => {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)).toLocaleString("en-PH", {
    month: "short",
    timeZone: "UTC",
  });
  return `${count(n, "enquiry", "enquiries")} in ${name}`;
};
const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
};

/**
 * How much of a month's target is due by now (the tree's pace mark and the map's
 * colours): the running month by today's day, since achieved counts the CRM's
 * sales up to today whatever day the sheet was entered; a past month the whole
 * target; a month not begun yet nothing.
 */
export function monthPace(month: string, today: string) {
  const days = daysIn(month);
  const now = today.slice(0, 7);
  const past = month < now;
  const ahead = month > now;
  const day = past
    ? days
    : ahead
      ? 0
      : Math.min(days, Math.max(1, Number(today.slice(8, 10)) || 1));
  const share = day / days;
  const pct = Math.round(share * 100);
  return {
    day,
    days,
    share,
    /** Said under the tree's bar. */
    note: past
      ? "The month is over: the mark is the whole target."
      : ahead
        ? "The month hasn't started yet."
        : `The mark is the month's pace by today: ${pct}% (day ${day} of ${days}).`,
    /** The map's "on pace" colour, in words. */
    label: past
      ? "Reached the target"
      : ahead
        ? "On pace (the month hasn't started)"
        : `On pace by today (${pct}% of the target)`,
  };
}

/** Achieved ÷ target against the pace: on pace, a little behind (20% or more), behind, or no target. */
export function paceState(ratio: number | null, share: number): "good" | "warn" | "bad" | "none" {
  return ratio === null ? "none" : ratio >= share ? "good" : ratio >= 0.2 ? "warn" : "bad";
}

/** Whether a node shows sales figures: a target, sales, or territories (vacant ones too). */
export const sells = (n: TNode) => n.target > 0 || n.ach > 0 || n.territories > 0;

/** A node's money in short: achieved of its target, or achieved alone when it has none. */
const moneyText = (n: TNode) =>
  n.target > 0 ? `${short(n.ach)} of ${short(n.target)}` : `${short(n.ach)}, no target`;

/** The figures line of a node's card (the Tree view). */
export const figuresLine = (n: TNode) =>
  sells(n) ? `${moneyText(n)} · today ${short(n.today)}` : "Not in the sales structure";

/** Mounts the tree into `el`; returns the cleanup (listeners off). */
export function mountTree(el: HTMLElement, data: TreeData): () => void {
  const { root, nodes } = buildTree(data);
  const nameById = new Map(data.people.map((p) => [p.id, p.name]));
  // By today's date, not the sheet's: achieved has the CRM's sales up to today
  const pace = monthPace(data.month, data.today);
  const PACE = pace.share;
  const pctOf = (n: TNode) => (n.target > 0 ? n.ach / n.target : null);
  const stateOf = (n: TNode) => paceState(pctOf(n), PACE);
  const pctText = (n: TNode) => {
    const p = pctOf(n);
    return p === null ? "—" : `${(p * 100).toFixed(1)}%`;
  };
  const up = (n: TNode, type: Kind) => {
    let p = n.parent;
    while (p && p.type !== type) p = p.parent;
    return p;
  };
  const headOf = (n: TNode) => (n.type === "channel" ? n.ledBy || n.name : n.name);
  const phone = () => window.innerWidth <= 640;
  const metaOf = (n: TNode) => {
    if (n.type === "rep" && n.former) return `${n.zoho ?? ""} · ${n.role}`;
    if (n.type === "rep") return n.vacant ? (n.zoho ?? "") : (n.hq ?? "");
    if (n.areas && (n.type === "person" || n.type === "manager" || n.type === "head"))
      return n.areas;
    const people = count(n.people.size, "person", "people");
    if (n.type === "manager") {
      const label = n.sheet ? n.role : "Manager";
      return n.people.size
        ? `${label} · ${people}${n.vacantCount ? ` · ${n.vacantCount} vacant` : ""}`
        : label;
    }
    return n.people.size ? `${n.role} · ${people}` : n.role;
  };
  const initials = (n: TNode) => {
    if (n.type === "channel" || n.type === "dept")
      return n.code ?? n.name.slice(0, 3).toUpperCase();
    if (n.vacant) return "—";
    const w = n.name.split(/\s+/).filter(Boolean);
    if (w.length === 1)
      return /^[A-Z]{2,3}$/.test(w[0] ?? "") ? (w[0] ?? "") : (w[0]?.[0] ?? "").toUpperCase();
    return `${w[0]?.[0] ?? ""}${w[w.length - 1]?.[0] ?? ""}`.toUpperCase();
  };
  const ava = (n: TNode, d: number) => {
    const p = pctOf(n);
    const r = d / 2 - 1.5;
    const c = 2 * Math.PI * r;
    const len = p === null ? 0 : Math.min(1, p) * c;
    const h = d / 2;
    const code = initials(n);
    const coded = n.type === "channel" || n.type === "dept";
    const fs = coded ? d * (code.length > 3 ? 0.2 : 0.25) : d * 0.3;
    return `<span class="ava" style="width:${d}px;height:${d}px"><svg viewBox="0 0 ${d} ${d}" aria-hidden="true"><circle class="track" cx="${h}" cy="${h}" r="${r}"/>${
      len
        ? `<circle class="arc ${stateOf(n)}" cx="${h}" cy="${h}" r="${r}" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${h} ${h})"/>`
        : ""
    }</svg><span class="disc" style="font-size:${fs.toFixed(1)}px">${esc(code)}</span></span>`;
  };

  // Layouts: the org chart top to bottom (a team with no one under its members is a
  // column), the tree left to right (every node a card)
  const SLOT = 188;
  const ROW_W = 172;
  const ROW_H = 58;
  const GAP_Y = 58;
  const M = 48;
  const RAD: Record<string, number> = {
    ceo: 42,
    head: 34,
    channel: 30,
    dept: 30,
    manager: 31,
    person: 30,
    rep: 28,
  };
  const nodeH = (n: TNode) => 2 * (RAD[n.type] ?? 30) + 10 + 64;
  const LEVEL_H = [158, 142, 136, 136, 136, 136];
  const levelY = (d: number) => {
    let y = M;
    for (let i = 0; i < d; i++) y += (LEVEL_H[i] ?? 136) + GAP_Y;
    return y;
  };
  const stacked = (n: TNode) =>
    n.kids.length > 0 &&
    n.kids.every((k) => k.kids.length === 0 && (k.type === "rep" || k.type === "person" || k.crm));
  const CARD_W = 212;
  const CEO_W = 232;
  const CARD_H = 92;
  const COL_GAP = 56;
  const CARD_GAP = 12;
  const wOf = (n: TNode) => (n.type === "ceo" ? CEO_W : CARD_W);

  const open = new Set<string>([root.id, ...root.kids.map((k) => k.id)]);
  let selected: string | null = null;
  let seen = new Set<string>();
  let view: "chart" | "tree" = "chart";
  try {
    if (localStorage.getItem("org-tree.view") === "tree") view = "tree";
  } catch {}
  let lay: { shown: TNode[]; w: number; h: number } = { shown: [], w: 0, h: 0 };

  function layoutChart() {
    let cursor = M;
    let bottom = 0;
    const shown: TNode[] = [];
    (function place(n: TNode, depth: number) {
      const y = levelY(depth);
      n.y = y;
      n.row = false;
      shown.push(n);
      const isOpen = n.kids.length > 0 && open.has(n.id);
      if (isOpen && stacked(n)) {
        n.x = cursor + SLOT / 2;
        const top = y + nodeH(n) + 40;
        n.kids.forEach((k, i) => {
          k.x = n.x - ROW_W / 2;
          k.y = top + i * ROW_H;
          k.row = true;
          shown.push(k);
        });
        bottom = Math.max(bottom, top + n.kids.length * ROW_H);
        cursor += SLOT;
      } else if (isOpen) {
        for (const k of n.kids) place(k, depth + 1);
        n.x = ((n.kids[0]?.x ?? 0) + (n.kids[n.kids.length - 1]?.x ?? 0)) / 2;
      } else {
        n.x = cursor + SLOT / 2;
        cursor += SLOT;
        bottom = Math.max(bottom, y + nodeH(n));
      }
    })(root, 0);
    return { shown, w: cursor + M, h: bottom + M };
  }
  function layoutTree() {
    let cursor = M;
    let right = 0;
    const shown: TNode[] = [];
    const colX = (d: number) => (d === 0 ? M : M + CEO_W + COL_GAP + (d - 1) * (CARD_W + COL_GAP));
    (function place(n: TNode, depth: number) {
      n.x = colX(depth);
      n.row = false;
      shown.push(n);
      right = Math.max(right, n.x + wOf(n));
      if (n.kids.length > 0 && open.has(n.id)) {
        for (const k of n.kids) place(k, depth + 1);
        n.y = ((n.kids[0]?.y ?? 0) + (n.kids[n.kids.length - 1]?.y ?? 0)) / 2;
      } else {
        n.y = cursor;
        cursor += CARD_H + CARD_GAP;
      }
    })(root, 0);
    return { shown, w: right + M, h: cursor - CARD_GAP + M };
  }
  const centerOf = (n: TNode) => {
    if (view === "tree") return { x: n.x + wOf(n) / 2, y: n.y + CARD_H / 2 };
    return n.row ? { x: n.x + ROW_W / 2, y: n.y + 26 } : { x: n.x, y: n.y + (RAD[n.type] ?? 30) };
  };
  function chartEdges() {
    const out: string[] = [];
    for (const n of lay.shown) {
      if (n.row || !n.kids.length || !open.has(n.id)) continue;
      const b = n.y + nodeH(n) + 2;
      const stroke =
        n.type === "ceo"
          ? "color-mix(in srgb, var(--ink) 22%, transparent)"
          : `color-mix(in srgb, ${n.hue} 45%, transparent)`;
      if (stacked(n)) {
        const sx = (n.kids[0]?.x ?? 0) + 26;
        const cy = (k: TNode) => k.y + 26;
        const rr = 22;
        const first = cy(n.kids[0] as TNode) - rr;
        let d = `M${n.x} ${b} C${n.x} ${b + 22} ${sx} ${first - 24} ${sx} ${first}`;
        for (let i = 0; i + 1 < n.kids.length; i++)
          d += ` M${sx} ${cy(n.kids[i] as TNode) + rr} V${cy(n.kids[i + 1] as TNode) - rr}`;
        out.push(`<path style="stroke:${stroke}" d="${d}"/>`);
      } else {
        for (const k of n.kids) {
          const t = k.y - 3;
          const m = (b + t) / 2;
          out.push(
            `<path style="stroke:${stroke}" d="M${n.x} ${b} C${n.x} ${m} ${k.x} ${m} ${k.x} ${t}"/>`,
          );
        }
      }
    }
    return out.join("");
  }
  function treeEdges() {
    const out: string[] = [];
    for (const n of lay.shown) {
      if (!n.kids.length || !open.has(n.id)) continue;
      const px = n.x + wOf(n);
      const py = n.y + CARD_H / 2;
      const sx = px + COL_GAP / 2;
      const ys = n.kids.map((k) => k.y + CARD_H / 2);
      let d = `M${px} ${py} H${sx}`;
      if (ys.length > 1) d += ` M${sx} ${ys[0]} V${ys[ys.length - 1]}`;
      for (const k of n.kids) d += ` M${sx} ${k.y + CARD_H / 2} H${k.x}`;
      out.push(`<path class="elbow" d="${d}"/>`);
    }
    return out.join("");
  }
  function cardHtml(n: TNode, fresh: boolean) {
    const has = n.kids.length > 0;
    const isOpen = has && open.has(n.id);
    const p = pctOf(n);
    const sub =
      n.type === "rep" && !n.former ? (n.vacant ? n.zoho : `${n.zoho} · ${n.hq}`) : metaOf(n);
    return `<button type="button" class="card t-${n.type}${n.vacant ? " vacant" : ""}${n.former ? " former" : ""}${selected === n.id ? " selected" : ""}${fresh ? " enter" : ""}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${wOf(n)}px;--hue:${n.hue}"${has ? ` aria-expanded="${isOpen}"` : ""}>
      <span class="row1"><span class="name">${esc(n.name)}${n.vacant ? '<span class="vac">Vacant</span>' : ""}</span><span class="pct ${stateOf(n)}">${pctText(n)}</span></span>
      <span class="sub">${esc(sub)}</span>
      <span class="cbar"><i class="${stateOf(n)}" style="width:${p === null ? 0 : Math.min(100, p * 100)}%"></i><b style="left:${PACE * 100}%"></b></span>
      <span class="nums">${esc(figuresLine(n))}</span>
      ${has ? `<span class="chip" aria-hidden="true">${isOpen ? "−" : "+"}</span>` : ""}</button>`;
  }
  function chartHtml(n: TNode, fresh: boolean) {
    const sel = selected === n.id ? " selected" : "";
    const enter = fresh ? " enter" : "";
    const former = n.former ? " former" : "";
    if (n.row)
      return `<button type="button" class="row t-${n.type}${n.vacant ? " vacant" : ""}${former}${sel}${enter}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;--hue:${n.hue}">${ava(n, 40)}
        <span class="rt"><span class="nm">${esc(n.name)}${n.vacant ? '<span class="vac">Vacant</span>' : ""}</span><span class="meta">${esc(n.type === "person" ? n.role : metaOf(n))}</span><span class="money">${esc(sells(n) ? moneyText(n) : n.role)}</span></span>
        <b class="pc ${stateOf(n)}">${pctText(n)}</b></button>`;
    const has = n.kids.length > 0;
    const isOpen = has && open.has(n.id);
    return `<button type="button" class="node t-${n.type}${former}${sel}${enter}" data-id="${n.id}" style="left:${n.x - SLOT / 2}px;top:${n.y}px;--hue:${n.hue}"${has ? ` aria-expanded="${isOpen}"` : ""}>
      <span class="avawrap">${ava(n, 2 * (RAD[n.type] ?? 30))}${has && !isOpen && n.people.size ? `<span class="count" title="${count(n.people.size, "person", "people")} under">${n.people.size}</span>` : ""}</span>
      <span class="nm">${esc(n.name)}</span><span class="meta">${esc(metaOf(n))}</span>
      <span class="fig"><b class="${stateOf(n)}">${pctText(n)}</b><span class="money"> · ${esc(sells(n) ? moneyText(n) : "no sales figures")}</span></span></button>`;
  }

  el.innerHTML = `
    <header class="top">
      <div class="brand">
        <p class="over">${esc(data.company)} · ${esc(monthLabel(data.month))}</p>
        <h1>Company tree</h1>
        <p class="sum"></p>
      </div>
      <div class="tools">
        <div class="seg" role="group" aria-label="View">
          <button type="button" data-view="chart">Org chart</button>
          <button type="button" data-view="tree">Tree</button>
        </div>
        <div class="search">
          <svg class="mag" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          <input type="search" placeholder="Find a person, territory or department" autocomplete="off" aria-label="Find a person, territory or department">
          <div class="results" hidden></div>
        </div>
        <button class="ghost" data-act="expand" type="button">Expand all</button>
        <button class="ghost" data-act="collapse" type="button">Top level</button>
        <div class="zoom" role="group" aria-label="Zoom">
          <button data-act="zout" type="button" aria-label="Zoom out">−</button>
          <output>100%</output>
          <button data-act="zin" type="button" aria-label="Zoom in">+</button>
        </div>
        <button class="ghost" data-act="fit" type="button">Fit</button>
      </div>
    </header>
    <div class="vp" aria-label="Company tree. Drag to move; pinch, Ctrl and scroll, or the buttons to zoom.">
      <div class="stage"><svg class="edges" aria-hidden="true"></svg><div class="nodes"></div></div>
      <div class="legend"><span class="lk"></span><span><i class="good"></i>On pace</span><span><i class="warn"></i>A little behind</span><span><i class="bad"></i>Behind</span><span><i class="none"></i>No target</span></div>
      <aside class="panel" hidden aria-label="Details"></aside>
    </div>`;
  const $ = <T extends Element>(sel: string) => el.querySelector(sel) as T;
  const vp = $<HTMLDivElement>(".vp");
  const stage = $<HTMLDivElement>(".stage");
  const edgesEl = $<SVGSVGElement>(".edges");
  const nodesEl = $<HTMLDivElement>(".nodes");
  const panel = $<HTMLElement>(".panel");
  const zlabel = $<HTMLOutputElement>(".zoom output");
  const seg = $<HTMLDivElement>(".seg");
  const legendKey = $<HTMLSpanElement>(".lk");
  const q = $<HTMLInputElement>(".search input");
  const results = $<HTMLDivElement>(".results");
  const elOf = (id: string) => nodesEl.querySelector<HTMLElement>(`[data-id="${id}"]`);

  function render() {
    lay = view === "tree" ? layoutTree() : layoutChart();
    edgesEl.setAttribute("width", String(lay.w));
    edgesEl.setAttribute("height", String(lay.h));
    edgesEl.setAttribute("viewBox", `0 0 ${lay.w} ${lay.h}`);
    edgesEl.innerHTML = view === "tree" ? treeEdges() : chartEdges();
    nodesEl.innerHTML = lay.shown
      .map((n) => (view === "tree" ? cardHtml(n, !seen.has(n.id)) : chartHtml(n, !seen.has(n.id))))
      .join("");
    seen = new Set(lay.shown.map((n) => n.id));
    stage.style.width = `${lay.w}px`;
    stage.style.height = `${lay.h}px`;
  }

  const crumbs = (n: TNode) => {
    const out: string[] = [];
    for (let p = n.parent; p; p = p.parent) out.unshift(p.name);
    return out.join(" · ");
  };
  const fact = (label: string, value: string | null | undefined) =>
    value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : "";
  function showPanel(n: TNode) {
    const kids = [...n.kids].sort((a, b) => (pctOf(b) ?? -1) - (pctOf(a) ?? -1));
    const bal = n.target - n.ach;
    const p = pctOf(n);
    const channel = up(n, "channel");
    // Who they report to in the CRM, else (a territory off the chart) the sheet's
    // manager, else the nearest person above them in the drawing ("Not on the org
    // chart" is a group, no one's boss)
    const above = () => {
      for (let at = n.parent; at; at = at.parent) {
        if (at.type === "dept" && at.code === NOT_ON_CHART) return null;
        if (PEOPLE_KINDS.includes(at.type) && !(at.type === "rep" && at.vacant)) return at.name;
      }
      return null;
    };
    const boss =
      (n.info?.reportsToId ? nameById.get(n.info.reportsToId) : undefined) ??
      (n.type === "rep" && n.ledBy ? n.ledBy : undefined) ??
      (data.units?.length
        ? above()
        : n.parent && n.parent.type !== "dept" && n.parent.type !== "channel"
          ? n.parent.name
          : n.parent?.type === "channel"
            ? headOf(n.parent)
            : null);
    const hr = n.info;
    const facts =
      n.type === "channel" || n.type === "dept"
        ? ""
        : n.former
          ? `<dl class="facts">${fact("Territory", n.zoho)}${fact("HQ", n.hq)}${fact("Channel", channel?.name)}${fact("Last held by", n.heldBy)}${fact("Manager", n.ledBy)}${fact("On the sheet", n.sheetName)}</dl>`
          : `<dl class="facts">${
              n.type === "rep"
                ? `${fact("Territory", n.zoho)}${fact("HQ", n.hq)}${fact("Channel", channel?.name)}`
                : `${fact("Covers", n.areas)}${fact(n.held && n.held > 1 ? "Territories" : "Territory", n.zoho)}`
            }${fact("Position", hr?.position ?? (n.type === "person" ? null : n.role))}${fact("Department", hr?.department)}${fact("Reports to", boss)}${fact("Employee ID", hr?.code)}${
              n.vacant && n.sheetName ? fact("On the sheet", n.sheetName) : ""
            }</dl>`;
    const who =
      n.crm || n.former
        ? `<p class="who">${esc(n.note ?? "")}</p>`
        : n.people.size === 0
          ? n.type === "rep" || n.type === "person"
            ? ""
            : `<p class="who">No one under them yet</p>`
          : `<p class="who">${count(n.people.size, "person", "people")}${n.territories ? ` · ${count(n.territories, "territory", "territories")}` : ""}${n.vacantCount ? ` · <span class="bad">${n.vacantCount} vacant</span>` : ""}${n.ledBy ? ` · run by ${esc(n.ledBy)}` : ""}</p>`;
    // With no target there is no pace or balance to show: what was sold, and today's
    const money = !sells(n)
      ? ""
      : n.target > 0
        ? `<div><div class="hero"><strong class="${stateOf(n)}">${pctText(n)}</strong><span>of the ${esc(monthLabel(data.month))}<br>target</span></div>
        <span class="tbar"><i class="${stateOf(n)}" style="width:${p === null ? 0 : Math.min(100, p * 100)}%"></i><b style="left:${PACE * 100}%"></b></span>
        <p class="pace">${esc(pace.note)}</p></div>
      <div class="figs"><div><small>Target</small><b>${peso(n.target)}</b></div><div><small>Achieved</small><b>${peso(n.ach)}</b></div>
        <div><small>${bal < 0 ? "Over target by" : "Balance to do"}</small><b>${peso(Math.abs(bal))}</b></div><div><small>Today</small><b>${peso(n.today)}</b></div></div>`
        : `<div class="figs"><div><small>Achieved</small><b>${peso(n.ach)}</b></div><div><small>Today</small><b>${peso(n.today)}</b></div></div>`;
    panel.innerHTML = `
      <button class="close" type="button" aria-label="Close details" data-act="close">×</button>
      <div class="crumbs">${esc(crumbs(n)) || esc(data.company)}</div>
      <div class="ph t-${n.type}${n.vacant ? " vacant" : ""}${n.former ? " former" : ""}" style="--hue:${n.hue}">${ava(n, 62)}<div><h2>${esc(n.name)}</h2><div class="role">${esc(n.code ? `${n.code} · ${n.role}` : n.role)}</div></div></div>
      ${money}
      ${facts}
      ${who}
      ${
        kids.length
          ? `<div class="under"><h3>${n.type === "ceo" ? "Under the CEO" : `Under ${esc(n.name)}`}</h3>${kids
              .map(
                (k) =>
                  `<button type="button" class="t-${k.type}${k.vacant ? " vacant" : ""}${k.former ? " former" : ""}" data-go="${k.id}" style="--hue:${k.hue}">${ava(k, 36)}<span class="tx"><span class="n">${esc(k.name)}${k.vacant ? '<span class="vac">Vacant</span>' : ""}</span><span class="m">${esc(metaOf(k))}</span></span><b class="pc ${stateOf(k)}">${pctText(k)}</b></button>`,
              )
              .join("")}</div>`
          : ""
      }
      <p class="note">Achieved is ${data.asOf ? `the sales sheet's figure (entered ${esc(data.asOf)})` : "the sales sheet's figure (none entered for this month yet)"} plus the CRM's own delivered sales: on each territory, and under "Sales without a territory" those no territory holds. Today counts the sheet's only on the day it was entered. Territories and channels closed since keep the month's figures under "Former territories" and "Former channels".</p>`;
    panel.hidden = false;
  }
  function closePanel() {
    panel.hidden = true;
    selected = null;
    render();
  }

  // Pan and zoom
  let s = 1;
  let x = 0;
  let y = 0;
  function apply() {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    vp.classList.toggle("near", s >= 0.8);
    vp.classList.toggle("far", s < 0.5);
    vp.style.backgroundSize = `${24 * s}px ${24 * s}px`;
    vp.style.backgroundPosition = `${x}px ${y}px`;
    zlabel.textContent = `${Math.round(s * 100)}%`;
  }
  function zoomAt(f: number, cx: number, cy: number) {
    const ns = Math.min(2, Math.max(0.2, s * f));
    x = cx - (cx - x) * (ns / s);
    y = cy - (cy - y) * (ns / s);
    s = ns;
    apply();
  }
  function fit() {
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const tree = view === "tree";
    s = Math.max(phone() ? 0.5 : 0.2, Math.min(1, (vw - 32) / lay.w, (vh - 72) / lay.h));
    const spare = Math.max(0, (vh - 56 - lay.h * s) / 2);
    x = phone() ? (tree ? 0 : vw / 2 - root.x * s) : (vw - lay.w * s) / 2;
    y = tree ? spare : phone() ? 0 : spare * 0.7;
    apply();
  }
  function centerOn(n: TNode) {
    if (s < 0.8) s = 1;
    const c = centerOf(n);
    const fw = panel.hidden || phone() ? vp.clientWidth : vp.clientWidth - 404;
    const fh = phone() && !panel.hidden ? vp.clientHeight * 0.36 : vp.clientHeight;
    const tree = view === "tree";
    x = fw * (tree ? 0.3 : 0.5) - c.x * s;
    y = fh * (tree ? 0.5 : 0.3) - c.y * s;
    apply();
  }
  function select(
    id: string,
    opts: { toggle?: boolean; center?: boolean; focus?: boolean; flash?: boolean } = {},
  ) {
    const n = nodes.get(id);
    if (!n) return;
    const before = lay.shown.includes(n) ? centerOf(n) : null;
    for (let p = n.parent; p; p = p.parent) open.add(p.id);
    if (opts.toggle && n.kids.length) {
      if (open.has(id) && selected === id) open.delete(id);
      else open.add(id);
    }
    selected = id;
    render();
    showPanel(n);
    const after = centerOf(n);
    if (opts.center) centerOn(n);
    else if (phone()) {
      x = vp.clientWidth * (view === "tree" ? 0.3 : 0.5) - after.x * s;
      y = vp.clientHeight * 0.16 - after.y * s;
      apply();
    } else if (before) {
      x += (before.x - after.x) * s;
      y += (before.y - after.y) * s;
      apply();
    }
    const node = elOf(id);
    if (node && opts.focus) node.focus({ preventScroll: true });
    if (node && opts.flash) {
      node.classList.add("flash");
      setTimeout(() => node.classList.remove("flash"), 1400);
    }
  }

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  const on = (t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) => {
    t.addEventListener(type, fn, o);
    listeners.push([t, type, fn, o]);
  };

  on(panel, "click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-act=close]")) return closePanel();
    const go = t.closest<HTMLElement>("[data-go]");
    if (go?.dataset.go) select(go.dataset.go, { center: true, flash: true });
  });
  on(vp, "scroll", () => {
    x -= vp.scrollLeft;
    y -= vp.scrollTop;
    vp.scrollLeft = 0;
    vp.scrollTop = 0;
    apply();
  });
  const pts = new Map<number, { x: number; y: number }>();
  let moved = false;
  let start: { px: number; py: number; x: number; y: number } | null = null;
  let pinch: { d: number; s: number } | null = null;
  on(vp, "pointerdown", (ev) => {
    const e = ev as PointerEvent;
    if ((e.target as Element).closest(".panel, .legend")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      moved = false;
      start = { px: e.clientX, py: e.clientY, x, y };
    }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s };
    }
  });
  on(vp, "pointermove", (ev) => {
    const e = ev as PointerEvent;
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const r = vp.getBoundingClientRect();
      zoomAt(
        (pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d / s,
        (a.x + b.x) / 2 - r.left,
        (a.y + b.y) / 2 - r.top,
      );
      moved = true;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) {
      moved = true;
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("dragging");
    }
    x = start.x + dx;
    y = start.y + dy;
    apply();
  });
  const lift = (ev: Event) => {
    const e = ev as PointerEvent;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) {
      start = null;
      vp.classList.remove("dragging");
    }
  };
  on(vp, "pointerup", lift);
  on(vp, "pointercancel", lift);
  on(
    vp,
    "wheel",
    (ev) => {
      const e = ev as WheelEvent;
      if ((e.target as Element).closest(".panel")) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else {
        x -= e.deltaX;
        y -= e.deltaY;
        apply();
      }
    },
    { passive: false },
  );
  on(nodesEl, "click", (ev) => {
    const e = ev as MouseEvent;
    const node = (e.target as Element).closest<HTMLElement>("[data-id]");
    if (!node?.dataset.id) return;
    if (moved && e.detail !== 0) {
      moved = false;
      return;
    }
    select(node.dataset.id, { toggle: true, focus: e.detail === 0 });
  });
  on(el, "click", (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "zin") zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2);
    else if (act === "zout") zoomAt(1 / 1.2, vp.clientWidth / 2, vp.clientHeight / 2);
    else if (act === "fit") fit();
    else if (act === "expand") {
      for (const n of nodes.values()) if (n.kids.length) open.add(n.id);
      render();
      fit();
    } else if (act === "collapse") {
      open.clear();
      open.add(root.id);
      render();
      fit();
    }
  });
  function showView() {
    for (const b of seg.querySelectorAll<HTMLButtonElement>("button"))
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    legendKey.textContent =
      view === "tree"
        ? "Bar = achieved ÷ target, the mark is the pace"
        : "Ring = achieved ÷ target";
  }
  on(seg, "click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-view]");
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view === "tree" ? "tree" : "chart";
    try {
      localStorage.setItem("org-tree.view", view);
    } catch {}
    showView();
    seen = new Set();
    render();
    fit();
  });
  on(document, "keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Escape" && !panel.hidden) closePanel();
  });

  // Search
  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  on(q, "input", () => {
    const t = norm(q.value.trim());
    if (!t) {
      results.hidden = true;
      return;
    }
    const hits = [...nodes.values()]
      .filter((n) =>
        norm(
          [
            n.name,
            n.sheetName,
            n.zoho,
            n.hq,
            n.code,
            n.info?.code,
            n.info?.department,
            n.info?.position,
          ]
            .filter(Boolean)
            .join(" "),
        ).includes(t),
      )
      .slice(0, 8);
    results.innerHTML = hits.length
      ? hits
          .map(
            (n) =>
              `<button type="button" data-hit="${n.id}"><b>${esc(n.vacant ? `${n.hq} (vacant)` : n.name)}</b><small>${esc(
                n.type === "rep"
                  ? n.former
                    ? `${n.zoho} · ${n.role}`
                    : `${n.zoho} · ${n.hq}`
                  : n.type === "channel"
                    ? `${n.code} · channel`
                    : n.crm
                      ? `${n.code} · ${n.role}`
                      : [n.role, n.info?.department].filter(Boolean).join(" · "),
              )}</small></button>`,
          )
          .join("")
      : `<div class="empty">Nobody by that name</div>`;
    results.hidden = false;
  });
  on(q, "keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Enter") results.querySelector<HTMLButtonElement>("[data-hit]")?.click();
    if (e.key === "Escape") {
      q.value = "";
      results.hidden = true;
    }
  });
  on(results, "click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-hit]");
    if (!b?.dataset.hit) return;
    results.hidden = true;
    q.value = "";
    select(b.dataset.hit, { center: true, flash: true });
  });
  on(document, "click", (e) => {
    if (!(e.target as Element).closest?.(".search")) results.hidden = true;
  });

  $<HTMLParagraphElement>(".sum").innerHTML =
    `<b>${short(root.ach)}</b> achieved of ${short(root.target)} · <b class="${stateOf(root)}">${pctText(root)}</b> · ${count(root.people.size, "person", "people")}${data.asOf ? ` · sheet as of ${esc(data.asOf)}` : ""}`;
  showView();
  render();
  const frame = requestAnimationFrame(fit);
  let lastWidth = window.innerWidth;
  on(window, "resize", () => {
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      requestAnimationFrame(fit);
    }
  });
  return () => {
    cancelAnimationFrame(frame);
    for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
    el.innerHTML = "";
  };
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)).toLocaleString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
