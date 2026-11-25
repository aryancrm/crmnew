// The field's words and shapes (docs/PLAN.md 22, docs/FIELD-CHECKLIST.md): SEFMED's work inside the
// MedRep's own pages, every list an MR picks from in the words GetMeds used in SEFMED, and what the
// pages carry. Shared by the API (to check) and the screens (to show); nothing here touches the
// database.

/** How a person stands in the field: works their own day (an MR), leads a team (and works their
 *  own calls), or reads everyone's (the CEO, Management, the Admin). */
export type MrAccess = "mr" | "lead" | "viewer";

/** Where the day's work is (SEFMED's work place). "Return to HQ" is a change of place to `hq`. */
export type WorkType = "hq" | "ex_station" | "out_station" | "transit" | "other";
export const WORK_TYPES: WorkType[] = ["hq", "ex_station", "out_station", "transit", "other"];
export const WORK_WORDS: Record<WorkType, string> = {
  hq: "Head quarter",
  ex_station: "Ex-station",
  out_station: "Out-station",
  transit: "In transit",
  other: "Other",
};
/** The same in a MedRep's own words (the question "Where do you work today?"). */
export const WORK_HINTS: Record<WorkType, string> = {
  hq: "In my own base town",
  ex_station: "Another town, back home tonight",
  out_station: "Away from home, staying the night",
  transit: "Travelling today, no visits",
  other: "Something else (office, meeting, training)",
};
/** A town as people type it, made one: "City of Makati", "Makati City", "Makati, Metro Manila" → "makati". */
export const townKey = (name: string) =>
  (name.split(",")[0] ?? "")
    .trim()
    .toLowerCase()
    .replace(/^city of\s+/, "")
    .replace(/\s+city$/, "")
    .replace(/\s+/g, " ");

/** SEFMED's three kinds of client, as the CRM's customers: KOLs (doctors), hospitals and KBLs
 *  (firms: drugstores and distributors). */
export type ClientKind = "doctor" | "hospital" | "firm";
export const clientKindOf = (customerKind: string): ClientKind | null =>
  customerKind === "doctor" ? "doctor" : customerKind === "hospital" ? "hospital" : customerKind === "drugstore" || customerKind === "distributor" ? "firm" : null;
export const CLIENT_KINDS: ClientKind[] = ["doctor", "hospital", "firm"];
export const KIND_TABS: Record<ClientKind, string> = { doctor: "KOLs", hospital: "Hospitals", firm: "KBLs" };
export const KIND_ONE: Record<ClientKind, string> = { doctor: "Doctor", hospital: "Hospital", firm: "Firm" };
/** The tabs of a seller's one customer list (medrep branch, 25 Nov: "All my customers" and the
 *  field's KOLs, hospitals, KBLs were two lists of the same customers): every kind, the field's
 *  three, and the patients (a hospital's, a PAP officer's), which the field never visits. */
export type ClientTab = "all" | ClientKind | "patient";
export const CLIENT_TABS: ClientTab[] = ["all", "hospital", "doctor", "firm", "patient"];
export const TAB_WORDS: Record<ClientTab, string> = { all: "All", ...KIND_TABS, patient: "Patients" };

export type FirmType = "super_stockist" | "distributor" | "sub_distributor" | "stockist" | "retailer";
export const FIRM_TYPES: FirmType[] = ["super_stockist", "distributor", "sub_distributor", "stockist", "retailer"];
export const FIRM_WORDS: Record<FirmType, string> = {
  super_stockist: "Super stockist",
  distributor: "Distributor",
  sub_distributor: "Sub-distributor",
  stockist: "Stockist",
  retailer: "Retailer",
};
export const HOSPITAL_TYPE_WORDS = { government: "Government", private: "Private" } as const;
export const HOSPITAL_CLASS_WORDS = { general: "General", specialty: "Specialty" } as const;
export const CATEGORIES = ["A", "B", "C", "D", "E"] as const;
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_WORDS: Record<(typeof DAYS)[number], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** What a call is for: GetMeds' two from SEFMED first, then Aryan's list (20 Nov). */
export const OBJECTIVES = [
  "business_call",
  "thank_you_call",
  "new_product",
  "promotion",
  "prescription",
  "existing_product",
  "product_feedback",
  "samples",
  "order",
  "business_development",
  "relationship",
  "payment",
  "complaint",
  "other",
] as const;
export type Objective = (typeof OBJECTIVES)[number];
export const OBJECTIVE_WORDS: Record<Objective, string> = {
  business_call: "Business call",
  thank_you_call: "Thank you call",
  new_product: "New product introduction",
  promotion: "Product promotion",
  prescription: "Prescription generation",
  existing_product: "Existing product discussion",
  product_feedback: "Product feedback",
  samples: "Sample distribution",
  order: "Order collection",
  business_development: "Business development",
  relationship: "Relationship building",
  payment: "Payment follow-up",
  complaint: "Complaint resolution",
  other: "Other",
};

export type Meeting = "met" | "not_met" | "unavailable" | "cancelled";
export const MEETINGS: Meeting[] = ["met", "not_met", "unavailable", "cancelled"];
export const MEETING_WORDS: Record<Meeting, string> = {
  met: "Met",
  not_met: "Not met",
  unavailable: "Unavailable",
  cancelled: "Appointment cancelled",
};
export type Nature = "promotional" | "business" | "both";
export const NATURES: Nature[] = ["promotional", "business", "both"];
export const NATURE_WORDS: Record<Nature, string> = {
  promotional: "Promotional",
  business: "Business",
  both: "Both",
};
export type Outcome = "business" | "opportunity" | "follow_up" | "none";
export const OUTCOMES: Outcome[] = ["business", "opportunity", "follow_up", "none"];
export const OUTCOME_WORDS: Record<Outcome, string> = {
  business: "Business generated",
  opportunity: "Business opportunity",
  follow_up: "Follow-up required",
  none: "No business",
};
/** Said by the MR, never worked out (a meeting without an order may be productive); "pending"
 *  waits for the team lead. */
export type Productive = "yes" | "no" | "pending";
export const PRODUCTIVES: Productive[] = ["yes", "no", "pending"];
export const PRODUCTIVE_WORDS: Record<Productive, string> = {
  yes: "Productive",
  no: "Not productive",
  pending: "Not sure yet",
};
export type Reaction = "will_prescribe" | "prescribes" | "needs_info" | "not_interested";
export const REACTIONS: Reaction[] = ["will_prescribe", "prescribes", "needs_info", "not_interested"];
export const REACTION_WORDS: Record<Reaction, string> = {
  will_prescribe: "Will prescribe",
  prescribes: "Already prescribes",
  needs_info: "Wants more information",
  not_interested: "Not interested",
};
export type Demand = "high" | "normal" | "low";
export const DEMAND_WORDS: Record<Demand, string> = { high: "High", normal: "Normal", low: "Low" };

export type FollowUpKind = "visit" | "order" | "payment" | "product" | "opportunity" | "other";
export const FOLLOW_UP_KINDS: FollowUpKind[] = ["visit", "order", "payment", "product", "opportunity", "other"];
export const FOLLOW_UP_WORDS: Record<FollowUpKind, string> = {
  visit: "Visit again",
  order: "Order",
  payment: "Payment",
  product: "Product discussion",
  opportunity: "Business opportunity",
  other: "Other",
};

/** Why a planned visit didn't happen: GetMeds' SEFMED reasons, and two of the CRM's. */
export type MissReason = "out_of_town" | "not_available" | "busy" | "closed" | "rescheduled" | "other";
export const MISS_REASONS: MissReason[] = ["out_of_town", "not_available", "busy", "closed", "rescheduled", "other"];
export const MISS_WORDS: Record<MissReason, string> = {
  out_of_town: "Out of town",
  not_available: "Not available",
  busy: "Busy",
  closed: "Clinic / office closed",
  rescheduled: "Moved to another day",
  other: "Others",
};

export type VisitStatus = "planned" | "done" | "skipped" | "missed";
/** A visit as the list shows it: New (not checked in), At the place, Closed, Skipped, Missed. */
export const STATE_WORDS = {
  new: "New",
  at: "At the place",
  closed: "Closed",
  skipped: "Skipped",
  missed: "Missed",
} as const;
export type VisitState = keyof typeof STATE_WORDS;
export const stateOf = (visit: { status: VisitStatus; checkedInAt: string | null }): VisitState =>
  visit.status === "done"
    ? "closed"
    : visit.status === "skipped"
      ? "skipped"
      : visit.status === "missed"
        ? "missed"
        : visit.checkedInAt
          ? "at"
          : "new";

export type ClientCard = {
  id: number;
  kind: ClientKind;
  /** The CRM customer's own kind (drugstore, distributor…). */
  customerKind: string;
  code: string | null;
  name: string;
  specialty: string | null;
  category: string | null;
  city: string | null;
  zone: string | null;
  /** A hospital's Government / Private, a firm's type, a doctor's hospital. */
  detail: string | null;
  pinned: boolean;
  prefDays: string[];
  prefTime: string | null;
  assignedTo: { id: number; name: string } | null;
};

export type VisitCard = {
  id: number;
  day: string;
  status: VisitStatus;
  checkedInAt: string | null;
  doneAt: string | null;
  person: { id: number; name: string };
  client: ClientCard;
  objectives: string[];
  priority: number | null;
  unplanned: boolean;
  meeting: Meeting | null;
  outcome: Outcome | null;
  productive: Productive | null;
  nature: Nature | null;
  skipReason: string | null;
  distanceM: number | null;
  /** Orders booked at this visit (centavos). */
  booked: number;
};

export type DayEvent = {
  at: string;
  kind: "start" | "place" | "break" | "resume" | "stop";
  workType: WorkType | null;
  cities: string[] | null;
  note: string | null;
  place: string | null;
};

export type DayState = {
  day: string;
  workType: WorkType;
  workNote: string | null;
  cities: string[];
  workingWith: { id: number; name: string }[];
  startedAt: string;
  startPlace: string | null;
  endedAt: string | null;
  endPlace: string | null;
  onBreak: boolean;
  breakSince: string | null;
  breakMinutes: number;
  events: DayEvent[];
  report: {
    status: "open" | "sent" | "seen";
    note: string | null;
    sentAt: string | null;
    seenBy: string | null;
    seenAt: string | null;
    seenNote: string | null;
  };
};

/** How the field stands for this person, and whom they report to. */
export type MrMe = {
  access: MrAccess | null;
  lead: { id: number; name: string } | null;
};

/** The MR's Home (SEFMED's dashboard): the day's circle, today's numbers, the next visit. */
export type MrHome = {
  today: string;
  person: { id: number; name: string };
  day: DayState | null;
  /** Today's cities from the tour plan, else from the day's planned visits. */
  plannedCities: string[];
  plannedWork: WorkType | null;
  /** Cities the MR's clients are in (to pick the day's). */
  cities: string[];
  partners: { id: number; name: string }[];
  counts: {
    planned: number;
    open: number;
    done: number;
    skipped: number;
    missed: number;
    met: number;
    productive: number;
    booked: number;
    bookedAmount: number;
  };
  next: VisitCard | null;
  /** Today's visits, every kind together: the one being worked first, then those still to go, then the rest. */
  visits: VisitCard[];
  tiles: { doctors: number; hospitals: number; firms: number; followUpsDue: number; claimed: number };
  can: { work: boolean };
};

export type CallProduct = {
  medicineId: number;
  name?: string;
  promoted: boolean;
  reaction: Reaction | null;
  prescribing?: boolean | null;
  competitor?: string | null;
  inStock?: boolean | null;
  stock?: number | null;
  sold?: number | null;
  demand?: Demand | null;
};

export type CallDetails = {
  met?: string[];
  pharmacy?: string | null;
  purchasing?: string | null;
  institutional?: string | null;
  chemist?: string | null;
  money?: string | null;
  market?: string | null;
  competitors?: string | null;
};

export type CloseCallInput = {
  meeting: Meeting;
  objectives: string[];
  objectiveNote?: string | null;
  products: CallProduct[];
  prescribing?: { medicineId: number; prescribing: boolean; top5: boolean }[] | null;
  call?: CallDetails | null;
  nature?: Nature | null;
  outcome: Outcome;
  productive: Productive;
  feedback?: string | null;
  notes?: string | null;
  chanceAmount?: number | null;
  chanceOn?: string | null;
  followUp?: { on: string; kind: FollowUpKind; what: string } | null;
  nextDay?: string | null;
  place?: string | null;
};

/** A CRM order on a field page: placed at a visit, or the customer's latest. */
export type FieldOrder = { id: number; code: string | null; on: string; total: number; status: string; statusWord: string; by: string };

export type VisitPage = {
  visit: VisitCard & {
    objectiveNote: string | null;
    checkInPlace: string | null;
    closedPlace: string | null;
    closedDistanceM: number | null;
    notes: string | null;
    feedback: string | null;
    chanceAmount: number | null;
    chanceOn: string | null;
    nextDay: string | null;
    addedWhy: string | null;
    call: CallDetails;
    products: CallProduct[];
    workingWith: { id: number; name: string }[];
    judged: { by: string; at: string; note: string | null } | null;
    files: { id: number; name: string; mime: string }[];
    changes: { what: string; fromDay: string | null; toDay: string | null; note: string | null; by: string; at: string }[];
  };
  client: ClientCard & {
    address: string | null;
    phone: string | null;
    contactPerson: string | null;
    pin: string | null;
    worksAt: { id: number; name: string } | null;
  };
  /** The last five visits to this client, by anyone (SEFMED's View last five visits). */
  history: {
    id: number;
    day: string;
    person: string;
    status: VisitStatus;
    checkedInAt: string | null;
    doneAt: string | null;
    objectives: string[];
    objectiveNote: string | null;
    meeting: Meeting | null;
    outcome: Outcome | null;
    feedback: string | null;
    notes: string | null;
  }[];
  /** The customer's latest CRM orders, and what it owes (from Finance's dues). */
  orders: FieldOrder[];
  owed: { total: number; overdue: number };
  followUps: { id: number; dueOn: string; kind: FollowUpKind; what: string; by: string }[];
  prescribing: { medicineId: number; name: string; prescribing: boolean; top5: boolean }[];
  medicines: { id: number; name: string; strength: string | null }[];
  /** The CRM orders placed at this visit (the call's business). */
  placed: FieldOrder[];
  /** Samples and gifts given at this visit (the samples module), and what the MR holds. */
  samplesGiven: { medicineId: number; name: string; kind: "samples" | "gifts"; qty: number }[];
  samplesHeld: number;
  /** The call's form as typed before stepping out to place the order. */
  draft: Record<string, unknown> | null;
  partners: { id: number; name: string }[];
  can: {
    work: boolean;
    checkIn: boolean;
    close: boolean;
    skip: boolean;
    move: boolean;
    book: boolean;
    reopen: boolean;
    judge: boolean;
  };
};

export type VisitList = {
  today: string;
  person: { id: number; name: string } | null;
  kind: ClientKind;
  day: string | null;
  month: string | null;
  counts: Record<ClientKind, number>;
  states: Record<VisitState, number>;
  rows: VisitCard[];
  people: { id: number; name: string }[];
  can: { work: boolean };
};

export type DayReport = {
  day: string;
  today: string;
  person: { id: number; name: string };
  state: DayState | null;
  workedMinutes: number;
  visits: {
    planned: number;
    done: number;
    skipped: number;
    missed: number;
    open: number;
    unplanned: number;
    met: number;
    notMet: number;
    productive: number;
    notProductive: number;
    pending: number;
    promotional: number;
    business: number;
    both: number;
  };
  open: VisitCard[];
  closed: VisitCard[];
  notDone: VisitCard[];
  business: {
    booked: number;
    bookedAmount: number;
    chances: number;
    chanceAmount: number;
    followUpsMade: number;
    followUpsDue: number;
    samples: number;
  };
  expenses: { generated: number; claimed: number; lines: number };
  can: { send: boolean; see: boolean };
};

export type ClientList = {
  kind: ClientTab;
  scope: "mine" | "team";
  counts: { mine: number; team: number };
  rows: (ClientCard & {
    lastVisit: string | null;
    nextVisit: string | null;
    visitsThisMonth: number;
    /** A patient: the field never visits them (no visit, no field page: the CRM's customer page). */
    patient: boolean;
    /** The sales side, as the customer list has it: orders, the last one, what it owes. */
    orders: number;
    lastOrderAt: string | null;
    owed: number;
  })[];
  more: boolean;
  can: { add: boolean; team: boolean };
};

/** The field's own fields of a customer (SEFMED's KOL / hospital / firm fields). */
export type FieldProfile = {
  category: string | null;
  dispensing: boolean | null;
  qualification: string | null;
  gender: "male" | "female" | "other" | null;
  hospitalType: "government" | "private" | null;
  hospitalClass: "general" | "specialty" | null;
  firmType: FirmType | null;
  contactPerson: string | null;
  zone: string | null;
  prefDays: string[];
  prefTime: string | null;
  firmId: number | null;
  visitsAMonth: number | null;
};

export type ClientPage = {
  client: ClientCard &
    FieldProfile & {
      address: string | null;
      phone: string | null;
      email: string | null;
      licenceNo: string | null;
      pin: string | null;
      active: boolean;
      worksAtName: string | null;
      firmName: string | null;
      offList: boolean;
      offAsked: { by: string; at: string; why: string } | null;
    };
  history: VisitPage["history"];
  orders: FieldOrder[];
  owed: { total: number; overdue: number };
  calls: number;
  can: { profile: boolean; category: boolean; visit: boolean; order: boolean; askOff: boolean; answerOff: boolean };
};

export type FollowUpRow = {
  id: number;
  dueOn: string;
  kind: FollowUpKind;
  what: string;
  status: "open" | "done" | "dropped";
  client: { id: number; name: string; kind: ClientKind };
  person: { id: number; name: string };
  visitId: number | null;
  doneAt: string | null;
  doneNote: string | null;
};

/** The team lead's Home: each MR today, and what waits for the lead. */
export type TeamToday = {
  day: string;
  today: string;
  people: {
    id: number;
    name: string;
    started: string | null;
    workType: WorkType | null;
    cities: string[];
    ended: string | null;
    onBreak: boolean;
    /** Visits of the tour plan, and all the day's visits (added on the day too). */
    planned: number;
    visits: number;
    done: number;
    skipped: number;
    missed: number;
    open: number;
    productive: number;
    booked: number;
    bookedAmount: number;
    at: string | null;
    report: "open" | "sent" | "seen" | null;
  }[];
  totals: { people: number; started: number; planned: number; done: number; missed: number; bookedAmount: number; reportsToSee: number };
  waiting: { reports: number; judge: number; plans: number; deviations: number; expenses: number };
  /** SEFMED's dashboard: the app's clients, closed calls today / this week / this month, the
   *  Call Champion (most calls closed today), and the field's activity today. */
  clients: { doctors: number; hospitals: number; firms: number };
  closed: { today: number; week: number; month: number };
  champions: { id: number; name: string; closed: number }[];
  feed: { at: string; name: string; what: "checked_in" | "closed"; client: string; visitId: number; meeting: Meeting | null; booked: number }[];
};

export type LeadQueue = {
  reports: { personId: number; name: string; day: string; sentAt: string; done: number; missed: number }[];
  judge: (VisitCard & { feedback: string | null })[];
};

// ---- Tour plan ----

export type PlanStatus = "draft" | "sent" | "approved" | "sent_back";
export const PLAN_WORDS: Record<PlanStatus, string> = {
  draft: "Not sent yet",
  sent: "With the team lead",
  approved: "Approved",
  sent_back: "Sent back",
};

export type PlanMonth = {
  month: string;
  today: string;
  person: { id: number; name: string };
  plan: { status: PlanStatus | null; revision: number; sentAt: string | null; decidedBy: string | null; decidedAt: string | null; note: string | null };
  days: {
    day: string;
    work: boolean;
    holiday: string | null;
    leave: "approved" | "asked" | "refused" | null;
    plan: { workType: WorkType; cities: string[]; workingWith: { id: number; name: string }[]; note: string | null } | null;
    planned: number;
    done: number;
    backDated: number;
  }[];
  cities: string[];
  revisions: { revision: number; status: "approved" | "sent_back"; by: string; at: string; note: string | null; visits: number }[];
  deviations: DeviationRow[];
  can: { edit: boolean; send: boolean; decide: boolean };
};

export type DeviationRow = {
  id: number;
  person: { id: number; name: string };
  day: string;
  kind: "moved" | "added" | "dropped" | "place";
  visitId: number | null;
  client: string | null;
  fromDay: string | null;
  toDay: string | null;
  note: string;
  status: "waiting" | "approved" | "rejected";
  decidedBy: string | null;
  decisionNote: string | null;
  madeAt: string;
};
export const DEVIATION_WORDS = {
  moved: "Visit moved",
  added: "Visit added",
  dropped: "Visit dropped",
  place: "Work place changed",
} as const;

// ---- Expenses ----

export type ExpenseHead = { code: string; name: string; allowance: "per_diem" | "ta" | null; needsBill: boolean; active: boolean };
/** open: a day's allowance not claimed yet; pending: claimed, with the lead; sent_back: rejected
 *  with why (put right, it waits again). */
export type ExpenseStatus = "open" | "pending" | "approved" | "sent_back";
export const EXPENSE_STATUS_WORDS: Record<ExpenseStatus, string> = {
  open: "Not claimed",
  pending: "Claimed",
  approved: "Approved",
  sent_back: "Rejected",
};
export type ExpenseRow = {
  id: number;
  person: { id: number; name: string };
  day: string;
  head: string;
  headName: string;
  auto: boolean;
  generated: number;
  claimed: number;
  approved: number | null;
  note: string | null;
  hasFile: boolean;
  status: ExpenseStatus;
  decidedBy: string | null;
  decisionNote: string | null;
};
export type ExpenseMonth = {
  month: string;
  today: string;
  person: { id: number; name: string } | null;
  heads: ExpenseHead[];
  rows: ExpenseRow[];
  totals: { generated: number; claimed: number; approved: number; waiting: number };
  people: { id: number; name: string }[];
  allowances: { workType: WorkType; perDiem: number; ta: number }[];
  can: { add: boolean; decide: boolean; setRates: boolean };
};
