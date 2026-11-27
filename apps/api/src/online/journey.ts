// A case's road and journey, said once. Brought over from the old CRM as it was
// (backend/platform/src/journey.ts): the road steps' words, the journey chart's stops.
//
// A case walks one of three payment roads (regular, senior / PWD discount,
// GL). The rules keep where it stands as one saved `road_step`; the screens
// draw it as the desk's step chip, the steps rail and the journey chart, and
// the website admin reads it as the progress row of an order the CRM has.
// Every one of them reads this module: `frontend/lib/road-steps.ts` adds the
// icons, `components/lead-journey.tsx` the drawing (coordinates, hints,
// links), `apps/store/src/progress.ts` the website's answer. So a step's
// label, a stop's label, the stops on a road and which stop a saved step
// stands at are written here only, and a test holds the three to it.
// Pure and import-free: the web app loads it as `@bishnoi/platform/journey`.

export type Road = "regular" | "discount" | "gl";

/** A saved `road_step` in words: its label, and what to do at it. */
export type RoadStepData = { value: string; label: string; hint: string };

// Quote can go out before the pharmacist finishes; the order still needs an
// approved Rx. Then the road splits: regular is ready once the buyer agrees,
// senior/PWD still needs the ID, a guarantee letter walks the agency's wait.
const OPENING: RoadStepData[] = [
  { value: "new", label: "New", hint: "answer the enquiry" },
  { value: "rx_wait", label: "Rx needed", hint: "upload the prescription and documents first" },
  { value: "rx_check", label: "Rx check", hint: "record the pharmacist’s prescription review" },
  {
    value: "rx_ok",
    label: "Rx ok",
    hint: "prescription approved — review the quotation and remaining papers",
  },
];

const AFTER_DELIVERY: RoadStepData[] = [
  { value: "invoice", label: "Delivered", hint: "order complete — record payment when received" },
  { value: "payment", label: "Awaiting payment", hint: "invoice issued — record payment" },
  { value: "done", label: "Done", hint: "delivered and settled; refill when due" },
];

/** Every road's steps, in the order the road walks them. */
export const ROAD_STEP_DATA: Record<Road, RoadStepData[]> = {
  regular: [
    ...OPENING,
    { value: "quoted", label: "Quoted", hint: "the buyer decides" },
    { value: "papers", label: "Papers", hint: "anything missing comes in" },
    { value: "ready", label: "Ready", hint: "accepted — place the order" },
    { value: "ordered", label: "Ordered", hint: "release and deliver" },
    ...AFTER_DELIVERY,
  ],
  discount: [
    ...OPENING,
    { value: "quoted", label: "Quoted", hint: "the buyer decides, the discount counted" },
    { value: "papers", label: "Senior / PWD ID", hint: "Senior citizen or PWD ID on file" },
    { value: "ready", label: "Ready", hint: "20% off + no VAT — place the order" },
    { value: "ordered", label: "Ordered", hint: "release and deliver" },
    ...AFTER_DELIVERY,
  ],
  gl: [
    ...OPENING,
    {
      value: "quoted",
      label: "Quoted",
      hint: "send it to the patient — it rides with the application",
    },
    { value: "apply", label: "Apply", hint: "record the agency application" },
    { value: "papers", label: "GL documents", hint: "file the prescription and agency papers" },
    { value: "waiting", label: "At the agency", hint: "DSWD days, OVP weeks — follow up" },
    { value: "verify", label: "Letter in", hint: "verify the GL and the papers" },
    { value: "ready", label: "Ready", hint: "letter verified — place the order" },
    { value: "ordered", label: "Ordered", hint: "release and deliver" },
    {
      value: "claim",
      label: "Photo to agency",
      hint: "take the hand-over photo, send it to the agency, then submit the claim",
    },
    { value: "billed", label: "Claimed", hint: "claim submitted — waiting for the agency to pay" },
    { value: "done", label: "Paid", hint: "the agency paid the claim" },
  ],
};

/** The payment road a lead's `assistance` puts it on. */
export function roadOf(assistance: unknown): Road {
  const a = String(assistance ?? "none");
  return a === "gl" ? "gl" : a === "senior" || a === "pwd" ? "discount" : "regular";
}

/** A step on a road (an unknown one reads as the road's first). */
export function roadStepData(road: Road, step: string): RoadStepData {
  const steps = ROAD_STEP_DATA[road];
  return (
    steps.find((s) => s.value === step) ?? steps[0] ?? { value: "new", label: "New", hint: "" }
  );
}

/** Where a lead stands, in the desk's words (its saved `road_step`, else its stage). */
export function roadStepLabel(lead: {
  state?: unknown;
  road_step?: unknown;
  assistance?: unknown;
}): string {
  if (lead.state === "lost" || lead.road_step === "lost") return "Lost";
  return roadStepData(roadOf(lead.assistance), String(lead.road_step || lead.state || "new")).label;
}

/**
 * Where a saved `road_step` sits on the screens: the case's rail (1 Rx &
 * documents, 2 Enquiry & quotation, 3 Order & delivery, 4 Payment / Claim &
 * payment; -1 lost: the papers first, Aryan 27 Nov) and the journey chart's
 * stop. "verification" is the papers stop the journey resolves by road (the
 * Rx, or the senior / PWD ID and Rx), or the stop after it once they are in. `ordered` stands at "pickup" (Delivered); the journey puts
 * it at "packed" while the order isn't packed (nor shipped) yet. After
 * delivery the GL road walks Photo sent → Claim → Paid:
 * `claim` stands at "photo" (the journey moves it to "claim" once the photo
 * was sent), `billed` waits at "paid". Every road ends at the "paid" stop.
 * The raw `state` is the fallback for a lead whose step was never written.
 */
export type RoadStepPosition = { tab: 0 | 1 | 2 | 3 | 4 | -1; stop: string | null };

const POSITIONS: Record<string, RoadStepPosition> = {
  new: { tab: 1, stop: "enquiry" },
  replied: { tab: 2, stop: "quote" },
  // The prescription check is the active payment road's verification stop:
  // Senior / PWD also needs its ID here, not the Regular road's Rx-only stop.
  rx_wait: { tab: 1, stop: "verification" },
  rx_check: { tab: 1, stop: "verification" },
  rx_ok: { tab: 2, stop: "quote" },
  quoted: { tab: 2, stop: "verification" },
  docs: { tab: 1, stop: "verification" },
  papers: { tab: 1, stop: "verification" },
  apply: { tab: 2, stop: "apply" },
  waiting: { tab: 2, stop: "verified" },
  verify: { tab: 2, stop: "verified" },
  ready: { tab: 3, stop: "order" },
  ordered: { tab: 3, stop: "pickup" },
  invoice: { tab: 4, stop: "paid" },
  payment: { tab: 4, stop: "paid" },
  claim: { tab: 4, stop: "photo" },
  billed: { tab: 4, stop: "paid" },
  done: { tab: 4, stop: "paid" },
  lost: { tab: -1, stop: null },
};

export function roadStepPosition(roadStep: string, state: string): RoadStepPosition {
  if (state === "lost") return POSITIONS.lost as RoadStepPosition;
  return POSITIONS[roadStep] ?? POSITIONS[state] ?? { tab: 0, stop: null };
}

export const AGENCY_SHORT: Record<string, string> = {
  dswd: "DSWD",
  pcso: "PCSO",
  ovp: "OVP",
  op: "OP",
  mayor: "Mayor",
  governor: "Gov",
  congress: "Congress",
  malasakit: "Malasakit",
  doh: "DOH",
  philhealth: "PhilHealth",
  other: "Other",
};

/** A saved quotation made for another road (or agency) than the case's: to be reviewed and saved again. */
export function quotationStale(lead: Record<string, unknown>): boolean {
  const saved = lead.quote_context as { assistance?: string; agency?: string | null } | null;
  return Boolean(
    saved &&
      (saved.assistance !== String(lead.assistance ?? "none") ||
        (saved.assistance === "gl" && saved.agency !== (lead.agency ?? null))),
  );
}

// ── The payment road's lock ──────────────────────────────────────────────

/** Saved road steps a case reaches only once its quotation is saved for the road. */
const PRICED_STEPS = new Set([
  "quoted",
  "papers",
  "apply",
  "waiting",
  "verify",
  "ready",
  "ordered",
  "invoice",
  "payment",
  "claim",
  "billed",
  "done",
]);

/** Why a case's payment road can't be changed now. */
export type RoadLock = {
  /**
   * order: fixed for good · closed: a lost case · website: the customer chose
   * it on the website · quoted: the quotation is saved for it. The last two
   * only an owner or admin changes ("Change payment road", with a reason).
   */
  reason: "order" | "closed" | "website" | "quoted";
  /** In plain words, for the picker's tooltip and the server's refusal. */
  text: string;
};

/** Whether only an owner or admin may change the road now (with a reason), not that it is fixed for good. */
export const roadLockOpensFor = (lock: RoadLock | null) =>
  lock?.reason === "website" || lock?.reason === "quoted";

/**
 * Whether the case's payment road (`assistance`, and the agency on GL) may
 * still be changed by anyone. An order fixes it for good; a closed case keeps
 * it. A website order's road is the customer's choice on the website from the
 * start, and any other case's is locked once it is past its documents (a
 * quotation saved for the road, or a road step that comes after it): those two
 * an owner or admin may still change, with a reason, until the order exists.
 * A new order card (Order 2) has no saved quotation, so it picks its own road.
 */
export function roadLockOf(lead: Record<string, unknown>): RoadLock | null {
  if (lead.order_id || lead.state === "ordered")
    return { reason: "order", text: "Locked: the order is placed with this road." };
  if (lead.state === "lost") return { reason: "closed", text: "Locked: the case is closed." };
  if (lead.case_type === "website_order")
    return {
      reason: "website",
      text: "Locked: the customer chose this road on the website. An owner or admin can change it (Case actions → Change payment road).",
    };
  const quoted = Boolean(String(lead.quote ?? "").trim()) && !quotationStale(lead);
  if (quoted || PRICED_STEPS.has(String(lead.road_step ?? "")))
    return {
      reason: "quoted",
      text: "Locked: the quotation is saved for this road. An owner or admin can change it (Case actions → Change payment road).",
    };
  return null;
}

/** The road in short words, for the change note: "Regular", "Senior/PWD (senior citizen)", "GL (PCSO)". */
export function roadName(assistance: unknown, agency?: unknown): string {
  const a = String(assistance ?? "none");
  if (a === "senior") return "Senior/PWD (senior citizen)";
  if (a === "pwd") return "Senior/PWD (PWD)";
  if (a === "gl") {
    const code = String(agency ?? "").trim();
    return code ? `GL (${AGENCY_SHORT[code] ?? code.toUpperCase()})` : "GL";
  }
  return "Regular";
}

/**
 * The road in words that can't be misread: "Regular — no discount",
 * "Senior citizen — 20% off, no VAT", "PWD — 20% off, no VAT", "GL — PCSO".
 */
export function roadText(assistance: unknown, agency?: unknown): string {
  const a = String(assistance ?? "none");
  if (a === "senior") return "Senior citizen — 20% off, no VAT";
  if (a === "pwd") return "PWD — 20% off, no VAT";
  if (a === "gl") {
    const code = String(agency ?? "").trim();
    return `GL — ${code ? (AGENCY_SHORT[code] ?? code.toUpperCase()) : "agency not chosen"}`;
  }
  return "Regular — no discount";
}

// ── The journey chart's stops ────────────────────────────────────────────

export type JourneyStopKey =
  | "enquiry"
  | "talk"
  | "quote"
  | "apply"
  | "docs"
  | "rx"
  | "verified"
  | "order"
  | "packed"
  | "pickup"
  | "photo"
  | "claim"
  | "paid";

export type JourneyStop = {
  key: JourneyStopKey;
  label: string;
  state: "done" | "current" | "todo";
  /** On this case's road (the chart draws the other roads' stops faint; the website shows only these). */
  onRoad: boolean;
};

type Rec = Record<string, unknown>;
export type JourneyFacts = {
  lead: Rec;
  rx: Rec | null;
  gl: Rec | null;
  order: Rec | null;
  /** Document kinds approved on the case or its order (an OSCA ID, the pick-up photo…). */
  approved: Iterable<string>;
};

/** The card's own start: an enquiry, an order a website sent, a repeat order. */
export const START_LABEL: Record<string, string> = {
  enquiry: "Inquiry",
  website_order: "Website order",
  repeat_order: "Repeat order",
};

const LETTER_IN = ["verified", "billed", "paid", "disputed", "closed"];
const CLAIMED = ["billed", "paid", "disputed", "closed"];

/**
 * The case's journey: every stop the chart draws, in the order it draws them,
 * done or not from the saved records, and the one current stop from the saved
 * `road_step` (never guessed from what exists). A lost case has none current.
 * The papers come first (Aryan, 27 Nov: "the documents are checked first of
 * all"): the enquiry, then the prescription (and the senior / PWD ID on that
 * road), then the quotation; a guarantee letter's application and letter after
 * the quotation, which rides with the application.
 */
export function journeyStops({ lead, rx, gl, order, approved }: JourneyFacts): JourneyStop[] {
  const kinds = new Set(approved);
  const s = String(lead.state ?? "new");
  const lost = s === "lost";
  const road = roadOf(lead.assistance);
  const quoted = !quotationStale(lead) && Boolean(String(lead.quote ?? "").trim());
  // A saved quotation means the steps before it are behind us, whatever the stage
  // says: a website order arrives at "new" with its quotation already saved.
  const talked = quoted || ["replied", "quoted", "docs", "ordered"].includes(s);
  // Over-the-counter only (or a business order): the rules say no Rx is needed.
  const rxNotNeeded = lead.rx_needed === false;
  const rxDone = rxNotNeeded || (rx !== null && ["approved", "ordered"].includes(String(rx.state)));
  const glState = gl ? String(gl.state) : "";
  const glDone = LETTER_IN.includes(glState);
  const oState = order ? String(order.state) : null;
  // One ID for senior citizens and PWDs (18 Nov): either card.
  const docsApproved = kinds.has("osca_id") || kinds.has("pwd_id");
  const delivered = oState === "delivered";
  // Packing is optional: an order shipped or delivered without the step went out packed.
  const packed =
    oState !== null &&
    oState !== "cancelled" &&
    (Boolean(order?.packed_at) || oState === "shipped" || delivered);
  const claimed = CLAIMED.includes(glState);
  const settled = road === "gl" ? ["paid", "closed"].includes(glState) : lead.road_step === "done";
  // The GL claim after the hand-over: the photo sent to the agency (a claim
  // billed before this was recorded counts as sent), then the claim, then paid.
  const photoSent = Boolean(gl?.claim_sent_on) || claimed;
  const quoteSent = quoted && Boolean(lead.quote_sent_via);
  const caseType = String(lead.case_type ?? "enquiry");

  const stop = (key: JourneyStopKey, label: string, done: boolean, onRoad = true): JourneyStop => ({
    key,
    label,
    state: done ? "done" : "todo",
    onRoad,
  });
  const stops: JourneyStop[] = [
    stop("enquiry", START_LABEL[caseType] ?? "Inquiry", talked),
    // The prescription on the regular road and a guarantee letter's (the agency asks for it too).
    stop("rx", "Rx verification", rxDone, road !== "discount"),
    stop(
      "docs",
      `Senior / PWD ID${rxNotNeeded ? "" : " & Rx"}`,
      road === "discount" && docsApproved && rxDone,
      road === "discount",
    ),
    stop("talk", "Quotation in progress", talked),
    stop("quote", quoteSent ? "Quotation sent" : quoted ? "Quotation saved" : "Quotation", quoted),
    // "Applied" once the application is on record; until then, still to do.
    stop("apply", gl ? "Applied" : "Application", road === "gl" && Boolean(gl), road === "gl"),
    stop("verified", "Letter approved", glDone, road === "gl"),
    stop("order", "Order", Boolean(order) && oState !== "cancelled"),
    stop("packed", "Packed", packed),
    stop("pickup", "Delivered", delivered),
    ...(road === "gl"
      ? [stop("photo", "Photo sent", photoSent), stop("claim", "Claim", claimed)]
      : []),
    stop("paid", "Paid", settled),
  ];
  if (lost) return stops;

  // The current stop: the one the saved road step stands at, on this road.
  const roadStep = String(lead.road_step || s);
  const at = (key: string) => stops.find((x) => x.key === key);
  // The papers stop on this road; once its papers are in, the stop after the quotation the case
  // waits at (a letter's application or the letter, else the order).
  const papersStop = road === "discount" ? "docs" : "rx";
  const verification =
    at(papersStop)?.state !== "done"
      ? papersStop
      : road === "gl"
        ? (["apply", "verified"].find((k) => at(k)?.state !== "done") ?? "order")
        : "order";
  const { stop: position } = roadStepPosition(roadStep, s);
  const current =
    // The claim step: the photo first, the claim once the photo went to the agency.
    position === "photo"
      ? road === "gl" && photoSent
        ? "claim"
        : "photo"
      : // An order out for delivery: packed first, then delivered.
        position === "pickup"
        ? packed
          ? "pickup"
          : "packed"
        : position !== "verification"
          ? position
          : verification;
  const now = current ? at(current) : undefined;
  if (now && now.state !== "done") now.state = "current";
  return stops;
}
