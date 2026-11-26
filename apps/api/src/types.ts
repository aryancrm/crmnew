// What the API sends and takes. The web app imports these types, so the two can't drift.

import type { CompanyCode } from "./companies";
import type { Role } from "./people/roles";

export type { Role } from "./people/roles";

/** The signed-in person, as every screen needs them. */
/** Management's or Finance's common screen: each of the desk's people, started today or not, what
 *  each has open and has done today, and what is waiting (and not given to anyone started). */
export type DeskDuty = {
  desk: "management" | "finance" | "dispatch";
  people: { id: number; name: string; title: string | null; startedAt: string | null; open: number; doneToday: number }[];
  /** May press Start / Stop here (the desk's accounts and the Admin; the CEO only looks). */
  canStart: boolean;
  waiting: number;
  unassigned: number;
};

/** Each of the desk's people over some days: hours started, given and taken, what they did with
 *  the orders they moved on, how long each took them (working minutes), late, open now. */
export type DeskReport = {
  desk: "management" | "finance" | "dispatch";
  from: string;
  to: string;
  /** The desk's limit in working minutes (Management 4 hours, Finance a working day). */
  limitMinutes: number;
  people: {
    id: number;
    name: string;
    hours: number;
    given: number;
    took: number;
    /** Approved (Management) or let go to Dispatch (Finance). */
    done: number;
    sentBack: number;
    held: number;
    rejected: number;
    medianMinutes: number | null;
    late: number;
    open: number;
  }[];
};

/** One of the desk's people over some days: their figures, what they have now, what they did. */
export type DeskPerson = {
  desk: "management" | "finance" | "dispatch";
  from: string;
  to: string;
  limitMinutes: number;
  person: { id: number; name: string; title: string | null; startedAt: string | null };
  figures: DeskReport["people"][number];
  open: { id: number; code: string; customer: string; total: number; status: string; since: string }[];
  /** Each order they moved on: approved / checked (done), sent back, held, rejected. */
  done: {
    id: number;
    code: string;
    customer: string;
    total: number;
    outcome: "done" | "sent_back" | "held" | "rejected" | "moved";
    at: string;
    minutes: number;
  }[];
};

/** One unit of a department's team on the portal: its lead seat and its seats by title (no names). */
export type PortalTeamNode = {
  unit: string;
  kind: string;
  lead: { title: string; module: string; filled: boolean } | null;
  members: { title: string; module: string; seats: number; people: number }[];
  children: PortalTeamNode[];
};

/** A department's page on the portal, before signing in: counts and times of the last 30 days. */
export type PortalDepartment = {
  key: string;
  stats: { label: string; value: number | null; unit: "count" | "minutes" | "days"; hint: string }[];
  team: PortalTeamNode | null;
  /** People in the department's seats today. */
  people: number;
  at: string;
};

export type Me = {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  role: Role;
  roleLabel: string;
  mustChangePassword: boolean;
  /** The picture shown for them (/api/people/<id>/photo/<photo>), if they put one. */
  photo?: number | null;
  /** Two-step sign-in is on. */
  twoStep?: boolean;
  /** Their channel, and the Division its orders carry (set in the Admin panel). */
  channel: { code: string; name: string; division: string | null } | null;
  area: { id: number; name: string; cities: string[] } | null;
  reportsTo: { name: string; title: string | null } | null;
  /** The channel of the business box their seat sits in on the chart (HOSP for the Hospital
   *  Division, RX for the Prescription Business, B2B for Sales and Marketing…). Telesales inside the
   *  Hospital Division (anesthesia) and inside the Prescription Business (oncology) work differently. */
  business?: string | null;
  /** The Divisions their orders carry: one per seat (its box where it names one: CLIDP, URO, B&B;
   *  else its channel's), the main seat's first. One seat, one Division (Aryan, 19 Nov). */
  divisions?: string[];
  /** The CEO or Admin looking as this person (read only), when it is that. */
  viewedBy?: { id: number; name: string; role: string } | null;
  /** The department this session was opened for (the sign-in page it was made on). */
  workspace?: string | null;
  /** The box picked on a lead's team switch for this request (?unit=, checked): the page counts the
   *  seats in it and under it (org/scope.ts). */
  unit?: number | null;
};

// ---- Inventory. Money is whole centavos; days are "YYYY-MM-DD" (Manila); times are ISO. ----

export type BuyerType = "patient" | "hospital" | "doctor" | "distributor" | "drugstore" | "bidding";
export type Vat = "exempt" | "vat12" | "zero";
export type StockStatus = "ok" | "low" | "out";
export type NewsKind = "out" | "low" | "back" | "note";

export type Warehouse = { id: number; code: string; name: string };

/** What the person may do in Inventory. Everyone may look. */
export type InventoryCan = {
  stock: boolean;
  catalogue: boolean;
  price: boolean;
  purchase: boolean;
  cost: boolean;
};

export type StockNews = {
  id: number;
  medicineId: number;
  medicine: string;
  kind: NewsKind;
  message: string | null;
  by: string;
  at: string;
};

export type MedicineRow = {
  id: number;
  code: string;
  name: string;
  strength: string | null;
  pack: string | null;
  /** What one piece is called (tablet, vial) and how many a pack holds. */
  unit: string | null;
  packSize: number;
  rx: boolean;
  reorderLevel: number;
  /** Sellable pieces (batches not expired) per warehouse id. */
  stock: Record<number, number>;
  /** Sellable pieces in all warehouses. */
  total: number;
  /** Of them, promised to placed orders not packed yet (and on how many orders). */
  promised: number;
  promisedOrders: number;
  /** Sellable and not promised: what a new order can still have. */
  free: number;
  /** Pieces in expired batches still on the shelf. */
  expired: number;
  coming: { qty: number; on: string } | null;
  nearestExpiry: string | null;
  /** A sellable batch expires within 90 days. */
  expiringSoon: boolean;
  status: StockStatus;
};

export type InventoryList = {
  can: InventoryCan;
  today: string;
  warehouses: Warehouse[];
  summary: { medicines: number; out: number; low: number; expiring: number };
  medicines: MedicineRow[];
  news: StockNews[];
};

/** One medicine with everything known about it, for the "All medicines" list. */
export type CatalogueRow = MedicineInput & {
  id: number;
  code: string;
  packSize: number;
  /** The price of ONE piece, per kind of buyer. */
  prices: Partial<Record<BuyerType, number>>;
  /** The price of a whole pack where one was set; otherwise a pack is its pieces added up. */
  packPrices: Partial<Record<BuyerType, number>>;
  /** The promo running today, if any. */
  promo: { name: string; amount: number; endsOn: string } | null;
  /** The offers running today (Buy X Take Y, a special price), each for a kind of buyer or all. */
  offers: CatalogueOffer[];
  /** Sellable pieces in all warehouses. */
  total: number;
  /** Of it, promised to placed orders not packed yet; and what is still free to sell. */
  promised: number;
  free: number;
  status: StockStatus;
  /** Average landed cost of what is on the shelf (centavos). Null when not known or not yours to see. */
  cost: number | null;
};

/** An offer on a medicine (the hub's Buy 1 Take 1, the Christmas offers file). */
export type CatalogueOffer = {
  id: number;
  /** The customer kind it is for; null: every buyer. */
  buyerKind: CustomerKind | null;
  buy: number;
  take: number;
  /** Centavos per piece bought while it runs; null: the buyer's own price. */
  price: number | null;
  name: string;
  /** None: it runs until someone ends it. */
  endsOn: string | null;
};

export type MedicineOffer = CatalogueOffer & {
  buyerLabel: string;
  note: string | null;
  startsOn: string;
  state: "now" | "later" | "ended";
  by: string;
};

export type OfferInput = {
  buyerKind: CustomerKind | null;
  buy: number;
  take: number;
  price: number | null;
  name?: string | null;
  note?: string | null;
  startsOn: string;
  endsOn?: string | null;
};

export type Catalogue = {
  can: InventoryCan;
  today: string;
  buyerTypes: { key: BuyerType; label: string }[];
  categories: string[];
  rows: CatalogueRow[];
};

export type MedicineInput = {
  name: string;
  /** The company's own item code, like GM-4524. */
  sku?: string | null;
  /** The molecule. */
  generic?: string | null;
  strength?: string | null;
  form?: string | null;
  /** What the pack is called: "Box of 30". */
  pack?: string | null;
  /** What ONE piece is called: tablet, capsule, vial. Stock, costs and prices are per piece. */
  unit?: string | null;
  /** Pieces in a pack. 1 when it is sold only whole (a vial). */
  packSize?: number;
  category?: string | null;
  manufacturer?: string | null;
  /** Which of our brands it is sold under. */
  brand?: string | null;
  rx: boolean;
  vat: Vat;
  reorderLevel: number;
  /** Kept cold from the shelf to the customer (the list's "[COLD CHAIN]"): Dispatch packs it cold. */
  coldChain?: boolean;
  /** A cold-chain box (a styro box): kept in stock, priced by Management on each order. */
  coldBox?: boolean;
  /** Never given as a sample (antimicrobials and the like); gifts may still be any item. */
  noSamples?: boolean;
};

export type MedicineDetail = {
  can: InventoryCan;
  today: string;
  warehouses: Warehouse[];
  buyerTypes: { key: BuyerType; label: string }[];
  medicine: MedicineInput & { id: number; code: string; active: boolean; packSize: number };
  status: StockStatus;
  total: number;
  /** On placed orders not packed yet, and what is left free to sell (never under zero). */
  promised: number;
  promisedOrders: number;
  /** The orders holding it, oldest first (only for the desks that see every order). */
  promisedTo: { id: number; code: string; customer: string; qty: number; status: OrderStatus; placedOn: string }[];
  free: number;
  expired: number;
  batches: {
    batchId: number;
    batchNo: string;
    expiresOn: string;
    warehouseId: number;
    qty: number;
    state: "ok" | "soon" | "expired";
    /** What one piece of this batch cost to land (centavos). Null when not known or not yours to see. */
    unitCost: number | null;
  }[];
  /** Landed cost of what is on the shelf, per piece (centavos). Null for those who don't see costs. */
  cost: { min: number; max: number; average: number } | null;
  prices: Partial<Record<BuyerType, number>>;
  packPrices: Partial<Record<BuyerType, number>>;
  promos: {
    id: number;
    name: string;
    amount: number;
    startsOn: string;
    endsOn: string;
    state: "now" | "later" | "ended";
  }[];
  /** Its offers: running, coming and ended lately. */
  offers: MedicineOffer[];
  coming: ComingRow[];
  moves: {
    id: number;
    at: string;
    kind: string;
    qty: number;
    batchNo: string;
    warehouse: string;
    ref: string | null;
    note: string | null;
    by: string;
  }[];
  priceChanges: {
    id: number;
    at: string;
    what: string;
    old: number | null;
    new: number | null;
    by: string;
  }[];
  news: StockNews[];
  /** PCSO's quotations 2 and 3: the other vendors' price for one piece (empty: not set). */
  canvass: CanvassPrice[];
};

/** A case's own steps the customer hears of by email (Aryan, 26 Nov, as the old CRM). */
export type CaseMailEvent = "enquiry" | "quotation" | "gl_received" | "gl_verified";
/** Automatic emails on a case: off until the Admin switches them on, then each step its own. */
export type CaseMailSettings = { enabled: boolean; events: Record<CaseMailEvent, boolean> };

/** Another vendor's price for one piece of a medicine, for PCSO's quotation 2 or 3. Centavos. */
export type CanvassPrice = { slot: 2 | 3; vendor: string; amount: number };

/** One of PCSO's other quotations, filled from the medicines' canvass prices: the vendor, its total
 *  and its lines (each medicine at that vendor's price). Centavos. */
export type CanvassQuote = {
  vendor: string;
  amount: number;
  lines: { medicine: string; qty: number; price: number; total: number }[];
};

/** Stock on an open purchase, on its way. */
export type ComingRow = {
  purchaseId: number;
  code: string;
  /** Where the order opens: the purchase order in Purchases (Zoho's and those made here). */
  to: string;
  qty: number;
  warehouse: string;
  expectedOn: string;
  supplier: string;
  late: boolean;
};

// ---- Buying. Foreign prices are in the supplier's currency; everything else is centavos. ----

export type CostKind = "freight" | "packaging" | "customs" | "insurance" | "transport" | "other";
export type PurchaseState = "ordered" | "received" | "cancelled";

export type Supplier = {
  id: number;
  name: string;
  country: string | null;
  currency: string;
  contact: string | null;
  active: boolean;
};

export type PurchaseRow = {
  id: number;
  code: string;
  supplier: string;
  country: string | null;
  state: PurchaseState;
  orderedOn: string;
  expectedOn: string;
  late: boolean;
  /** "Anastrozole 1 mg × 200, …" */
  lines: string;
  /** Goods plus every other cost, in centavos. */
  total: number;
};

export type PurchaseList = { can: InventoryCan; today: string; rows: PurchaseRow[] };

/** What the purchase form needs to offer. */
export type PurchaseChoices = {
  suppliers: Supplier[];
  warehouses: Warehouse[];
  medicines: {
    id: number;
    name: string;
    strength: string | null;
    pack: string | null;
    unit: string | null;
    packSize: number;
  }[];
};

export type PurchaseInput = {
  supplierId: number;
  warehouseId: number;
  orderedOn: string;
  expectedOn: string;
  currency: string;
  /** Pesos for one unit of the currency. */
  fxRate: number;
  supplierRef?: string | null;
  note?: string | null;
  lines: { medicineId: number; qty: number; unitCost: number }[];
  costs: { kind: CostKind; amount: number; note?: string | null }[];
};

export type PurchaseDetail = {
  can: InventoryCan;
  today: string;
  choices: PurchaseChoices;
  purchase: {
    id: number;
    code: string;
    state: PurchaseState;
    supplierId: number;
    supplier: string;
    country: string | null;
    warehouseId: number;
    warehouse: string;
    orderedOn: string;
    expectedOn: string;
    late: boolean;
    currency: string;
    fxRate: number;
    supplierRef: string | null;
    note: string | null;
    goodsTotal: number;
    extrasTotal: number;
    createdBy: string;
    receivedBy: string | null;
    receivedAt: string | null;
  };
  lines: {
    id: number;
    medicineId: number;
    medicine: string;
    qty: number;
    unitCost: number;
    receivedQty: number | null;
    batchNo: string | null;
    expiresOn: string | null;
    goods: number;
    extras: number;
    landedUnit: number;
  }[];
  costs: { kind: CostKind; amount: number; note: string | null }[];
};

/**
 * Every refusal has this shape. `field` names the input that is wrong, when one is; `fields`
 * names every wrong input with its message when a form has several.
 */
export type ApiError = {
  error: { code: string; message: string; field?: string; fields?: Record<string, string> };
};

// ---- Customers: hospitals, doctors, patients and business buyers. ----

export type CustomerKind =
  | "hospital"
  | "doctor"
  | "patient"
  | "drugstore"
  | "distributor"
  | "government";
export type PaymentTerms = "advance" | "cod" | "days";

/** What the person may do with customers. What they may SEE is decided by the API. */
export type CustomerCan = {
  /** Add a customer, and change the contact details of one they can see. */
  add: boolean;
  /** Change the area, the payment terms and the credit limit, and mark a new customer reviewed. */
  manage: boolean;
  /** Change only the payment terms and the credit limit (Finance too). */
  credit: boolean;
};

export type CustomerRow = {
  id: number;
  code: string;
  kind: CustomerKind;
  name: string;
  phone: string | null;
  city: string | null;
  area: string | null;
  /** Who holds the customer's area today. */
  medrep: string | null;
  specialty: string | null;
  worksAt: string | null;
  review: "ok" | "to_review";
  /** Whom the MedRep reports to. */
  manager: string | null;
  /** Who works the patient's latest enquiry at the Online desk. */
  deskOwner: string | null;
  orders: number;
  lastOrderAt: string | null;
  /** Open invoices not paid (cash on delivery once delivered), centavos. */
  owed: number;
  /** Of it, past its due day. */
  overdue: number;
  creditLimit: number | null;
};

export type CustomerList = {
  can: CustomerCan;
  kinds: { key: CustomerKind; label: string; plural: string }[];
  /** How many customers of each kind this person can see. */
  counts: Partial<Record<CustomerKind, number>>;
  total: number;
  page: number;
  pageSize: number;
  rows: CustomerRow[];
  /** Who looks after the customers listed (every filter but the MedRep), the most first. */
  byRep: { id: number; name: string; channel: string | null; area: string | null; count: number }[];
  /** Listed customers nobody looks after yet. */
  unassigned: number;
  /** The kind's customers as a whole (not narrowed by the search). */
  summary: { all: number; toCheck: number; orderedThisMonth: number; neverOrdered: number };
};

export type CustomerInput = {
  kind: CustomerKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  specialty?: string | null;
  worksAt?: number | null;
  licenceNo?: string | null;
  licenceExpires?: string | null;
  /** The licence to operate as Zoho kept it: who holds it, what it is for, the day it was issued. */
  licenceOwner?: string | null;
  ltoType?: string | null;
  licenceIssued?: string | null;
  tin?: string | null;
  note?: string | null;
  /** Only those who manage customers set these; from anyone else they are ignored. */
  areaId?: number | null;
  paymentTerms?: PaymentTerms;
  paymentDays?: number | null;
  creditLimit?: number | null;
};

/** A business customer's paper (the hub asked a hospital for all three). */
export type CustomerPaperKind = "bir_2303" | "lto_permit" | "business_permit";
export type CustomerPaper = {
  id: number;
  kind: CustomerPaperKind;
  kindLabel: string;
  name: string;
  by: string;
  at: string;
};

export type CustomerDetail = {
  can: CustomerCan;
  today: string;
  kinds: CustomerList["kinds"];
  areas: { id: number; name: string; channel: string }[];
  /** A hospital's, distributor's or drugstore's papers, and what of the hub's list is not there
   *  yet (the licence's details and the three papers): Management checks the customer with it. */
  papers: CustomerPaper[];
  missing: string[];
  customer: Required<Omit<CustomerInput, "worksAt">> & {
    id: number;
    code: string;
    worksAtId: number | null;
    worksAt: string | null;
    area: string | null;
    channel: string | null;
    medrep: string | null;
    review: "ok" | "to_review";
    reviewedBy: string | null;
    addedBy: string;
    addedAt: string;
    licenceState: "none" | "ok" | "soon" | "expired";
    /** The Manila day of the customer's last order, if any. */
    lastOrderOn: string | null;
    /** Whether it is in the asking MedRep's own area. */
    inMyArea: boolean;
    /** What they owe now (open invoices; cash on delivery once delivered), and of it past due. */
    owed: number;
    overdue: number;
    /** Days the oldest past-due invoice is late (0 when none). */
    overdueDays: number;
  };
  /** A hospital's doctors. */
  doctors: { id: number; name: string; specialty: string | null }[];
  /** What the customer's channel keeps on it (Aryan, 19 Nov: "as the MedRep picks, the relevant
   *  things come"): a hospital's accreditation with 2MG and our medicines on its formulary; an
   *  agency's or hospital's tenders won and not yet delivered by an order (an order may say which
   *  award it delivers); a pharmacy's agreed CLIDP prices; a chain's listings. Empty for a patient. */
  standing: {
    accreditation: { status: "applied" | "accredited" | "refused"; onDay: string; validUntil: string | null } | null;
    formulary: { approved: number; requested: number };
    /** `lines`: the bid, medicine by medicine (one piece's price in centavos, VAT in). */
    awards: { id: number; code: string; title: string; step: string; deliverBy: string | null; lines: { medicineId: number; qty: number; unitPrice: number }[] }[];
    clidpRates: { medicineId: number; medicine: string; unitPrice: number; moq: number | null; agreedOn: string }[];
    listed: number;
  };
};

/** A customer already on file that matches what is being typed: enough to recognise it, no more. */
export type CustomerMatch = {
  id: number;
  kind: CustomerKind;
  name: string;
  city: string | null;
  /** The phone with all but its last four digits hidden. */
  phone: string | null;
  medrep: string | null;
  /** Whether this person may open it. */
  mine: boolean;
  why: "phone" | "name";
};

/** What a MedRep's area holds, for Home and My area. */
export type MyArea = {
  area: { id: number; name: string; cities: string[]; channel: string | null } | null;
  counts: Partial<Record<CustomerKind, number>>;
  toReview: number;
  /** Hospitals, doctors and buyers in view with no order in the last 60 days. */
  quiet: number;
  /** Who the person reports to, up the line: "Daniel, Area manager", "Vanessa, HOSP head". */
  line: string[];
};

// ---------------------------------------------------------------- overview, ledger, search

/** One line of the stock ledger, as the Adjustments, Transfers and Receives lists show it. */
export type MoveRow = {
  id: number;
  at: string;
  kind: "receive" | "move_out" | "move_in" | "count" | "deliver" | "return";
  medicineId: number;
  medicine: string;
  unit: string | null;
  batchNo: string;
  expiresOn: string;
  warehouse: string;
  /** Where a transfer went. */
  toWarehouse: string | null;
  /** Pieces: above zero came in, below zero went out. */
  qty: number;
  ref: string | null;
  note: string | null;
  by: string;
};

export type MoveKind = "adjust" | "transfer" | "receive";

export type MoveList = {
  kind: MoveKind;
  rows: MoveRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** What Home shows: the work waiting and the state of the stock. */
export type Overview = {
  today: string;
  can: InventoryCan;
  stock: { medicines: number; out: number; low: number; expiring: number; expired: number };
  /** Purchases ordered and not yet received. Null for those who don't see purchases. */
  toReceive: { purchases: number; pieces: number; late: number } | null;
  /** New customers waiting for Management's look. Null for those who don't review. */
  toReview: number | null;
  topStocked: {
    id: number;
    name: string;
    strength: string | null;
    unit: string | null;
    total: number;
    packSize: number;
  }[];
  low: {
    id: number;
    name: string;
    strength: string | null;
    unit: string | null;
    total: number;
    reorderLevel: number;
    status: StockStatus;
  }[];
  activity: MoveRow[];
  /** How much each app holds, for the Admin's and the CEO's page of apps. Null for others. */
  apps: { customers: number; toReview: number; channels: number; people: number } | null;
};

export type SearchResult = {
  medicines: { id: number; name: string; strength: string | null; sku: string | null }[];
  customers: { id: number; name: string; kind: CustomerKind; city: string | null }[];
  /** Orders by code or customer PO, among those the person may read. */
  orders: { id: number; code: string; customer: string; status: string }[];
  /** People by name or seat login: the CEO's anyone, a lead's own team; HR everyone, also by email and employee ID. */
  people: {
    id: number;
    name: string;
    title: string | null;
    login: string | null;
    seatId: number | null;
    team: string | null;
    /** HR's search only: the employee ID, and whether they have left. */
    employeeCode?: string | null;
    left?: boolean;
  }[];
};

// ---------------------------------------------------------------- reports

/** A person in a channel, with the people who report to them under them. */
export type ChannelPerson = {
  id: number;
  name: string;
  roleLabel: string;
  title: string | null;
  area: string | null;
  team: ChannelPerson[];
};

/** One sales channel: its named head, its people by who reports to whom, what it looks after. */
export type ChannelReportRow = {
  id: number;
  code: string;
  name: string;
  /** The head named on the channel. Null until the Admin names one. */
  head: { id: number; name: string; title: string | null } | null;
  /** How many people work in the channel. */
  people: number;
  medreps: number;
  /** The channel's people as a tree: those at the top first, their teams under them. */
  tree: ChannelPerson[];
  areas: number;
  customers: number;
};

export type ChannelReport = { channels: ChannelReportRow[] };

// ---------------------------------------------------------------- orders

export type OrderStatus =
  | "draft"
  | "pending_approval"
  | "finance_check"
  | "ready_for_invoice"
  | "ready_for_dispatch"
  | "packing"
  | "shipped"
  | "completed"
  | "on_hold"
  | "exception"
  | "cancelled";

export type OrderStage =
  | "created"
  | "approved"
  | "finance_verified"
  | "invoiced"
  | "paid"
  | "packed"
  | "shipped"
  | "delivered"
  | "completed";

/** What the system found on an order, for Management (and Finance) to weigh before it goes on. */
export type OrderFinding = {
  /** rx: a patient's order without its prescription or the patient's ID (Management's). */
  /** note: what the MedRep wrote on the order, for Management to read before approving. */
  kind: "price" | "stock" | "customer" | "licence" | "papers" | "rx" | "owes" | "credit" | "note";
  /** A few words for a pill on the card: "Below hospital price". */
  short: string;
  /** What is to be decided, for the card's "Next action". */
  decide: string;
  text: string;
};

/** Who approves what: each Management person, every division (null) or only these. */
export type Approvers = {
  people: { id: number; name: string; title: string | null; unit: string | null; approves: string[] | null }[];
  divisions: string[];
};

/** Management asking up on an order (a Team Lead or the Business Mentor), and the answer. */
export type OrderAsk = {
  id: number;
  asWho: "team_lead" | "business_mentor";
  asWhoLabel: string;
  askedBy: string;
  askedTo: string;
  question: string;
  askedAt: string;
  /** Null until answered. */
  answer: boolean | null;
  answerNote: string | null;
  answeredAt: string | null;
  /** Waiting on this person's answer. */
  mine: boolean;
};
/** Whom Management may ask on an order: the MedRep's Team Lead and their division's Business Mentor. */
export type OrderAskUp = {
  teamLead: { id: number; name: string; title: string | null } | null;
  mentor: { id: number; name: string; title: string | null } | null;
};

/** Whose board: Management's "Orders to check" or Finance's. */
export type Desk = "management" | "finance" | "dispatch";

/** The tabs of a board. Management: needs, finance, dispatch, hold, done. Finance: needs
 *  (payments to confirm and orders to invoice), upstream (not yet with Finance), dispatch,
 *  hold, done. Dispatch: needs (to pack, to ship, on the way), upstream (not yet with
 *  Dispatch), hold, done. */
export type BoardTab =
  | "needs"
  | "upstream"
  | "finance"
  | "dispatch"
  | "hold"
  /** Cancelled orders: Management can bring one back (the hub's Exception Hub lists them). */
  | "cancelled"
  | "done"
  | "all"
  /** Sent back to the MedRep and not placed again yet. */
  | "sent"
  /** Dispatch's own piles. */
  | "to_pack"
  | "to_ship"
  | "road"
  | "came_back"
  /** What the desk passed on today: Management's approvals, Finance's checks (19 Nov). */
  | "passed";

/** A medicine on a card: what it lists at for this buyer and what it was offered at. */
export type CardItem = {
  medicineId: number;
  name: string;
  qty: number;
  priceLabel: string;
  listPrice: number;
  unitPrice: number;
  free: boolean;
  reason: string | null;
  /** Kept cold (Inventory's cold-chain mark). */
  cold: boolean;
};

/** One order as a card on Management's board. */
export type OrderCard = OrderRow & {
  /** The MedRep the order is for: what Management's queue groups by. */
  medrepId: number;
  /** Who approves it instead of Management (a PAP order's head); null: Management. */
  approverId: number | null;
  approverName: string | null;
  customerKind: CustomerKind;
  customerCity: string | null;
  channel: string | null;
  area: string | null;
  paymentTerms: PaymentTerms;
  paymentDays: number | null;
  /** Agreed to be paid by this day (in place of a number of days). */
  payBy: string | null;
  /** When it was placed (or placed again). */
  submittedAt: string;
  /** When it reached the step it is at now: its waiting time at this desk counts from here. */
  stepSince: string;
  /** Where it goes and when it is wanted (for Dispatch). */
  deliveryAddress: string | null;
  receiver: string | null;
  receiverPhone: string | null;
  expectedOn: string | null;
  /** Pieces on it altogether. */
  pieces: number;
  /** Who in the warehouse has it in hand. */
  dispatchBy: string | null;
  dispatchById: number | null;
  /** Who in Management is handling it. */
  handledBy: string | null;
  handledById: number | null;
  /** It came back undelivered (how many times, and why the last time). */
  cameBackCount: number;
  cameBackReason: string | null;
  lines: string;
  /** Each medicine with the price it lists at for this buyer and the price offered. */
  items: CardItem[];
  /** Management looked at its papers by hand and said they are right: when, and who. */
  papersCheckedAt: string | null;
  papersCheckedBy: string | null;
  findings: OrderFinding[];
  /** Sent back to the MedRep before (how many times), Management's last reason, who sent it
   *  and the MedRep's answer when they sent it again. */
  sentBackCount: number;
  sentBackReason: string | null;
  sentBackBy: string | null;
  reply: string | null;
  /** When Management approved it, and whether that approval can still be taken back. */
  approvedAt: string | null;
  takeBack: boolean;
  /** How far along the line it is: 0 placed, 1 Management, 2 Finance, 3 packing, 4 shipped, 5 delivered. */
  step: number;
  /** One line: what happens to it next, and whose move it is. */
  next: string;
  /** The Manila day it was placed, for grouping the cards by day. */
  placedOn: string;
  customerPhone: string | null;
  /** Where it ships from, once Management approved it. */
  warehouse: string | null;
  /** The customer's credit limit (null: none set). */
  creditLimit: number | null;
  /** The kinds of papers on file: "po", "payment_proof", "prescription", "gl", "other". */
  papers: PaperKind[];
  /** Where it stood when it was put on hold, and which desk holds it. */
  heldFrom: OrderStatus | null;
  heldRole: HoldRole | null;
  /** How it goes once shipped: a courier and its tracking, or our own rider. */
  deliveryMethod: DeliveryMethod | null;
  courier: string | null;
  tracking: string | null;
  rider: string | null;
};

export type HoldRole = "management" | "finance" | "dispatch";
export type DeliveryMethod = "courier" | "rider" | "pickup";

export type OrderBoard = {
  desk: Desk;
  tab: BoardTab;
  /** One status picked from the step line, in place of the tab. */
  status: OrderStatus | null;
  /** How many orders each of this desk's tabs holds. */
  counts: Partial<Record<BoardTab, number>>;
  /** How many orders stand at each status, in the same filters. */
  byStatus: Partial<Record<OrderStatus, number>>;
  cards: OrderCard[];
  channels: string[];
  medreps: { id: number; name: string }[];
  /** Who the shown orders are from (the tab or step picked, every filter but the MedRep). */
  byRep: BoardRep[];
  can: { place: boolean; manage: boolean; finance: boolean; dispatch: boolean };
};

export type BoardRep = {
  id: number;
  name: string;
  /** The MedRep's own channel and area. */
  channel: string | null;
  area: string | null;
  orders: number;
  value: number;
  /** When the longest-waiting of them was placed. */
  oldest: string | null;
};

export type OrderRow = {
  id: number;
  code: string;
  /** Its type, picked first (19 Nov); null on an order placed before types. */
  orderType: OrderType | null;
  /** The Division it was placed under (the MedRep may pick another than their own, 19 Nov). */
  division: string | null;
  customerId: number;
  customer: string;
  medrep: string;
  status: OrderStatus;
  /** Delivery, paid by the customer on top of the medicines (in `total`). */
  deliveryFee: number;
  /** Points the customer used on it (1 point = ₱1), paid with them on its invoice. */
  pointsUsed: number;
  statusLabel: string;
  /** On credit (pays some days after delivery). */
  credit: boolean;
  total: number;
  createdAt: string;
  updatedAt: string;
  flagReason: string | null;
  /** An order for one patient through a hospital or a doctor, and whose. */
  patientOrder: boolean;
  patientName: string | null;
  /** Filled on the approval queue: the medicines in one line and what the system found. */
  lines?: string;
  findings?: OrderFinding[];
  /** What the MedRep wrote on the order. */
  note?: string | null;
  /** Management changed its lines before approving (what, on the order's versions). */
  changed?: boolean;
  /** It came through the Online desk: the case's code and where it came in ("Messenger"). */
  via?: { code: string; source: string } | null;
  /** A guarantee letter's order: PAP's (Aryan, 26 Nov: "write everywhere that it is PAP's"), with
   *  its case and who works it; null on every other order. */
  pap?: { code: string | null; leadId: number | null; by: string | null } | null;
};

export type OrderList = {
  rows: OrderRow[];
  total: number;
  totalValue: number;
  page: number;
  pageSize: number;
  /** People whose orders are in view, for the filter. */
  medreps: { id: number; name: string }[];
  statuses: { key: OrderStatus; label: string }[];
  can: { place: boolean; manage: boolean };
};

export type OrderDashboard = {
  can: { place: boolean; manage: boolean };
  /** customers: new customers a MedRep added and Management hasn't checked (0 for others).
   *  toConfirm, toInvoice, refunds: Finance's work; toPack, toShip, onTheWay: Dispatch's (0 for
   *  those who don't see it). */
  attention: {
    awaiting: number;
    flagged: number;
    stuck: number;
    customers: number;
    /** Sent back to the MedRep and not placed again (a MedRep: their own). */
    sentBack: number;
    /** Open "medicine not available" requests (Inventory's; 0 for others). */
    requests: number;
    toConfirm: number;
    toInvoice: number;
    refunds: number;
    /** Due payments past their day (Finance's Due payments). */
    latePayments: number;
    toPack: number;
    toShip: number;
    onTheWay: number;
    /** On hold by Dispatch itself. */
    heldByDispatch: number;
  };
  tiles: {
    today: number;
    week: number;
    pendingPayment: number;
    readyForDispatch: number;
    inTransit: number;
    exceptions: number;
    /** Median minutes from placed to the last update, over orders that went out. Null when none did. */
    processingMinutes: number | null;
  };
  /** Which statuses each tile counts, so a tile and the list it opens always agree. */
  groups: Record<"pendingPayment" | "readyForDispatch" | "inTransit" | "exceptions", OrderStatus[]>;
  byStatus: { key: OrderStatus; label: string; count: number }[];
  flaggedCounts: { onHold: number; exception: number; cancelled: number };
};

export type OrderItemInput = {
  medicineId: number;
  qty: number;
  /** One of the medicine's prices: a kind of buyer, or "promo". */
  priceKind: string;
  /** What the MedRep gives it for, per piece (centavos). Left out = the picked price. */
  unitPrice?: number | null;
  reason?: string | null;
  /** A free line: the same medicine again at no charge (a Buy 1 Take 1, a sample). */
  free?: boolean;
};

export type OrderInput = {
  customerId: number;
  items: OrderItemInput[];
  /** Placed with no proof of payment attached: why. */
  noProofReason?: NoProofReason | null;
  noProofNote?: string | null;
  /** Where the order came from (the hub's Source list). */
  source?: string | null;
  /** Placed though a medicine is short on the shelf: why the MedRep goes on. */
  stockReason?: string | null;
  /** An order for one patient (through a hospital or a doctor): the prescription and the ID
   *  are then checked as on a patient's own order. */
  patientOrder?: boolean;
  patientName?: string | null;
  deliveryAddress?: string | null;
  receiver?: string | null;
  receiverPhone?: string | null;
  note?: string | null;
  expectedOn?: string | null;
  /** The customer's own PO number. */
  customerPo?: string | null;
  /** A bidding order: the tender whose award it delivers (an award with no order yet). */
  tenderId?: number | null;
  /** Which company bills it. */
  invoiceFrom?: InvoiceFrom;
  /** The doctor behind the order, if any (a doctor customer). */
  doctorId?: number | null;
  /** The switch at the top of the order form: send it to Management and to Finance before
   *  Dispatch. Left out: both (as before). Management checks it anyway when the system finds
   *  something wrong on it. */
  checks?: OrderChecks;
  /** The hub's Division (HOS, B&B…), its Sub-division, and the Payment Terms agreed ("PDC 30"). */
  division?: string | null;
  subDivision?: string | null;
  paymentTerm?: string | null;
  /** Whose order it is, when a team lead (or Management) places it for one of their MedReps. */
  medrepId?: number | null;
  /** A senior citizen's or PWD's order: 20% off and no VAT (or a lower promo, never both), with
   *  their OSCA/PWD ID number and name. On any order whose buyer shows the ID (Aryan, 17 Nov). */
  relief?: OrderRelief | null;
  /** The order's type, picked first (19 Nov): it says which papers the order carries. */
  type?: OrderType | null;
  /** The hub's Headquarter, with the Division (19 Nov, evening). */
  headquarter?: string | null;
  /** A prescription Division's order with no prescription yet: why. */
  noRxReason?: string | null;
  /** A guarantee letter's number and approved amount (centavos), when already in. */
  glNumber?: string | null;
  glAmount?: number | null;
};

export type OrderRelief = { kind: "senior" | "pwd"; idNo?: string | null; name?: string | null };

/** An order's type, picked first on the form (19 Nov): a patient's, a senior's or PWD's, one paid
 *  by a guarantee letter, a business's with their PO or without (orders/divisions.ts). */
export type OrderType = "patient" | "senior_pwd" | "gl" | "po" | "no_po";

/** One line of an order as a version kept it (centavos). */
export type OrderVersionLine = {
  medicineId: number;
  name: string;
  qty: number;
  priceKind: string;
  listPrice: number;
  unitPrice: number;
  reason: string | null;
  free: boolean;
  relief: boolean;
};

/** An order's lines as they stood once: placed, fixed by the MedRep, or changed by Management. */
export type OrderVersion = {
  n: number;
  kind: "placed" | "fixed" | "changed";
  kindLabel: string;
  by: string | null;
  byRole: string | null;
  at: string;
  /** The MedRep's answer, or Management's reason. */
  why: string | null;
  total: number;
  lines: OrderVersionLine[];
};

/** Whom a team lead (or Management) may place an order for, and who looks after the customer. */
export type OrderForList = {
  can: boolean;
  medreps: {
    id: number;
    name: string;
    area: string | null;
    /** Their channel's code. */
    channel: string | null;
    /** The Division their orders carry: their main seat's. */
    division: string | null;
    /** Every Division their seats carry (one with two seats has two). */
    divisions: string[];
    login: string | null;
    team: string | null;
  }[];
  /** The MedRep of the customer's area, when there is one. */
  suggested: number | null;
};

/** A sent-back order fixed by its MedRep: the whole order again, and their answer to Management. */
export type OrderRevision = OrderInput & { answer: string };

/** What Management completes on a field order before approving it. */
export type OrderDetailsInput = {
  division?: string | null;
  subDivision?: string | null;
  paymentTerm?: string | null;
  receiver?: string | null;
  receiverPhone?: string | null;
  deliveryAddress?: string | null;
  expectedOn?: string | null;
  customerPo?: string | null;
  invoiceFrom?: InvoiceFrom;
  note?: string | null;
};

export type OrderChecks = { management: boolean; finance: boolean };

/** The company that bills an order: one of the group's companies (src/companies.ts). */
export type InvoiceFrom = CompanyCode;
export type PaperKind =
  | "po"
  | "hospital_doc"
  | "payment_proof"
  | "prescription"
  | "valid_id"
  | "senior_id"
  | "med_cert"
  | "gl"
  | "dr"
  | "other";

export type OrderPaper = {
  id: number;
  kind: PaperKind;
  kindLabel: string;
  name: string;
  mime: string;
  size: number;
  by: string;
  at: string;
};

export type OrderAction =
  | "approve"
  | "send_back"
  | "reject"
  | "hold"
  | "exception"
  | "resume"
  | "cancel"
  | "resubmit"
  /** Management: takes back an approval given by mistake, while the next desk hasn't acted on
   *  it (and for 30 minutes at most). */
  | "take_back"
  /** Management: a cancelled order comes back, to Management's approval (the hub's Restore). */
  | "restore"
  /** Finance: the money for an advance order is in, so it can go on. */
  | "confirm_payment"
  /** Finance: a credit or cash-on-delivery order gets its invoice and goes on. */
  | "make_invoice"
  /** Dispatch: the pieces go into the box by batch, off the shelf. */
  | "pack"
  /** Dispatch: the box is opened again; its pieces go back on the shelf. */
  | "unpack"
  /** Dispatch: handed to a courier or our rider. */
  | "ship"
  /** Dispatch: the customer has it (or picked it up). */
  | "deliver"
  /** Dispatch: the parcel didn't reach the customer and came back, still packed. */
  | "failed"
  /** The MedRep answers the question an order was held with (the holder is told). */
  | "answer";

export type OrderDetail = {
  order: OrderRow & {
    customerKind: CustomerKind;
    customerCity: string | null;
    customerReview: "ok" | "to_review";
    /** Who the customer is, shown on Management's check of a new one: phone, who added it, the day. */
    customerPhone?: string | null;
    customerAddedBy?: string | null;
    customerAddedOn?: string | null;
    /** The licence that lets them buy (a hospital's LTO, a doctor's PRC), its expiry and TIN:
     *  what Management checks. */
    licenceNo: string | null;
    licenceExpires: string | null;
    tin: string | null;
    /** Placed with no proof of payment: why (the MedRep's word). */
    noProofReason: NoProofReason | null;
    noProofNote: string | null;
    /** Where the order came from (the hub's Source list). */
    source: string | null;
    /** A hospital's, distributor's or drugstore's licence and papers still missing (the hub's list). */
    customerMissing: string[];
    /** Placed though a medicine was short: why the MedRep went on. */
    stockReason: string | null;
    /** Who approves it instead of Management (a PAP order's head), when someone does. */
    approverName: string | null;
    /** Finance's screenshots with the hold it is on now. */
    holdProofs: { id: number; name: string }[];
    /** The email ID its seller used that day (a seat's login is handed to the next person), and
     *  whether it was sold covering a vacant area (the seat's sale, not the seller's own KPI). */
    soldAs: string | null;
    covered: boolean;
    raisedBy: string;
    channel: string | null;
    area: string | null;
    paymentTerms: PaymentTerms;
    paymentDays: number | null;
    deliveryAddress: string | null;
    receiver: string | null;
    receiverPhone: string | null;
    note: string | null;
    expectedOn: string | null;
    customerPo: string | null;
    invoiceFrom: InvoiceFrom;
    invoiceFromLabel: string;
    doctorId: number | null;
    doctor: string | null;
    warehouseId: number | null;
    warehouse: string | null;
    heldFrom: OrderStatus | null;
    heldRole: HoldRole | null;
    submittedAt: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    /** Management looked at its papers by hand and said they are right: when, and who. */
    papersCheckedAt: string | null;
    papersCheckedBy: string | null;
    deliveryMethod: DeliveryMethod | null;
    courier: string | null;
    tracking: string | null;
    /** With a courier and no tracking number yet: why (the hub's "not ready yet"). */
    trackingWait: string | null;
    rider: string | null;
    packedAt: string | null;
    packedBy: string | null;
    shippedAt: string | null;
    shippedBy: string | null;
    deliveredOn: string | null;
    deliveredBy: string | null;
    receivedBy: string | null;
    /** The Online case it was placed from (none for a MedRep's own order). */
    leadId: number | null;
    division: string | null;
    subDivision: string | null;
    /** Finance checks it before Dispatch (Management decides when it approves). */
    financeCheck: boolean;
    /** The Payment Terms as agreed ("PDC 30"); `paymentTerms` / `paymentDays` are what they mean. */
    paymentTerm: string | null;
    /** Sent back to the MedRep: how many times, Management's last reason, by whom, when; and
     *  the MedRep's answer when it was sent again. */
    sentBackCount: number;
    sentBackReason: string | null;
    sentBackBy: string | null;
    sentBackAt: string | null;
    reply: string | null;
    /** Until when Management can still take its approval back (null when it can't). */
    takeBackUntil: string | null;
    /** A senior citizen's or PWD's order: who, as the invoice shows them. */
    relief: OrderRelief | null;
    /** Its type, picked first (null on an order placed before types, 19 Nov). */
    type: OrderType | null;
    headquarter: string | null;
    /** No prescription with it yet, and why (a prescription Division's order). */
    noRxReason: string | null;
    /** A guarantee letter's number and the amount the agency approves (centavos), once written. */
    glNumber: string | null;
    glAmount: number | null;
    glSetBy: string | null;
    /** A guarantee letter's claim on the agency, which Finance sends after the delivery (22 Nov):
     *  its case, the agency, the day it went and its reference. Null on any other order. */
    glClaim: { leadId: number; agency: string | null; sentOn: string | null; ref: string | null } | null;
  };
  items: {
    id: number;
    medicineId: number;
    medicine: string;
    sku: string | null;
    unit: string | null;
    packSize: number;
    qty: number;
    priceKind: string;
    priceLabel: string;
    listPrice: number;
    unitPrice: number;
    reason: string | null;
    amount: number;
    /** Sellable pieces in all warehouses now. */
    inStock: number;
    /** What this customer paid for it last time (unit price, an earlier order), if ever. */
    lastPrice: number | null;
    /** Given at no charge (a promo's free goods). */
    free: boolean;
    /** Sold at the senior's or PWD's price (20% off, no VAT). */
    relief: boolean;
    /** The medicine's VAT as Inventory keeps it, and whether it needs a prescription. */
    vat: Vat;
    rx: boolean;
    /** Priced by an offer, or the free pieces an offer added (worked out by the system). */
    offerId: number | null;
    /** Kept cold from the shelf to the customer (Inventory's cold-chain mark): packed cold. */
    cold: boolean;
    /** A cold-chain box (styro): its price is what Management typed on this order. */
    coldBox: boolean;
  }[];
  /** Management's questions up the MedRep's line on it, and their answers. */
  asks: OrderAsk[];
  /** For Management on an open order: whom it may ask. Null for anyone else. */
  askUp: OrderAskUp | null;
  /** Every version of its lines, oldest first: as placed, each MedRep fix, each change
   *  Management made before approving. The last is what the order is now. */
  versions: OrderVersion[];
  findings: OrderFinding[];
  stages: { key: OrderStage; label: string; at: string | null }[];
  /** Every status it stood at, when it came and when it left (open while it is there). */
  steps: {
    status: OrderStatus;
    label: string;
    enteredAt: string;
    leftAt: string | null;
    minutes: number;
  }[];
  events: {
    id: number;
    kind: string;
    stage: OrderStage | null;
    message: string;
    by: string;
    byRole: string;
    at: string;
  }[];
  warehouses: Warehouse[];
  /** Held, for Management: where it may go on from, where it stopped first (the hub's "Continue
   *  from"). Empty for anyone else. */
  resumeTo: { status: OrderStatus; label: string }[];
  /** The checks Management has approved one by one (Documents, Medicines & price, Stock &
   *  warehouse, Customer & licence), with who and when; all four approve the order. */
  /** Management's checks approved one by one, and Finance's (finance_…), with who and when. */
  checksApproved: {
    key: "papers" | "price" | "stock" | "customer" | "finance_papers" | "finance_dues" | "finance_credit";
    by: string;
    at: string;
  }[];
  /** Waiting for stock: since when, who held it, and what is still short (empty: it's in now). */
  waitingStock: { since: string; by: string | null; short: { name: string; need: number; free: number }[] } | null;
  /** What the customer owed before this order (this CRM's invoices, Zoho's and its opening
   *  balance; the order's own invoice left out), for Finance's check and Management's: worked out,
   *  not looked up in Zoho (Aryan, 17 Nov). */
  dues: {
    owed: number;
    overdue: number;
    /** The oldest overdue amount's days late. */
    days: number;
    /** Of owed, what is in Zoho (its unpaid invoices and opening balance). */
    zoho: number;
    creditLimit: number | null;
    /** The customer's credit left to use (Zoho's open credit notes, money kept from a bill). */
    credit: number;
  };
  /** For whoever approves it: each warehouse and what it can't fill of this order (stock
   *  unexpired, less what other approved orders from it hold). Null for anyone else. */
  warehouseFill:
    | {
        id: number;
        name: string;
        isDefault: boolean;
        short: { medicine: string; need: number; have: number }[];
        /** Every medicine of the order: what it needs and what is free in this warehouse. */
        lines: { medicine: string; need: number; have: number }[];
      }[]
    | null;
  papers: OrderPaper[];
  /** The papers this order is expected to carry, and whether each is on file. */
  paperList: {
    kind: PaperKind;
    label: string;
    needed: boolean;
    why: string | null;
    onFile: boolean;
  }[];
  /** Its invoice once Finance made it, the money received against it and any given back. */
  money: { invoice: InvoiceRow | null; payments: PaymentRow[]; refunds: RefundRow[] };
  /** The batches in the box, once Dispatch packed it. */
  picks: OrderPick[];
  can: Record<OrderAction, boolean> & {
    addPaper: boolean;
    addProof: boolean;
    addDr: boolean;
    recordPayment: boolean;
    /** Hold it until stock comes in: only while something on it is short. */
    waitStock: boolean;
    /** Finance just checked its payment (within 90 seconds) and may take it back. */
    undoConfirm: boolean;
  };
};

/** Where a person's own orders stand, for a MedRep's Home and "My orders". */
export type MyOrderStage =
  | "all"
  | "sent_back"
  | "management"
  | "finance"
  | "dispatch"
  | "held"
  | "delivered";

export type MyOrders = {
  stage: MyOrderStage;
  counts: Record<MyOrderStage, number>;
  /** Orders on hold or sent back to the person, with why: what they must fix. */
  held: {
    id: number;
    code: string;
    customer: string;
    status: OrderStatus;
    reason: string | null;
  }[];
  /** This month (Manila): orders placed and not cancelled; the value sold (the orders'
   *  invoices, not cancelled) and today's; the person's target for the month (null when none
   *  is set), and how far the month has gone. */
  sales: {
    month: string;
    orders: number;
    value: number;
    today: number;
    daysLeft: number;
    target: number | null;
    day: number;
    daysInMonth: number;
  };
  /** This month's orders by the Division they carry (19 Nov: a MedRep may bring another
   *  Division's order; their screen says what came from which), and the one picked, if any. */
  byDivision: { division: string; orders: number; value: number }[];
  division: string | null;
  cards: OrderCard[];
  total: number;
  page: number;
  pageSize: number;
};

/** Monthly sales targets, for the people a person may set them for. */
export type TargetList = {
  /** Selling seats nobody holds today, with their targets (whoever takes the seat takes them). */
  emptySeats: { seatId: number; title: string; unit: string; area: string | null; target: number | null; lastTarget: number | null }[];
  month: string;
  monthLabel: string;
  /** Days of the month, and how many have gone (all of them for a month gone by). */
  daysInMonth: number;
  daysGone: number;
  can: { set: boolean };
  /** The teams the people sit in, in the tree's order. */
  units: { id: number; name: string }[];
  rows: {
    personId: number;
    /** Their seat's team and login ID (none for someone with no seat). */
    unitId: number | null;
    login: string | null;
    /** Their target the month before, to copy. */
    lastTarget: number | null;
    name: string;
    roleLabel: string;
    title: string | null;
    channel: string | null;
    area: string | null;
    target: number | null;
    /** How many different SKUs (TLB) and different customers billed (billing efficiency) are aimed at. */
    tlbTarget: number | null;
    billedTarget: number | null;
    /** Orders placed this month (not drafts, not cancelled), their value. */
    placed: number;
    /** What was sold this month: their orders' invoices (not cancelled), as the target counts. */
    sold: number;
    setBy: string | null;
  }[];
};

// ---------------------------------------------------------------- finance

/** "withholding": tax the customer withheld (BIR Form 2307), a settlement, not cash. */
export type PaymentMethod =
  | "bank"
  | "cash"
  | "check"
  | "ewallet"
  | "other"
  | "points"
  | "withholding"
  | "credit"
  /** What the customer deducted (a near-expiry return kept, a listing fee…): a settlement, not cash. */
  | "deduction";
export type DeductionKind = "near_expiry" | "listing_fee" | "promo" | "penalty" | "other" | "gl_waived";

/** A customer's credit: Zoho's open credit notes, and money paid beyond a bill kept for the next. */
export type CustomerCredit = {
  /** What is left to use, all sources together (centavos). */
  total: number;
  sources: {
    /** zoho: a Zoho credit note's balance; kept: paid beyond one of our bills, kept as credit. */
    kind: "zoho" | "kept";
    id: number;
    /** The credit note's number, or the invoice the money was paid on. */
    number: string;
    day: string;
    amount: number;
    left: number;
  }[];
};

/** How an invoice stands today: "Paid", "Overdue by 12 days", "Due in 5 days". */
export type InvoiceState = {
  word: string;
  tone: "good" | "warn" | "bad" | "info" | "plain";
  overdueDays: number;
};

export type InvoiceTab = "all" | "unpaid" | "overdue" | "paid" | "cancelled";

export type InvoiceRow = {
  id: number;
  code: string;
  orderId: number;
  orderCode: string;
  customerId: number;
  customer: string;
  customerKind: CustomerKind;
  invoiceFrom: InvoiceFrom;
  invoiceFromLabel: string;
  terms: PaymentTerms;
  issuedOn: string;
  dueOn: string;
  total: number;
  paid: number;
  refunded: number;
  /** What is still owed: total less paid (0 once cancelled). */
  balance: number;
  status: "open" | "paid" | "cancelled";
  state: InvoiceState;
};

export type InvoiceList = {
  tab: InvoiceTab;
  counts: Record<InvoiceTab, number>;
  rows: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The amounts of every invoice in the tab and filters, not only this page. */
  sums: { total: number; balance: number };
  /** The customer the list is narrowed to, if any. */
  customer: { id: number; name: string } | null;
};

export type PaymentRow = {
  id: number;
  invoiceId: number;
  invoiceCode: string;
  orderId: number;
  orderCode: string;
  customerId: number;
  customer: string;
  amount: number;
  method: PaymentMethod;
  methodLabel: string;
  reference: string | null;
  paidOn: string;
  note: string | null;
  proofId: number | null;
  by: string;
  at: string;
  /** Who paid it: the customer, or a guarantee letter's agency. */
  payer?: "customer" | "agency";
  /** Why it was deducted, when it is a deduction. */
  deductionKind?: DeductionKind | null;
  active: boolean;
  removedReason: string | null;
};

export type PaymentList = {
  rows: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The money in every payment in the filters. */
  sum: number;
  /** The same money by how it was paid, most first; and day by day. */
  byMethod: { method: PaymentMethod; label: string; amount: number; count: number }[];
  byDay: { day: string; amount: number }[];
  month: string;
  monthLabel: string;
  methods: { key: PaymentMethod; label: string }[];
};

export type RefundRow = {
  id: number;
  invoiceId: number;
  amount: number;
  method: PaymentMethod;
  methodLabel: string;
  reference: string | null;
  refundedOn: string;
  note: string | null;
  by: string;
  at: string;
};

export type InvoiceDetail = {
  invoice: InvoiceRow & {
    /** Taken off the bill by returns Management credited. */
    credited: number;
    /** What Finance still gives back as money (a cancelled invoice, or paid beyond the bill). */
    refundOwed: number;
    vatable: number;
    vat: number;
    exempt: number;
    zeroRated: number;
    paymentDays: number | null;
    medrep: string;
    customerAddress: string | null;
    customerTin: string | null;
    customerPo: string | null;
    deliveryAddress: string | null;
    by: string;
    at: string;
    cancelledReason: string | null;
    /** What delivery cost on top of the medicines (VAT-able, on the same invoice). */
    deliveryFee: number;
    customerPhone: string | null;
    receiver: string | null;
    /** The prescribing doctor, printed as Zoho's "Doctor Name". */
    doctor?: string | null;
    /** "CHANNEL | Name", as Zoho's Salesperson. */
    salesperson?: string;
    /** Where the order came from (Zoho's custom field "Source"). */
    source?: string;
    /** The Payment Terms as agreed ("PDC 30"). */
    paymentTerm?: string | null;
    /** A senior citizen's or PWD's sale: their OSCA / PWD ID number and name, as the law has the
     *  invoice show them. */
    relief?: OrderRelief | null;
  };
  /** The company's own details, printed at the top as Zoho Books prints them. */
  company: CompanyInfo;
  items: {
    id: number;
    medicine: string;
    qty: number;
    unit: string | null;
    unitPrice: number;
    amount: number;
    vat: Vat;
    free: boolean;
    strength?: string | null;
    form?: string | null;
    /** The senior citizen / PWD 20% is in this line's price. */
    relief?: boolean;
  }[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  /** The proofs of payment on the order, to pick one for a payment. */
  proofs: OrderPaper[];
  can: { pay: boolean; removePayment: boolean; refund: boolean };
};

/** One customer's unpaid invoices, by how late they are. */
export type OwedRow = {
  customerId: number;
  customer: string;
  kind: CustomerKind;
  city: string | null;
  terms: string;
  creditLimit: number | null;
  medrep: string | null;
  invoices: number;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  older: number;
  /** Cash on delivery not delivered yet: not late. */
  onDelivery: number;
  total: number;
  overdue: number;
  /** Days the oldest unpaid invoice is past due (0 when none is). */
  oldestDays: number;
};

export type OwedList = {
  rows: OwedRow[];
  totals: Omit<
    OwedRow,
    "customerId" | "customer" | "kind" | "city" | "terms" | "creditLimit" | "medrep" | "oldestDays"
  >;
  today: string;
};

export type RefundOwed = {
  invoiceId: number;
  invoiceCode: string;
  orderId: number;
  orderCode: string;
  customerId: number;
  customer: string;
  received: number;
  refunded: number;
  owed: number;
  reason: string | null;
  cancelledAt: string | null;
  /** Days since it was cancelled. */
  days: number;
};

export type RefundList = {
  owed: RefundOwed[];
  done: (RefundRow & {
    invoiceCode: string;
    orderId: number;
    orderCode: string;
    customer: string;
  })[];
  can: { refund: boolean };
};

export type ConfirmPaymentInput = {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  paidOn: string;
  /** Finance ticked: "I have checked the proof and the money is in our account". */
  checked: boolean;
  note?: string | null;
};

export type PaymentInput = {
  /** May be nothing when the whole of it is tax withheld or a deduction (a letter's shortfall let go). */
  amount: number;
  /** A guarantee letter's order: the agency paid it (the default), or the patient paid the rest. */
  payer?: "agency" | "patient" | null;
  method: PaymentMethod;
  reference?: string | null;
  paidOn: string;
  note?: string | null;
  proofId?: number | null;
  /** The bank, cash or e-wallet account it went into (Banking's names). */
  moneyAccount?: string | null;
  /** Tax the customer withheld from it (EWT, with their BIR Form 2307): recorded with it as a
   *  payment of its own, settling the invoice too. */
  withheld?: number | null;
  form2307?: string | null;
  /** What the customer deducted from it, why, and their debit memo's number. */
  deducted?: number | null;
  deductionKind?: DeductionKind | null;
  deductionRef?: string | null;
};

export type RefundInput = {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  refundedOn: string;
  note?: string | null;
  /** The bank, cash or e-wallet account it went out of (Banking's names). */
  moneyAccount?: string | null;
};
/** The books' bank, cash and e-wallet accounts, for the payment and refund forms. */
export type MoneyAccounts = { accounts: { name: string; type: string }[] };

// ---------------------------------------------------------------- dispatch

export type OrderPick = {
  id: number;
  itemId: number;
  medicine: string;
  batchId: number;
  batchNo: string;
  expiresOn: string;
  warehouse: string;
  qty: number;
  packSize: number;
};

/** What Dispatch picks for each line of an order: the batches on the shelf of the warehouse it
 *  ships from, nearest expiry first, and the first-expiry-first suggestion. */
export type PackPlan = {
  orderId: number;
  code: string;
  warehouseId: number;
  warehouse: string;
  today: string;
  lines: {
    itemId: number;
    medicineId: number;
    medicine: string;
    qty: number;
    packSize: number;
    batches: { batchId: number; batchNo: string; expiresOn: string; onShelf: number }[];
    suggested: { batchId: number; qty: number }[];
    /** Pieces the warehouse can't give, even taking every batch. */
    short: number;
  }[];
};

export type PackInput = { picks?: { itemId: number; batchId: number; qty: number }[] };
export type ShipInput = {
  method: "courier" | "rider";
  courier?: string | null;
  tracking?: string | null;
  /** No tracking number yet: why (the hub's "not ready yet" choices, or the person's own words). */
  trackingWait?: string | null;
  rider?: string | null;
  /** The parcel's printed address slip checked against the order's (the hub's Confirm for
   *  delivery): nothing goes out unchecked. */
  addressChecked?: boolean;
  note?: string | null;
};
export type DeliverInput = {
  receivedBy: string;
  deliveredOn: string;
  note?: string | null;
  /** Cash on delivery: what the rider or courier collected and who has it (Finance records the
   *  payment once it is in the bank). */
  cod?: CodCashInput | null;
};

/** The cash a cash-on-delivery order's rider or courier collected, as Dispatch hands it over. */
export type CodCashInput = { amount: number; by: string; note?: string | null };

export type ShipmentTab = "road" | "delivered" | "all";

export type ShipmentRow = {
  id: number;
  code: string;
  customerId: number;
  customer: string;
  city: string | null;
  medrep: string;
  status: OrderStatus;
  statusLabel: string;
  deliveryMethod: DeliveryMethod | null;
  courier: string | null;
  tracking: string | null;
  /** No tracking number yet: why. */
  trackingWait: string | null;
  rider: string | null;
  shippedAt: string | null;
  deliveredOn: string | null;
  receivedBy: string | null;
  total: number;
};

export type ShipmentList = {
  tab: ShipmentTab;
  counts: Record<ShipmentTab, number>;
  rows: ShipmentRow[];
  total: number;
  page: number;
  pageSize: number;
};

// ---------------------------------------------------------------- sales against target

/** Where a figure stands against the month's pace: on (at or past where the days gone put it),
 *  behind, far behind (under half of that, once a fifth of the month has gone), none without a
 *  target. */
export type PaceTone = "on" | "behind" | "far" | "none";

/** The month a page is about: which, how far through it, and today. */
export type MonthFacts = {
  month: string;
  monthLabel: string;
  today: string;
  /** It is this month (its figures still move). */
  running: boolean;
  /** How far through the month (0–1; 1 for a month gone by). */
  pace: number;
  daysLeft: number;
  /** Days picked instead of a month (Today, This week, from–to): the figures count those days and
   *  the targets are shared out over them. */
  range?: { from: string; to: string; label: string };
};

/** One seller's month: target, what was sold (invoiced), today's, what was placed. */
export type SellerFigures = {
  personId: number;
  name: string;
  roleLabel: string;
  title: string | null;
  area: string | null;
  channel: string | null;
  reportsToId: number | null;
  /** How far under the page's top person (0 = directly under). */
  depth: number;
  target: number | null;
  sold: number;
  today: number;
  /** Orders placed in the month (not drafts, not cancelled), and their value. */
  placed: number;
  placedValue: number;
  /** Orders waiting for Management or Finance now; orders on hold or sent back now. */
  waiting: number;
  held: number;
  pct: number | null;
  tone: PaceTone;
};

export type TeamSales = MonthFacts & {
  /** Whose team it is ("the company" for the Admin and the CEO). */
  lead: { name: string; title: string | null; channel: string | null } | null;
  total: {
    target: number | null;
    sold: number;
    today: number;
    placed: number;
    placedValue: number;
    pct: number | null;
    tone: PaceTone;
  };
  people: SellerFigures[];
  /** The team's orders stopped now: on hold, in exception or sent back. */
  stopped: {
    id: number;
    code: string;
    customer: string;
    medrep: string;
    status: OrderStatus;
    statusLabel: string;
    reason: string | null;
  }[];
  can: { setTargets: boolean };
};

export type ChannelFigures = {
  id: number;
  code: string;
  name: string;
  head: string | null;
  /** The business the channel is under on the Company tree (the sheet's channels, 22 Nov). */
  business?: string | null;
  /** People in the channel's seats and the customers in their areas (the sheet's channels). */
  people?: number;
  customers?: number;
  target: number | null;
  sold: number;
  today: number;
  pct: number | null;
  tone: PaceTone;
};

export type CeoAlert = {
  kind: "channel" | "orders" | "money" | "stock" | "refunds" | "customers";
  text: string;
  note: string | null;
  href: string;
  tone: "bad" | "warn";
};

/** The company at a glance, on the CEO's Home (overview/company.ts). Money in centavos. */
export type CompanyGlance = {
  today: string;
  departments: { name: string; people: number }[];
  working: { in: number; all: number };
  channels: { code: string; name: string; target: number; sold: number }[];
  days: { day: string; amount: number }[];
  sellers: { name: string; amount: number }[];
  customers: { name: string; amount: number }[];
  medicines: { name: string; amount: number }[];
  enquiries: { bySource: { source: string; count: number }[]; all: number; waiting: number; ordered: number; month: number };
  orders: { status: string; count: number }[];
  stock: { name: string; value: number; pieces: number }[];
  kinds: { kind: string; count: number }[];
  /** Who came in today and when (Aryan, 19 Nov: "who came late, who came early, in colour"). */
  attendance: {
    /** A working day, so far: in on time, in late, not in yet (no leave), on leave. */
    onTime: number;
    late: number;
    notIn: number;
    onLeave: number;
    /** The same, department by department (the chart's top boxes). */
    departments: { name: string; onTime: number; late: number; notIn: number; onLeave: number }[];
    /** The first in today, and the ones in late (minutes past their start and grace). */
    first: { name: string; title: string | null; at: string }[];
    lateList: { name: string; title: string | null; at: string; minutes: number }[];
    /** Management's, Finance's and Dispatch's people started at their desk now, and since when. */
    desks: { desk: string; seats: number; people: { name: string; since: string; late: boolean }[] }[];
    /** This week's working days so far: in on time, late, not in. */
    week: { day: string; onTime: number; late: number; notIn: number }[];
  };
};

export type CeoHome = MonthFacts & {
  sales: {
    target: number | null;
    achieved: number;
    today: number;
    /** Payments received in the month. */
    collected: number;
    /** Collected over the same days of the month before (a month gone by: the whole month before). */
    collectedBefore: { amount: number; from: string; to: string };
    pct: number | null;
    tone: PaceTone;
    channels: ChannelFigures[];
  };
  money: {
    owed: number;
    overdue: number;
    lateCustomers: number;
    refundsOwed: number;
    /** Cash on delivery out with the couriers: shipped, not paid yet. */
    codOnTheRoad: number;
    /** Cash on delivery whose goods aren't delivered yet (owed once delivered; not in `owed`). */
    onDelivery: number;
    /** Ordered from suppliers, not received yet (landed, in pesos). */
    purchasesOpen: number;
    purchasesValue: number;
    /** Suppliers' unpaid bills and what is left on them (with their openings), in centavos. */
    billsOpen: number;
    billsValue: number;
  };
  orders: {
    awaiting: number;
    finance: number;
    onHold: number;
    stuck: number;
    oldestHours: number | null;
    today: number;
  };
  dispatch: { toPack: number; toShip: number; onTheWay: number; deliveredToday: number };
  stock: { medicines: number; out: number; low: number; expiring: number; value: number | null };
  customers: { total: number; toReview: number };
  people: { total: number; sellers: number; withoutTarget: number };
  alerts: CeoAlert[];
};

/** The company tree's data, in the shape the old CRM's tree draws (centavos; ids as text). */
export type CompanyTreeData = {
  month: string;
  today: string;
  asOf: string | null;
  company: string;
  ceo: string | null;
  ceoId: string | null;
  channels: {
    id: string;
    code: string;
    name: string;
    head: string | null;
    headId: string | null;
    sort: number;
    crmAchieved: number;
    crmToday: number;
  }[];
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
};

// ---------------------------------------------------------------- online desk

export type LeadSource =
  | "website"
  | "messenger"
  | "facebook"
  | "instagram"
  | "website_2mg"
  | "website_capsandpills"
  | "phone"
  | "walk_in"
  | "referral"
  | "email"
  | "other";
export type LeadRoad = "regular" | "senior" | "pwd" | "gl";
/** A business buying through the Online desk (Aryan, 19 Nov: those orders count as Online's). */
export type BuyerBusiness = "hospital" | "doctor" | "drugstore" | "distributor" | "government";
export type GlAgency = "dswd" | "pcso" | "ovp" | "op";
export type LeadPaperKind =
  | "rx"
  | "osca_id"
  | "pwd_id"
  | "pwd_booklet"
  | "valid_id"
  | "med_cert"
  | "gl_letter"
  | "pickup_photo"
  | "other"
  | "unsorted";
export type LeadQueue = "all" | "active" | "attention" | "deliver" | "payment" | "done" | "lost";
/** The desk's step line: the saved road steps grouped as the old desk groups them. */
export type DeskStep =
  | "new"
  | "rx"
  | "quote"
  | "papers"
  | "ready"
  | "ordered"
  | "unpaid"
  | "done"
  | "lost";
export type RoadStepWords = { value: string; label: string; hint: string };

export type QuoteLine = {
  medicineId: number;
  medicine: string;
  qty: number;
  packSize: number;
  /** The patient price of one piece on the catalogue when it was quoted. */
  listPrice: number;
  unitPrice: number;
  reason: string | null;
  vat: Vat;
  rx: boolean;
};

export type LeadCard = {
  id: number;
  code: string;
  name: string;
  /** The patient, when someone else is writing for them. */
  patient: string | null;
  phone: string | null;
  source: LeadSource;
  sourceLabel: string;
  caseType: CaseType;
  road: LeadRoad;
  /** Who a PAP case came from, with the channel its sale counts in ("Ryan · HOSP"); null otherwise. */
  cameFrom?: string | null;
  /** A business buying through the desk (its kind); null: a patient. */
  buyer: BuyerBusiness | null;
  agency: GlAgency | null;
  city: string | null;
  /** The medicines asked for, in one line. */
  interest: string | null;
  owner: string | null;
  step: RoadStepWords;
  stepIndex: number;
  steps: RoadStepWords[];
  deskStep: DeskStep;
  next: string;
  lost: boolean;
  lostReason: string | null;
  finished: boolean;
  unopened: boolean;
  firstContactAt: string;
  /** The Manila day it came in, for grouping the cards. */
  firstDay: string;
  papers: { needed: number; onFile: number };
  /** The prescription is needed and on file. */
  rxOnFile: boolean;
  order: { id: number; code: string; statusLabel: string } | null;
  /** The conversation it came with, if any. */
  chat: ChatChannel | null;
  awaitingReply: boolean;
  /** Their newest message hasn't been opened on the desk yet. */
  unread: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

export type LeadDesk = {
  queue: LeadQueue;
  step: DeskStep | null;
  counts: Record<LeadQueue, number>;
  steps: Record<DeskStep, number>;
  /** Each kind of card, with the queue and the road picked. */
  types: { all: number; enquiry: number; website_order: number };
  /** Each payment road, with the queue and the kind picked (senior and PWD together too). */
  roads: { all: number; regular: number; senior_pwd: number; gl: number };
  /** The months the cards came in, newest first (the latest six that have any). */
  months: { key: string; label: string; count: number }[];
  month: string | null;
  cards: LeadCard[];
  /** How many match (the cards are the newest of them). */
  total: number;
  agents: { id: number; name: string }[];
  can: { add: boolean };
};

export type LeadPaper = {
  id: number;
  kind: LeadPaperKind;
  kindLabel: string;
  name: string;
  mime: string;
  size: number;
  by: string;
  at: string;
};

export type LeadCase = {
  lead: {
    id: number;
    code: string;
    source: LeadSource;
    sourceLabel: string;
    caseType: CaseType;
    name: string;
    relation: string | null;
    patientName: string | null;
    phone: string | null;
    email: string | null;
    city: string | null;
    address: string | null;
    customerId: number | null;
    assignedTo: number | null;
    assignedName: string | null;
    road: LeadRoad;
    agency: GlAgency | null;
    request: string | null;
    /** A business buying (its kind) and the one on file once picked; null: a patient buys. */
    buyerKind: BuyerBusiness | null;
    buyerName: string | null;
    /** The business's own payment terms on file ("30 days"). */
    buyerTerms: string | null;
    quoteSentVia: string | null;
    quoteSentAt: string | null;
    glAppliedOn: string | null;
    glLetterNo: string | null;
    glAmount: number | null;
    glLetterOn: string | null;
    glExpiresOn: string | null;
    glVerifiedAt: string | null;
    /** The claim after delivery (guarantee letter). */
    claimSentOn: string | null;
    claimRef: string | null;
    /** PCSO's other two quotations typed by hand: each vendor's name and total, from their written
     *  quote. Empty: they fill themselves from the medicines' prices (`canvassAuto`). */
    canvass: { vendor: string; amount: number }[];
    /** online: the Online desk's; pap: a PAP MedRep's patient-assistance case. */
    desk: "online" | "pap";
    /** Who the case came to PAP from (an Online agent, a MedRep) and the channel the sale counts in. */
    cameFrom: { id: number; name: string; channel: string | null } | null;
    state: "open" | "lost";
    lostReason: string | null;
    firstContactAt: string;
    createdBy: string;
    chatChannel: ChatChannel | null;
    /** The page or the mailbox the conversation is on. */
    chatAccount: string | null;
    awaitingReply: boolean;
    lastInboundAt: string | null;
  };
  step: RoadStepWords;
  steps: RoadStepWords[];
  stepIndex: number;
  next: string;
  /** The papers this road asks for, and what is on file. */
  papers: { kind: LeadPaperKind; label: string; needed: boolean; files: LeadPaper[] }[];
  /** Photos and files that came in the chat or with a website order, not filed as a paper yet. */
  unsorted: LeadPaper[];
  /** The website order the case was opened for. */
  web: WebOrderView | null;
  points: CasePoints;
  quote: {
    lines: QuoteLine[];
    subtotal: number;
    /** Senior / PWD: the VAT taken out and the 20% off; null on the other roads. */
    relief: { vatRemoved: number; discount: number } | null;
    total: number;
    /** Saved for another road or agency: to be saved again for this one. */
    stale: boolean;
    savedAt: string | null;
  };
  /** How many quotations the agency asks for: PCSO three (ours and two other vendors'), every
   *  other one ours alone (Aryan, 26 Nov, as the old CRM). */
  quotesNeeded: number;
  /** PCSO's quotations 2 and 3 filled from the medicines' canvass prices; null when a quoted
   *  medicine has none, or the medicines name different vendors (then they are typed). */
  canvassAuto: CanvassQuote[] | null;
  order: {
    id: number;
    code: string;
    status: OrderStatus;
    statusLabel: string;
    total: number;
    terms: PaymentTerms;
    /** A proof of payment is on the order. */
    proof: boolean;
    flagReason: string | null;
    invoice: { code: string; state: InvoiceState; balance: number } | null;
    /** What happened to it on the order line, step by step. */
    trail: CaseOrderTrail;
  } | null;
  /** The journey chart's facts, in the shape the old chart reads. */
  journey: {
    lead: Record<string, unknown>;
    rx: Record<string, unknown> | null;
    gl: Record<string, unknown> | null;
    order: Record<string, unknown> | null;
    approved: string[];
  };
  events: { id: number; kind: string; message: string; by: string; at: string }[];
  agents: { id: number; name: string }[];
  /** The customer's other orders and enquiries, on the same number or customer. */
  history: CaseHistory;
  /** When the customer needs their medicines again; null until the case has a customer. */
  refill: Refill | null;
  /** The kinds of business that may buy through the desk, each with the price list it buys from. */
  buyers: { key: BuyerBusiness; label: string; price: string }[];
  can: {
    work: boolean;
    placeOrder: boolean;
    placeWhy: string | null;
    deliver: boolean;
    pay: boolean;
  };
};

/** An Online case's order after it was placed: Management's check (when one was needed), the
 *  packing, the road, the handover and the money. */
export type CaseOrderTrail = {
  check: {
    /** none: nothing needed one; waiting / held / sent_back: with Management; approved: passed. */
    state: "none" | "waiting" | "held" | "sent_back" | "approved";
    by: string | null;
    at: string | null;
    /** What sent it to Management, or why it is held. */
    reasons: string[];
  };
  /** Finance's look after Management (every case's order since 18 Nov): later: Management first;
   *  waiting / held: with Finance; done: let go to Dispatch; off: Management left it out. */
  finance: { state: "later" | "waiting" | "held" | "done" | "off"; by: string | null; at: string | null; reason: string | null };
  packed: { by: string | null; at: string; warehouse: string | null; batches: string[] } | null;
  shipped: { how: string; by: string | null; at: string } | null;
  delivered: { on: string; receivedBy: string | null; by: string | null } | null;
  receiver: string | null;
  receiverPhone: string | null;
  address: string | null;
  pointsUsed: number;
  invoice: {
    id: number;
    code: string;
    total: number;
    paid: number;
    balance: number;
    state: InvoiceState;
  } | null;
  payments: {
    id: number;
    amount: number;
    methodLabel: string;
    reference: string | null;
    paidOn: string;
    by: string;
    /** On a guarantee letter's order: "The agency", "The patient" or "Let go"; null otherwise. */
    who?: string | null;
  }[];
};

export type LeadInput = {
  source: LeadSource;
  name: string;
  relation?: string | null;
  patientName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  road?: LeadRoad;
  agency?: GlAgency | null;
  request?: string | null;
  assignedTo?: number | null;
};

export type QuoteInput = {
  lines: { medicineId: number; qty: number; unitPrice?: number | null; reason?: string | null }[];
};

export type GlInput = {
  appliedOn?: string | null;
  letterNo?: string | null;
  amount?: number | null;
  letterOn?: string | null;
  /** The letter's last day. */
  expiresOn?: string | null;
  verify?: boolean;
};

// ---------------------------------------------------------------- conversations

export type ChatChannel = "messenger" | "email";
export type ChannelKind = ChatChannel | "website";
export type CaseType = "enquiry" | "website_order";

/** A website order as the customer placed it, on its case. Money in centavos. */
export type WebOrderView = {
  id: number;
  site: string;
  ref: string;
  /** The website's status, and in words. */
  status: string;
  statusLabel: string;
  placedAt: string | null;
  adminUrl: string | null;
  paymentMethod: string | null;
  benefit: string | null;
  assistance: string | null;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    matched: boolean;
  }[];
  /** Points the customer used at the website's checkout (1 point = ₱1). */
  pointsRedeemed: number;
  money: {
    subtotal: number;
    vatExempted: number;
    discount: number;
    deliveryFee: number;
    total: number;
  };
  files: { name: string | null; kind: string; fetched: boolean; gaveUp: boolean }[];
  /** What the CRM is telling the website, and why it didn't go. */
  push: { status: string | null; error: string | null; pushedAt: string | null };
};

/** A website's connection, under Channels. */
export type WebsiteStatus = {
  lastCall: { at: string; event: string; outcome: string; error: string | null } | null;
  orders: number;
  /** Orders that have no case (came late, or cancelled before one opened). */
  noCase: {
    id: number;
    ref: string;
    status: string;
    placedAt: string | null;
    note: string | null;
  }[];
  /** Statuses the website refused or didn't take. */
  pushFailing: { id: number; ref: string; status: string; error: string }[];
  refusals: { at: string; event: string; ref: string | null; error: string }[];
  /** The stock link (the old CRM's catalogue push): where it goes, when it last sent, what went
   *  wrong. Off while there is no address. */
  catalog: { url: string | null; sentAt: string | null; sent: number | null; checkedAt: string | null; error: string | null };
};

export type ChatSummary = {
  leadId: number;
  code: string;
  name: string;
  patient: string | null;
  channel: ChatChannel;
  account: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  awaitingReply: boolean;
  unread: boolean;
  owner: string | null;
  step: string;
  lost: boolean;
};

export type InboxFilter = "all" | "needs" | "mine";

export type InboxList = {
  filter: InboxFilter;
  chats: ChatSummary[];
  counts: Record<InboxFilter, number>;
  accounts: { id: number; kind: ChatChannel; name: string }[];
  /** Email senders waiting for "Make enquiry". */
  held: number;
  can: { reply: boolean; manageChannels: boolean };
};

export type ChatFile = { fileId?: number; name?: string; mime?: string; missing?: boolean };

export type ChatLine = {
  id: string;
  kind: "message" | "note";
  direction: "in" | "out" | null;
  text: string;
  subject: string | null;
  files: ChatFile[];
  reaction: string | null;
  /** Who on the desk wrote it; null for theirs, or ours from Facebook's own inbox. */
  by: string | null;
  at: string;
};

export type ChatThread = {
  leadId: number;
  channel: ChatChannel;
  account: string;
  /** Their email address; a Messenger conversation shows the page instead. */
  address: string | null;
  lines: ChatLine[];
  /** They read our messages up to here (Messenger). */
  readAt: string | null;
  lastInboundAt: string | null;
  can: { reply: boolean; why: string | null };
};

export type HeldSender = {
  id: number;
  accountId: number;
  mailbox: string;
  address: string;
  name: string | null;
  subject: string;
  snippet: string;
  count: number;
  at: string;
};

export type ChannelStatus = {
  id: number;
  kind: ChannelKind;
  key: string;
  name: string;
  intake: "screen" | "all";
  active: boolean;
  connectedAt: string;
  syncedAt: string | null;
  syncError: string | null;
  /** Webhook events waiting to be worked, and those that kept failing. */
  waiting: number;
  failed: number;
  held: number;
  website: WebsiteStatus | null;
};

export type ChannelsData = {
  channels: ChannelStatus[];
  /** Webhook events for a page nobody connected yet, by page id. */
  unrouted: { page: string; count: number }[];
  webhook: { path: string; websitePath: string; secretSet: boolean; verifyTokenSet: boolean };
  /** A developer's computer: Meta and the mail servers are answered locally. */
  sink: { messenger: boolean; mail: boolean };
  can: { manage: boolean };
};

// ---------------------------------------------------------------- settings, points, quotation

/** What the company's papers print. */
export type CompanyInfo = {
  name: string;
  address: string;
  phone: string;
  email: string;
  tin: string;
  /** VAT-registered. */
  vat: boolean;
  /** The FDA licence (LTO). */
  licence: string;
  /** The line at the foot of every page. */
  footer: string;
  signatory: string;
  signatoryTitle: string;
};

export type PointsProgram = { enabled: boolean; rateBps: number };

export type PointsAccountRow = {
  id: number;
  name: string;
  phoneKey: string;
  /** The phone with all but its last four digits hidden. */
  phone: string;
  customerId: number | null;
  balance: number;
  earned: number;
  spent: number;
  lastAt: string | null;
};

export type PointsEntryRow = {
  id: number;
  kind: "earn" | "spend" | "release" | "adjust";
  kindLabel: string;
  points: number;
  reference: string | null;
  note: string | null;
  orderId: number | null;
  by: string | null;
  at: string;
};

export type PointsList = {
  program: PointsProgram;
  accounts: PointsAccountRow[];
  totals: { accounts: number; balance: number; earned: number };
  can: { adjust: boolean; program: boolean };
};

export type PointsAccountDetail = {
  account: PointsAccountRow;
  entries: PointsEntryRow[];
  can: { adjust: boolean };
};

/** The customer's points on a case. */
export type CasePoints = {
  program: PointsProgram;
  accountId: number | null;
  balance: number;
  /** Points the case will use on its order. */
  toUse: number;
  /** Why points can't be used on this case (the senior / PWD and GL roads, a business). */
  why: string | null;
};

/** A step of an order the customer hears of (by email on its own; by WhatsApp, Viber, SMS or Messenger from "Send to customer"). */
export type TellEvent = "confirmed" | "shipped" | "delivered" | "paid";

export type CustomerUpdate = {
  event: TellEvent;
  title: string;
  /** What makes this update itself (a second payment is a second email). */
  label: string;
  subject: string;
  /** The email, in the old CRM's plain-text layout. */
  text: string;
  /** The same news in a few lines, for WhatsApp, Viber, SMS and Messenger. */
  short: string;
  email: string | null;
  phone: string | null;
  leadId: number | null;
  /** The case talks on Messenger: the short text can go there. */
  messenger: boolean;
  /** When this update was last emailed (null: not yet). */
  emailedAt: string | null;
};

/** One line of a printed document (sales order, invoice), as Zoho prints it. */
export type DocLine = {
  id: number;
  /** "VancoGet 1g": the medicine with its strength. */
  item: string;
  strength: string | null;
  form: string | null;
  /** "20%" on a senior citizen / PWD line. */
  discount: string | null;
  qty: number;
  /** Centavos for one piece. */
  unitPrice: number;
  amount: number;
  vat: Vat;
  free: boolean;
};

/** An order printed as Zoho's Sales Order (the "2MG Template"). */
export type SalesOrderDoc = {
  order: {
    id: number;
    code: string;
    status: OrderStatus;
    /** The ribbon: Draft, Pending Approval, Confirmed, On Hold, Closed, Void. */
    ribbon: string;
    customerId: number;
    customer: string;
    /** The Ship To lines under the customer's name. */
    shipTo: string[];
    orderDate: string;
    terms: string;
    expectedOn: string | null;
    ref: string | null;
    deliveryMethod: string | null;
    salesperson: string;
    /** "INVOICED", "NOT INVOICED", "PAID". */
    invoiceStatus: string;
    /** "PENDING", "SHIPPED", "FULFILLED", "VOID". */
    shipment: string;
    notes: string[];
    customFields: [string, string][];
    deliveryFee: number;
    total: number;
    invoiceFrom: InvoiceFrom;
    invoiceFromLabel: string;
    invoiceId: number | null;
    invoiceCode: string | null;
  };
  company: CompanyInfo;
  items: DocLine[];
  /** Zoho's tax lines: "Vat (12%)" (the VAT inside the prices), "No Tax (0%)", "Zero Rated (0%)". */
  tax: { vat: number; vatLines: boolean; exempt: boolean; zeroRated: boolean };
};

/** A case's customer: their orders and their other enquiries, newest first. */
export type CaseHistory = {
  /** The mobile number's last ten digits: who they are. */
  number: string | null;
  customerId: number | null;
  orders: {
    id: number;
    code: string;
    total: number;
    status: OrderStatus;
    statusLabel: string;
    at: string;
    leadId: number | null;
    medicines: string | null;
    invoiceBalance: number | null;
  }[];
  enquiries: {
    id: number;
    code: string;
    state: string;
    at: string;
    orderCode: string | null;
    request: string | null;
  }[];
  ordersTotal: number;
  enquiriesTotal: number;
};

/** One order (and price) on which a customer was given a medicine. */
export type PriceRow = {
  /** The order's day (YYYY-MM-DD, Manila). */
  at: string;
  code: string;
  /** This CRM's order to open; none for an order from Zoho. */
  orderId: number | null;
  from: "crm" | "zoho";
  /** Paid pieces at `unitPrice`, and the pieces that came free on the same order. */
  qty: number;
  freeQty: number;
  /** Centavos for one piece, VAT in; none when everything on it was free. */
  unitPrice: number | null;
};

/** What a customer was given before for one medicine, newest first. */
export type MedicinePrices = {
  key: string;
  /** The medicine here, once it is listed (a Zoho line finds it by its SKU). */
  medicineId: number | null;
  sku: string | null;
  name: string;
  unit: string | null;
  /** Orders it was on, and the pieces in all (free ones included). */
  times: number;
  qty: number;
  freeQty: number;
  lastAt: string;
  /** The last price paid for one piece. */
  lastPrice: number | null;
  rows: PriceRow[];
};

/** A customer's prices, and their orders from before this CRM (Zoho). */
export type CustomerPrices = {
  past: { orders: number; bought: number; firstOn: string | null; lastOn: string | null };
  /** As Zoho had them: whose customer it was (the salesperson of their latest order, its
   *  Division, Sub-division and Headquarter), and what Zoho's invoices still show as owed
   *  (centavos), on how many invoices, the oldest due day. */
  zoho: {
    seller: string | null;
    division: string | null;
    subDivision: string | null;
    headquarter: string | null;
    owed: number;
    openInvoices: number;
    oldestDue: string | null;
  };
  orders: {
    id: number;
    code: string;
    on: string;
    status: string;
    total: number;
    seller: string | null;
    medicines: string | null;
  }[];
  /** The old system's invoices, newest first, with what each still owes (centavos). */
  invoices: { id: number; number: string; on: string; dueOn: string | null; order: string | null; total: number; balance: number; status: "paid" | "open" | "void" }[];
  /** The payments the old system took from them, newest first. */
  payments: { id: number; number: string | null; on: string; mode: string | null; reference: string | null; amount: number }[];
  medicines: MedicinePrices[];
};

/** For an order being decided: the customer in short, and for each of its lines (by the line's
 *  id) what this customer was given before. */
export type OrderPrices = {
  customer: {
    id: number;
    /** Orders before this one, Zoho's included, and what they came to (centavos). */
    orders: number;
    bought: number;
    firstOn: string | null;
    lastOn: string | null;
    lastCode: string | null;
    /** Of the orders: this CRM's, and Zoho's from before it. */
    crmOrders: number;
    zohoOrders: number;
    /** What they owe now (Zoho's invoices and opening balance with this CRM's), how much of it is
     *  past due and how late the oldest is, and how much of it is in Zoho. */
    owed: number;
    overdue: number;
    overdueDays: number;
    zohoOwed: number;
    top: {
      key: string;
      name: string;
      times: number;
      qty: number;
      unit: string | null;
      lastPrice: number | null;
    }[];
  };
  lines: Record<number, MedicinePrices | null>;
};

/** One customer's whole story: everything a page about a hospital, doctor, buyer or patient shows. */
export type CustomerPage = CustomerDetail & {
  /** Who looks after them and the people above: the MedRep (or the desk agent), their manager, the head. */
  line: { name: string; title: string | null; role: string }[];
  totals: {
    orders: number;
    bought: number;
    /** With what Zoho's invoices and opening balance still have them owing. */
    owed: number;
    overdue: number;
    /** Of owed and overdue, what is in Zoho (its unpaid invoices, its opening balance). */
    zohoOwed: number;
    zohoOverdue: number;
    /** How late Zoho's oldest unpaid amount is (an opening balance counts as a year). */
    zohoDays: number;
    paid: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  };
  orders: {
    id: number;
    code: string;
    status: OrderStatus;
    statusLabel: string;
    total: number;
    at: string;
    medrep: string;
    raisedBy: string;
    medicines: string | null;
    leadId: number | null;
    invoice: { id: number; code: string; balance: number; state: InvoiceState } | null;
  }[];
  medicines: {
    id: number;
    name: string;
    strength: string | null;
    unit: string | null;
    times: number;
    qty: number;
    freeQty: number | null;
    amount: number;
    lastAt: string;
    lastPrice: number | null;
  }[];
  invoices: {
    id: number;
    code: string;
    orderId: number;
    orderCode: string;
    issuedOn: string;
    dueOn: string;
    total: number;
    paid: number;
    balance: number;
    state: InvoiceState;
  }[];
  payments: {
    id: number;
    amount: number;
    method: PaymentMethod;
    methodLabel: string;
    reference: string | null;
    paidOn: string;
    invoiceId: number;
    invoiceCode: string;
    by: string;
  }[];
  /** Their enquiries at the Online desk (on their number too); null for those who can't see the desk. */
  cases:
    | {
        id: number;
        code: string;
        state: string;
        at: string;
        request: string | null;
        orderCode: string | null;
        owner: string | null;
      }[]
    | null;
  /** What happened lately on their orders. */
  events: {
    id: number;
    message: string;
    by: string;
    at: string;
    orderId: number;
    orderCode: string;
  }[];
  /** A patient's points, by their number. */
  points: { balance: number } | null;
  /** When they need their medicines again. */
  refill: Refill;
};

export type MyKpisPeriod = "today" | "yesterday" | "day" | "month";

/** A MedRep's own figures for a day or this month (their Home). */
export type MyKpis = {
  period: MyKpisPeriod;
  /** The day shown (today, yesterday or the day picked). */
  day: string;
  today: string;
  /** Orders submitted in the period, and their value (cancelled ones not counted in the value). */
  submitted: number;
  submittedValue: number;
  /** Of those: waiting for Management or Finance (or held). */
  pending: number;
  /** Being packed or on the way. */
  fulfilment: number;
  completed: number;
  completedValue: number;
  cancelled: number;
  /** Customers they added in the period. */
  newCustomers: number;
  todayOrders: number;
  todayValue: number;
  monthOrders: number;
  monthValue: number;
  orders: {
    id: number;
    code: string;
    customer: string;
    customerKind: CustomerKind;
    total: number;
    status: OrderStatus;
    statusLabel: string;
    at: string;
    lines: string | null;
    /** Management changed its lines before approving. */
    changed: boolean;
  }[];
  /** This month's scorecard from the scorecard engine (the seat's playbook card). */
  scorecard: {
    card: string;
    month: string;
    total: number;
    /** Points of the KPIs with something to measure (a KPI with no data is left out). */
    max: number;
    status: "strong" | "watch" | "review" | "none";
    /** IST at 60% or less: the total is capped at 40. */
    capped: boolean;
    kpis: {
      code: string;
      label: string;
      value: number | null;
      unit: "%" | "days" | "count";
      weight: number;
      points: number | null;
      note: string;
    }[];
  };
};

/** The company's figures for Management's Home: the period's orders as a MedRep's Home counts
 *  them, what waits now, this month's sales against the targets, and who sold what. */
export type CompanyKpis = Omit<MyKpis, "orders" | "scorecard"> & {
  /** Customers MedReps added that Management hasn't checked yet. */
  toReview: number;
  /** Invoiced this month (not cancelled), and every MedRep's target for the month added up. */
  sales: number;
  target: number;
  /** Waiting for Management now, and since when (the oldest). */
  waiting: number;
  oldestWaiting: string | null;
  onHold: number;
  toPack: number;
  onTheWay: number;
  byRep: {
    id: number;
    name: string;
    channel: string | null;
    orders: number;
    value: number;
    completed: number;
  }[];
  byChannel: { channel: string; orders: number; value: number }[];
};

/** "Medicine not available": asked for by someone outside Inventory. */
export type MedicineRequestInput = {
  /** The catalogue's medicine when we list it (out of stock); empty for one we don't list. */
  medicineId?: number | null;
  name: string;
  strength?: string | null;
  qty?: number | null;
  customerId?: number | null;
  note?: string | null;
};

export type MedicineRequest = {
  id: number;
  code: string;
  medicineId: number | null;
  name: string;
  strength: string | null;
  /** How many times it was asked for, and the pieces asked for altogether. */
  times: number;
  qty: number;
  status: "open" | "ordered" | "added" | "declined";
  askedAt: string;
  lastAskedAt: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  /** Sellable pieces now, when it is a medicine we list. */
  inStock: number;
  asks: {
    id: number;
    by: string;
    customer: string | null;
    customerId: number | null;
    qty: number | null;
    note: string | null;
    at: string;
  }[];
};

export type MedicineRequests = {
  show: "open" | "answered";
  can: { answer: boolean };
  counts: { open: number; answered: number };
  rows: MedicineRequest[];
};

/** The bell: a person's latest notifications, newest first, and how many aren't read. */
export type NotificationList = {
  unread: number;
  rows: {
    id: number;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    at: string;
    read: boolean;
  }[];
};

/** Dispatch's Home: what waits in the warehouse now, and the work done in a day or this month. */
export type DispatchKpis = {
  period: MyKpisPeriod;
  day: string;
  today: string;
  now: {
    toPack: number;
    toShip: number;
    /** Came back undelivered, still packed, to go out again. */
    cameBack: number;
    onTheWay: number;
    deliveredToday: number;
    /** To pack or to ship whose delivery day is today or past. */
    dueToday: number;
    /** Taken by this person and not gone yet. */
    mine: number;
    oldestToPack: string | null;
    oldestToShip: string | null;
    oldestOnTheWay: string | null;
  };
  work: {
    packed: number;
    shipped: number;
    delivered: number;
    cameBack: number;
    pieces: number;
    /** From reaching Dispatch to leaving, on average (minutes); null when nothing left. */
    avgMinutes: number | null;
  };
  byCourier: { courier: string; orders: number }[];
};

/** One order on Dispatch's work board, with only what the warehouse needs at its step. */
export type DispatchCard = {
  id: number;
  code: string;
  customerId: number;
  customer: string;
  customerKind: CustomerKind;
  /** Whose order it is (to call if something is wrong). */
  medrep: string;
  address: string | null;
  receiver: string | null;
  receiverPhone: string | null;
  expectedOn: string | null;
  warehouse: string | null;
  /** The note on the order ("Deliver before noon"). */
  note: string | null;
  status: OrderStatus;
  pieces: number;
  /** What to pick. */
  /** `cold`: kept cold (Inventory's cold-chain mark), packed cold. */
  items: { name: string; qty: number; packSize: number; unit: string | null; free: boolean; cold: boolean }[];
  /** What is in the box, batch by batch (once packed). */
  picks: { medicine: string; batchNo: string; expiresOn: string; qty: number }[];
  papers: PaperKind[];
  method: DeliveryMethod | null;
  courier: string | null;
  tracking: string | null;
  rider: string | null;
  shippedAt: string | null;
  stepSince: string;
  dispatchBy: string | null;
  dispatchById: number | null;
  cameBack: boolean;
  cameBackCount: number;
  cameBackReason: string | null;
  receivedBy: string | null;
  deliveredAt: string | null;
  /** The day it reached the customer, as Dispatch said it (not the moment it was marked). */
  deliveredOn: string | null;
  /** Cash the courier or rider collects on delivery (an open cash-on-delivery invoice). */
  collect: number | null;
  /** How it is paid, from its invoice: cash on delivery, paid in advance, or on terms (days or a
   *  date); what it comes to, what is still owed, paid or not, and when it falls due. */
  pay: {
    terms: "advance" | "cod" | "days";
    days: number | null;
    payBy: string | null;
    total: number;
    balance: number;
    paid: boolean;
    dueOn: string | null;
  } | null;
  /** The cash on delivery Dispatch noted: how much, who has it, the day noted. */
  cod: { amount: number; by: string; on: string } | null;
};

export type DispatchBoard = {
  today: string;
  counts: {
    toPack: number;
    toShip: number;
    road: number;
    delivered: number;
    /** Delivered over the last `doneDays` days. */
    done: number;
    held: number;
    coming: number;
  };
  toPack: DispatchCard[];
  toShip: DispatchCard[];
  road: DispatchCard[];
  /** Delivered today. */
  delivered: DispatchCard[];
  /** Delivered over the last `doneDays` days, newest first. */
  done: DispatchCard[];
  doneDays: number;
  can: { work: boolean };
};

/** An order on Finance's board: checking its payment, or making its invoice. */
export type FinanceOrderCard = {
  id: number;
  code: string;
  customerId: number;
  customer: string;
  customerKind: CustomerKind;
  medrep: string;
  total: number;
  /** What the customer pays in money (the total less the points used). */
  due: number;
  terms: PaymentTerms;
  paymentDays: number | null;
  /** The Payment Terms as agreed ("PDC 30"). */
  paymentTerm: string | null;
  creditLimit: number | null;
  /** What the customer already owes on other invoices, and how much of it is past due. */
  owed: number;
  overdue: number;
  stepSince: string;
  note: string | null;
  customerPo: string | null;
  /** The newest proof of payment on the order. */
  proofId: number | null;
  proofMime: string | null;
};

/** An open invoice to collect. */
export type FinanceCollect = {
  invoiceId: number;
  code: string;
  orderId: number;
  orderCode: string;
  customerId: number;
  customer: string;
  medrep: string;
  terms: "advance" | "cod" | "days";
  total: number;
  balance: number;
  dueOn: string;
  /** Days past its due day (0 or less: not late). */
  daysLate: number;
  delivered: boolean;
  deliveryMethod: DeliveryMethod | null;
  courier: string | null;
  rider: string | null;
  lastPaidOn: string | null;
};

export type FinanceBoard = {
  today: string;
  /** 1. Advance orders: the payment to check. */
  check: FinanceOrderCard[];
  /** 2. Credit and cash-on-delivery orders: the invoice to make. */
  invoice: FinanceOrderCard[];
  /** 3. Open invoices to collect, the latest past due first. */
  collect: FinanceCollect[];
  money: {
    inToday: number;
    inMonth: number;
    invoicedMonth: number;
    owed: number;
    overdue: number;
    /** Cash on delivery not delivered yet (not owed yet). */
    onDelivery: number;
    refunds: number;
    held: number;
    /** Waiting for Management: coming to Finance next. */
    coming: number;
    toCollect: number;
  };
  can: { work: boolean };
};

// ---- The company as units and seats (org). A seat is a job that stays when its person leaves. ----

export type OrgUnitKind = "company" | "business" | "line" | "team" | "department";

/** Someone sitting in a seat: its holder, or an acting cover with an end day. */
export type OrgHolder = {
  /** The holding's own id (to end a cover). */
  id: number;
  personId: number;
  name: string;
  email: string | null;
  phone: string | null;
  kind: "holder" | "acting";
  startsOn: string;
  endsOn: string | null;
  /** Holds more than this seat (a second seat, or covering another). */
  otherSeats: number;
  /** Those other seats in words: "Covers Area manager · Mindanao". */
  elsewhere: string | null;
  /** Has to change the password given to them before working. */
  newLogin: boolean;
};

export type OrgSeat = {
  id: number;
  unitId: number;
  /** The seat's login ID without the domain: "hos1". */
  login: string | null;
  title: string;
  module: Role;
  moduleLabel: string;
  lead: boolean;
  area: { id: number; name: string; cities: string[] } | null;
  reportsToSeatId: number | null;
  /** Whom the seat reports to today (a vacant boss seat is skipped). */
  boss: string | null;
  holder: OrgHolder | null;
  acting: OrgHolder | null;
  /** Customers in the seat's area. */
  customers: number;
  /** Orders sold from this seat that are still open. */
  openOrders: number;
};

export type OrgUnit = {
  id: number;
  name: string;
  kind: OrgUnitKind;
  parentId: number | null;
  channel: { id: number; code: string; name: string } | null;
  /** The business line its sales are reported under, when it is not its channel's (CLIDP). */
  reportChannel: string | null;
  sort: number;
  seats: OrgSeat[];
};

export type OrgTree = {
  today: string;
  /** Seat login IDs end in this: "hos1@2mginc.com". */
  loginDomain: string;
  units: OrgUnit[];
  /** People with a login but no seat. */
  unplaced: {
    id: number;
    name: string;
    email: string | null;
    role: Role;
    roleLabel: string;
    title: string | null;
  }[];
  channels: { id: number; code: string; name: string; division: string | null; active: boolean }[];
  /** Every area, and the seat that holds it. */
  areas: {
    id: number;
    name: string;
    channelId: number;
    cities: string[];
    seatId: number | null;
    /** Customers in it. */
    customers: number;
  }[];
  /** Team leads' asks for a new person or seat, open ones first. */
  requests: SeatRequest[];
  modules: { value: Role; label: string }[];
  can: { change: boolean };
};

/** Add a new person: their login and the seat they sit in (a new one, or a vacant one). */
export type OrgPersonInput = {
  name: string;
  /** Their own email, to reach them (optional): they sign in with the seat's login ID. */
  email?: string | null;
  phone?: string | null;
  /** Empty: one is made and shown once. */
  password?: string | null;
  /** Into this vacant seat; else a new seat with the fields below. */
  seatId?: number | null;
  unitId?: number | null;
  title?: string | null;
  module?: Role | null;
  lead?: boolean;
  reportsToSeatId?: number | null;
  areaId?: number | null;
  newArea?: { name: string; cities: string[] } | null;
  startsOn?: string | null;
  /** The company's employee ID ("2MG-0042"), when HR has it. */
  employeeCode?: string | null;
};

export type OrgSeatInput = {
  unitId: number;
  title: string;
  module: Role;
  lead?: boolean;
  reportsToSeatId?: number | null;
  areaId?: number | null;
  newArea?: { name: string; cities: string[] } | null;
};

export type OrgUnitInput = {
  name: string;
  kind: Exclude<OrgUnitKind, "company">;
  parentId: number;
  channelId?: number | null;
};

/** What adding a person or resetting a password answers: the password, shown once. */
export type OrgLogin = {
  personId: number;
  seatId: number | null;
  /** What they type to sign in: the seat's login ID ("hos3@2mginc.com"). */
  login: string | null;
  email: string | null;
  password: string | null;
};

/** One person's seats now and before, for their page. */
export type OrgPersonHistory = {
  person: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    active: boolean;
    role: Role;
    title: string | null;
  };
  holdings: {
    id: number;
    seatId: number;
    seat: string;
    unit: string;
    kind: "holder" | "acting";
    startsOn: string;
    endsOn: string | null;
    reason: string | null;
    by: string | null;
    endReason: string | null;
    endedBy: string | null;
  }[];
};

// ---- A team lead's (or head's) team: each seat under them, its month and its open work. ----

/** One seat under the lead: who sits in it (or nobody), its figures for the days picked, and
 *  where its orders stand now. */
export type TeamSeatCard = {
  seatId: number;
  login: string | null;
  unitId: number;
  title: string;
  moduleLabel: string;
  lead: boolean;
  area: { name: string; cities: string[] } | null;
  person: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    since: string;
  } | null;
  /** Someone covering the seat until a day. */
  acting: { name: string; until: string | null } | null;
  /** The holder's monthly targets, shared out over the days picked. */
  target: number | null;
  /** Invoiced in the days picked (what the target counts), and today. */
  sold: number;
  today: number;
  /** Money received in the days picked (points left out). */
  collected: number;
  placed: number;
  placedValue: number;
  delivered: number;
  /** Customers of its area added in the days picked. */
  newCustomers: number;
  /** Sold each day of the days picked, for a small chart. */
  spark: number[];
  /** Open orders by where they stand now. */
  stages: {
    management: number;
    finance: number;
    dispatch: number;
    road: number;
    held: number;
    sentBack: number;
  };
  /** The open order waiting longest at its step. */
  oldest: { status: OrderStatus; since: string } | null;
  owed: number;
  overdue: number;
  customers: number;
  lastOrderAt: string | null;
};

/** The customers of a lead's team or of one box of it (19 Nov): each with its buying, the usual
 *  gap between its orders, what it owes and the last call; counted by state and by city. */
export type TeamAccounts = {
  today: string;
  counts: {
    accounts: number;
    /** Bought this month. */
    buying: number;
    /** First order ever this month. */
    new: number;
    due: number;
    late: number;
    stopped: number;
    lost: number;
    /** Called at least once (a call logged on the account). */
    called: number;
  };
  /** Where they buy: the cities with the most sold in the last 12 months. */
  cities: { city: string; accounts: number; soldYear: number }[];
  rows: {
    customerId: number;
    name: string;
    kind: string;
    city: string | null;
    /** Who holds the seat of the customer's area in the team. */
    seller: string | null;
    firstOn: string | null;
    lastOrderOn: string | null;
    since: number | null;
    usual: number | null;
    soldMonth: number;
    soldYear: number;
    owed: number;
    overdue: number;
    lastCallOn: string | null;
    lastOutcome: string | null;
    /** never ordered · new this month · due within a week · late (past 1.5× its gap) · stopped (90+
     *  days) · lost (180+) · ok. */
    state: "never" | "new" | "due" | "late" | "stopped" | "lost" | "ok";
  }[];
};

/** Something under the lead that needs them, the most urgent first. */
export type TeamNeed = {
  kind: "sent_back" | "held" | "late" | "overdue" | "vacant" | "score";
  orderId: number | null;
  code: string | null;
  customer: string | null;
  customerId: number | null;
  /** Whose seat it is: the person, else the seat's title and area. */
  who: string;
  seatId: number | null;
  why: string;
  /** Since when it has waited. */
  since: string | null;
  amount: number | null;
};

export type TeamStep = "management" | "finance" | "dispatch" | "road";

export type TeamBoard = {
  today: string;
  /** The days picked (Manila), both included, and how much of them has gone (for the pace). */
  from: string;
  to: string;
  days: number;
  pace: number;
  /** Who is looking, and the boxes their team is in (for a head, several teams). */
  lead: { name: string; title: string | null; units: string[]; covering: string[] };
  /** The box looked at (one asked for, or the company for the CEO). */
  viewing: string | null;
  /** The top boxes of the view, and the line from the top down to the one looked at. */
  rootIds: number[];
  path: { id: number; name: string }[];
  units: {
    id: number;
    name: string;
    kind: OrgUnitKind;
    parentId: number | null;
    leadSeatId: number | null;
    /** The sales tracker's channel the box is part of (RX Business … MT), null outside sales. */
    division: string | null;
    /** The channel's name as the target sheet writes it, when the box's seats are all on one (B2B
     *  for the B2B Telesales box, BID for Government Bidding); null otherwise. */
    sheetName?: string | null;
  }[];
  seats: TeamSeatCard[];
  needs: TeamNeed[];
  totals: {
    target: number | null;
    sold: number;
    today: number;
    collected: number;
    placed: number;
    placedValue: number;
    delivered: number;
    newCustomers: number;
    waiting: number;
    stopped: number;
    owed: number;
    overdue: number;
    vacant: number;
    people: number;
  };
  stagesNow: TeamSeatCard["stages"];
  /** Each day picked: sold (invoiced), placed (value) and collected. */
  daily: { day: string; sold: number; placed: number; collected: number }[];
  topMedicines: { name: string; qty: number; value: number }[];
  byKind: { kind: CustomerKind; customers: number; orders: number; value: number }[];
  /** How long orders stood at each step, for those that left it in the days picked. */
  stepTimes: { step: TeamStep; minutes: number; orders: number }[];
};

/** The map's territories: each area in view, the map shapes its cities cover, its seat and lead. */
export type TeamTerritories = {
  territories: {
    seatId: number;
    title: string;
    areaId: number;
    area: string;
    channel: string | null;
    cities: string[];
    holder: string | null;
    /** Who the seat reports to (its lead's holder). */
    lead: string | null;
    /** The places its cities read as, and the map's shapes (PSGC codes) they cover. */
    places: string[];
    shapes: string[];
    /** Names that couldn't be read as a place: a person puts them right on the area. */
    unread: string[];
  }[];
};

// ---- Messages between the people of the company ----

export type MessageKind = "direct" | "group" | "announcement";

export type MessageThreadRow = {
  id: number;
  kind: MessageKind;
  /** The other person for a direct thread; the team or the title otherwise. */
  title: string;
  /** Who it went to, in words: "NCR 1 (4 people)", "Everyone", "Ryan". */
  to: string;
  members: number;
  last: { by: string; body: string; at: string } | null;
  unread: number;
  /** An announcement this person hasn't read. */
  createdBy: string;
};

export type MessageThreads = { threads: MessageThreadRow[]; unread: number };

export type MessageThread = MessageThreadRow & {
  messages: { id: number; byId: number; by: string; body: string; at: string; mine: boolean }[];
  /** Who is on it and whether they have read the latest (an announcement's "seen by"). */
  people: { id: number; name: string; title: string | null; read: boolean }[];
  can: { reply: boolean };
};

/** Whom this person can write to. */
export type MessageAddressBook = {
  people: {
    id: number;
    name: string;
    title: string | null;
    login: string | null;
    team: string | null;
  }[];
  /** Teams they may write to (a lead their own and those under; the CEO and the Admin any). */
  units: { id: number; name: string; people: number }[];
  can: { everyone: boolean; announce: boolean };
};

export type MessageInput = {
  to:
    | { kind: "person"; personId: number }
    | { kind: "people"; personIds: number[] }
    | { kind: "unit"; unitId: number }
    | { kind: "everyone" };
  /** One way: they read it, they don't reply. */
  announcement?: boolean;
  title?: string | null;
  body: string;
};

/** A team lead's ask for a new person (or an empty seat) in their team. */
export type SeatRequest = {
  id: number;
  /** A new person (or empty seat), a new region (a team under the lead's), or a new area. */
  kind: "seat" | "region" | "area";
  unitId: number;
  unit: string;
  /** The seat's work (a person's ask only). */
  module: Role | null;
  /** The seat's title, or the new region's or area's name. */
  title: string;
  /** Who leads the new region (one of the team, keeping their seat). */
  leadPerson: string | null;
  /** Which seat gets the new area ("Ryan (MedRep · NCR 1)"). */
  forSeat: string | null;
  area: string | null;
  newArea: { name: string; cities: string[] } | null;
  personName: string | null;
  personPhone: string | null;
  reason: string | null;
  status: "open" | "approved" | "declined";
  askedBy: string;
  askedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  answer: string | null;
};

export type SeatRequestInput = {
  kind?: "seat" | "region" | "area";
  unitId: number;
  /** A person's ask: their work. */
  module?: "medrep" | "team_lead";
  /** A new region's name. */
  name?: string | null;
  /** A new region: who of the team leads it. */
  leadPersonId?: number | null;
  /** A new area: the seat (with no area yet) that gets it. */
  forSeatId?: number | null;
  title?: string | null;
  areaId?: number | null;
  newArea?: { name: string; cities: string[] } | null;
  personName?: string | null;
  personPhone?: string | null;
  reason?: string | null;
};

/** What a team lead may ask for: their teams, and the free areas of their channels. */
export type SeatRequestForm = {
  units: { id: number; name: string; channel: string | null }[];
  areas: { id: number; name: string; channelId: number; cities: string[] }[];
  /** The people of the lead's teams (who may lead a new region). */
  people: { id: number; name: string; title: string; unit: string }[];
  /** The seats of the lead's teams with no area yet (which may get a new one). */
  seats: { id: number; title: string; unit: string; unitId: number; holder: string | null }[];
  mine: SeatRequest[];
};

// ---- Speed: how long each desk keeps an order, and who is slow ----

export type SpeedStep = "management" | "finance" | "dispatch" | "road" | "fix";

export type SpeedReport = {
  from: string;
  to: string;
  /** Whose orders: the whole company, or a team lead's team. */
  scope: string;
  steps: {
    step: SpeedStep;
    /** Orders that passed this step in the days picked. */
    orders: number;
    avgMinutes: number;
    medianMinutes: number;
    p90Minutes: number;
    /** Passed later than the step's limit. */
    late: number;
    lateAfterMinutes: number;
  }[];
  /** Placed to delivered, for orders delivered in the days picked. */
  endToEnd: { orders: number; avgMinutes: number; medianMinutes: number };
  /** Who did each step and how fast (Management, Finance, Dispatch; MedReps fixing sent-back orders). */
  people: {
    personId: number;
    name: string;
    step: SpeedStep;
    orders: number;
    avgMinutes: number;
    medianMinutes: number;
    late: number;
  }[];
  /** On the road, by courier or rider. */
  couriers: { how: string; orders: number; avgMinutes: number; late: number }[];
  /** Each day: the average minutes at each desk (null on a day nothing passed). */
  daily: {
    day: string;
    management: number | null;
    finance: number | null;
    dispatch: number | null;
  }[];
  /** The slowest passes in the days picked. */
  slowest: {
    orderId: number;
    code: string;
    customer: string;
    step: SpeedStep;
    minutes: number;
    by: string | null;
  }[];
  /** Orders waiting at each desk right now, and the oldest wait. */
  waitingNow: { step: SpeedStep; orders: number; oldestMinutes: number; late: number }[];
};

/** A team the sidebar lists under Company (the CEO) or My team (a lead): level 0 a division (or
 *  the box the lead leads), level 1 a box right under it. */
export type OrgMenuUnit = {
  id: number;
  name: string;
  level: number;
  topId: number;
  /** The box above it (null at the top of the company). */
  parentId: number | null;
  /** Who sits in its lead seat, if anyone. */
  lead: string | null;
  people: number;
};

/** What a MedRep's customers owe on his orders, oldest due first, and by how late. */
export type ToCollect = {
  total: number;
  buckets: {
    key: "not_due" | "d30" | "d60" | "older";
    label: string;
    amount: number;
    invoices: number;
  }[];
  rows: {
    invoiceId: number;
    invoiceCode: string;
    orderId: number;
    orderCode: string;
    customerId: number;
    customer: string;
    balance: number;
    dueOn: string | null;
    /** Days past due (0 or less: not due yet). */
    daysLate: number;
  }[];
};

/** A customer's statement of account for some days: what was billed, paid and refunded, with the
 *  balance before, after each line and at the end. Centavos. */
export type Statement = {
  company: CompanyInfo;
  customer: {
    id: number;
    code: string;
    name: string;
    address: string | null;
    tin: string | null;
    terms: string;
  };
  from: string;
  to: string;
  opening: number;
  lines: {
    day: string;
    kind: "invoice" | "payment" | "refund";
    ref: string;
    note: string | null;
    /** Billed (raises the balance). */
    debit: number;
    /** Paid (lowers it). */
    credit: number;
    balance: number;
  }[];
  closing: number;
  /** Open now, by how late. */
  aging: { current: number; d30: number; d60: number; older: number };
};

/** Every unpaid invoice, one line each: whose (customer, MedRep, team), when it was made and the day
 *  it was due, how late, what is left. Cash on delivery not delivered yet is kept apart. */
/** Later payments that came in (cash on delivery, credit): Finance's "Collected" list. */
export type CollectedLater = {
  rows: {
    invoiceId: number;
    invoiceCode: string;
    orderId: number;
    orderCode: string;
    customer: string;
    medrep: string;
    terms: string;
    total: number;
    /** The day the last of the money came in, and who recorded it. */
    paidOn: string;
    by: string;
    delivered: boolean;
  }[];
};

export type OwedInvoices = {
  today: string;
  rows: {
    /** Below zero: an invoice from Zoho, in the books (its id there is the same number, positive). */
    invoiceId: number;
    invoiceCode: string;
    orderId: number | null;
    orderCode: string | null;
    customerId: number;
    customer: string;
    kind: CustomerKind;
    city: string | null;
    medrepId: number | null;
    medrep: string;
    team: string | null;
    issuedOn: string;
    /** The day we gave them to pay by (credit: counted from delivery). */
    dueOn: string | null;
    deliveredOn: string | null;
    terms: string;
    total: number;
    paid: number;
    balance: number;
    /** late: past its day; due: not yet; on_delivery: cash on delivery, goods not delivered yet. */
    state: "late" | "due" | "on_delivery";
    daysLate: number;
    /** Cash on delivery Dispatch noted as collected: how much, who has it, the day noted. Finance
     *  records the payment once it is in the bank. */
    codCash: { amount: number; by: string; on: string } | null;
  }[];
  totals: {
    owed: number;
    overdue: number;
    onDelivery: number;
    invoices: number;
    customers: number;
  };
};

/** What customers owe, in short, for the Home's card: the same invoices as OwedInvoices, added up
 *  on the server so the card doesn't download every invoice (22 Nov). */
export type OwedGlance = {
  today: string;
  totals: OwedInvoices["totals"];
  /** Not due yet, 1–30 days late, 31–60 days, over 60 days: what is owed in each (not cash on delivery to come). */
  ages: { notDue: number; d30: number; d60: number; older: number };
  /** Who owes, the most overdue first (at most 100). */
  customers: { id: number; name: string; medrep: string; team: string | null; total: number; late: number; oldest: number; invoices: number }[];
};

/** One channel's sales, opened: each of its sellers against their target, its best customers and
 *  medicines, for the month (invoiced, as Sales this month counts). */
export type ChannelSalesDetail = {
  people: {
    id: number;
    name: string;
    area: string | null;
    sold: number;
    target: number | null;
    orders: number;
  }[];
  customers: { id: number; name: string; kind: CustomerKind; sold: number; orders: number }[];
  medicines: { name: string; qty: number; value: number }[];
};

// ---- HR: working hours and attendance. Times are ISO; days "YYYY-MM-DD" (Manila). ----

export type { WorkSchedule } from "./hr/work-time";

import type { WorkSchedule } from "./hr/work-time";

export type AttendanceDay = {
  day: string;
  /** work: a working day; rest: off the schedule; holiday: the company's holiday; before:
   *  before the person joined. */
  kind: "work" | "rest" | "holiday" | "before";
  holiday: string | null;
  timeIn: string | null;
  timeOut: string | null;
  /** Where time out came from: their button, the last thing they did, HR. */
  outFrom: "button" | "last_seen" | "field" | "hr" | "request" | "biometric" | null;
  inFrom: "sign_in" | "button" | "field" | "hr" | "request" | "biometric" | null;
  /** Still working (today, not ended). */
  working: boolean;
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  afterHoursMinutes: number;
  /** A working day gone by with no time in and no leave. */
  absent: boolean;
  /** Leave HR recorded for this working day (a half day leaves the other half to work). */
  leave: LeaveKind | null;
  halfDay: boolean;
  /** An approved form: official business or work from home (the day counts as worked). */
  form: "ob" | "wfh" | null;
  /** Approved overtime that day (an overtime form), in minutes. */
  overtimeMinutes: number;
  /** Each approved overtime form that day: its type (null on rows from before types), minutes
   *  and the night part of them (10 PM to 6 AM). */
  overtime?: { type: OtType | null; minutes: number; nightMinutes: number }[];
  note: string | null;
};

/** Vacation, sick, without pay, other. */
export type LeaveKind = "vl" | "sl" | "lwop" | "other";

export type LeaveRow = {
  id: number;
  personId: number;
  kind: LeaveKind;
  from: string;
  to: string;
  halfDay: boolean;
  /** Working days it takes (a half day is 0.5). */
  days: number;
  reason: string | null;
  madeBy: string;
  madeAt: string;
};

export type LeaveInput = {
  personId: number;
  kind: LeaveKind;
  from: string;
  to: string;
  halfDay?: boolean;
  reason?: string | null;
};

export type AttendanceToday = {
  day: string;
  holiday: string | null;
  can: { putRight: boolean };
  counts: {
    working: number;
    done: number;
    notIn: number;
    late: number;
    rest: number;
    onLeave: number;
  };
  people: {
    personId: number;
    name: string;
    title: string | null;
    role: Role;
    team: string | null;
    today: AttendanceDay;
    /** This month so far: days worked, hours, late days, absent days. */
    month: { days: number; workedMinutes: number; lateDays: number; absentDays: number };
  }[];
};

export type AttendanceMonth = {
  month: string;
  person: { id: number; name: string; title: string | null };
  schedule: WorkSchedule & { name: string };
  days: AttendanceDay[];
  totals: {
    workDays: number;
    present: number;
    absent: number;
    workedMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    afterHoursMinutes: number;
    leaveDays: number;
  };
  leaves: LeaveRow[];
  /** The person's requests to put a day of this month right. */
  fixes: FixLine[];
  /** The month's days as the biometric timekeeping sheet had them (HR, the CEO and the Admin;
   *  null for anyone else). */
  biometric: BiometricDay[] | null;
  /** putRight: change a day's times; leave: record or cancel leave (HR's work); askFix: the
   *  person asks for one of their own days to be put right; biometric: use the biometric times
   *  for a day or dismiss its flag. */
  can: { putRight: boolean; leave: boolean; askFix: boolean; biometric: boolean };
};

/** A request to put a day of one's own attendance right (a missed time in or out, a wrong time). */
export type FixLine = {
  id: number;
  person: { id: number; name: string; team: string | null };
  day: string;
  /** "HH:MM", Manila time. */
  timeIn: string;
  timeOut: string | null;
  reason: string;
  status: Exclude<LeaveStatus, "revoked">;
  approver: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  madeAt: string;
  canDecide: boolean;
  canCancel: boolean;
};

export type FixList = {
  lines: FixLine[];
  counts: { waiting: number; asked: number; approved: number; refused: number; cancelled: number };
};

export type FixInput = { day: string; timeIn: string; timeOut?: string | null; reason: string };

// ---- HR: the biometric timekeeping workbook (TIMEKEEPING sheet) beside the CRM's attendance. ----

/** What a day's cell held: punches, a code (OFF, OB, A, TRAINING …), nothing, or what can't be read. */
export type BiometricKind = "punch" | "code" | "empty" | "unreadable";

/** One day of the sheet as read (in a preview, nothing is kept yet). */
export type TimekeepingCell = {
  day: string;
  /** The sheet's column. */
  column: string;
  raw: string;
  kind: BiometricKind;
  code: string | null;
  /** "HH:MM". */
  firstIn: string | null;
  lastOut: string | null;
  punches: number;
  /** Why HR must look at it (one punch, a mistyped time, TRAINING …), or null. */
  review: string | null;
};

/** One kept biometric day, with how it stands against the CRM's day. */
export type BiometricDay = TimekeepingCell & {
  id: number;
  importId: number;
  /** What the code means ("Rest day"), when it is one. */
  codeWords: string | null;
  /** Where it disagrees with the CRM's day (over 15 minutes, or one has the day and the other
   *  hasn't), or null. */
  flag: string | null;
  resolution: { kind: "applied" | "dismissed"; by: string; at: string; note: string | null } | null;
};

/** A workbook read but not kept: what would be imported. */
export type TimekeepingPreview = {
  sheet: string;
  from: string;
  to: string;
  fileName: string;
  warnings: string[];
  people: {
    row: number;
    deviceId: string;
    name: string;
    employeeCode: string | null;
    /** Who they are in the CRM: by the device ID HR set, or by the employee ID. Only these import. */
    match: { how: "device" | "employee_id"; personId: number; name: string } | null;
    /** A name that looks like someone's: HR confirms it ("This is …") before it imports. */
    suggestion: { personId: number; name: string } | null;
    /** Why the row can't import even when matched (no device ID, matched twice). */
    problem: string | null;
    days: TimekeepingCell[];
    counts: { punched: number; review: number };
  }[];
  counts: { people: number; matched: number; suggested: number; unmatched: number; days: number; review: number };
  /** Everyone at work, to pick from when the name matches nobody. */
  choices: { id: number; name: string; employeeCode: string | null }[];
};

export type TimekeepingImportLine = {
  id: number;
  from: string;
  to: string;
  sheet: string;
  fileName: string;
  people: number;
  days: number;
  needsReview: number;
  skipped: number;
  madeBy: string;
  madeAt: string;
  /** Re-imported since (its days kept, no longer current). */
  superseded: boolean;
};

/** A day on HR's Needs review list: what the sheet says, what the CRM has. */
export type TimekeepingReviewLine = {
  person: { id: number; name: string };
  biometric: BiometricDay;
  crm: { timeIn: string | null; timeOut: string | null; inFrom: AttendanceDay["inFrom"] } | null;
};

/** HR's Timekeeping page. */
export type TimekeepingPage = {
  imports: TimekeepingImportLine[];
  devices: { id: number; deviceId: string; person: { id: number; name: string }; nameOnSheet: string | null; setBy: string; setAt: string }[];
  /** The days the review covers (the latest import's, unless asked). */
  range: { from: string; to: string } | null;
  review: TimekeepingReviewLine[];
  can: { upload: boolean };
};

/** HR's work schedules (shifts): each with how many people at work are on it. */
export type HrSchedules = {
  schedules: {
    id: number;
    name: string;
    /** 0 Sunday … 6 Saturday. */
    days: number[];
    /** "HH:MM". */
    start: string;
    end: string;
    graceMinutes: number;
    breakMinutes: number;
    isDefault: boolean;
    archived: boolean;
    people: number;
  }[];
  can: { change: boolean };
};

/** A holiday on HR's Holidays page: national, or local to a province (town null) or one town. */
export type HolidayRow = {
  id: number;
  scope: "national" | "local";
  day: string;
  name: string;
  kind: "regular" | "special";
  province: string | null;
  town: string | null;
  proclamation: string | null;
  /** Who added it (null: the yearly list or the 2026 proclamations). */
  madeBy: string | null;
  archived: { by: string | null; at: string; note: string | null } | null;
};

export type HolidayYear = {
  year: number;
  province: string | null;
  town: string | null;
  holidays: HolidayRow[];
  can: { change: boolean };
};

export type HolidayInput = {
  day: string;
  name: string;
  kind: "regular" | "special";
  /** None: a national holiday. */
  province?: string | null;
  /** None with a province: the whole province. */
  town?: string | null;
};

export type ScheduleInput = {
  name: string;
  days: number[];
  start: string;
  end: string;
  graceMinutes?: number | null;
  breakMinutes?: number | null;
};

/** The CEO's (and HR's, a team lead's for the team) attendance report over chosen days: who
 *  worked how long, who less, late, absent and on leave. Read only. */
export type AttendanceReport = {
  from: string;
  to: string;
  people: {
    personId: number;
    name: string;
    title: string | null;
    team: string | null;
    workDays: number;
    present: number;
    absent: number;
    leaveDays: number;
    leave: Partial<Record<LeaveKind, number>>;
    workedMinutes: number;
    /** Hours on a day they came in, on average. */
    averageMinutes: number;
    /** What their working days ask for (leave days off), to compare with workedMinutes. */
    expectedMinutes: number;
    lateDays: number;
    lateMinutes: number;
    undertimeMinutes: number;
    afterHoursMinutes: number;
    /** Approved overtime, and days of official business or work from home. */
    overtimeMinutes: number;
    formDays: number;
  }[];
  totals: {
    people: number;
    workDays: number;
    present: number;
    absent: number;
    leaveDays: number;
    workedMinutes: number;
    expectedMinutes: number;
    lateDays: number;
    lateMinutes: number;
    overtimeMinutes: number;
  };
};

/** A person's own day, for the top bar's Start / End my day. */
export type MyDay = {
  today: AttendanceDay;
  schedule: { start: string; end: string };
};

// ---- HR: people and joining. Money is whole centavos (monthly); days "YYYY-MM-DD". ----

/** The company a person works for: one of the group's companies (src/companies.ts). */
export type Company = CompanyCode;
export type Classification = "probationary" | "regular" | "part_time" | "intern";
/** Where a person stands: joining (starts on a later day), working, or left. */
export type PersonStage = "joining" | "active" | "left";
/** Their login: not used yet, used, or switched off (they left). */
export type LoginState = "new" | "ready" | "off";

export type HrPersonRow = {
  personId: number;
  name: string;
  employeeCode: string | null;
  company: Company;
  position: string | null;
  team: string | null;
  role: Role;
  roleLabel: string;
  stage: PersonStage;
  login: LoginState;
  /** The email they sign in with (HR gave it), else their seat's login ID. */
  loginId: string | null;
  hireDate: string;
  classification: Classification;
  /** Fields still missing on their record (address, IDs…): HR's to-do. */
  missing: string[];
};

export type HrPeople = {
  rows: HrPersonRow[];
  counts: { all: number; active: number; joining: number; left: number; missing: number };
  /** add: New joiner (HR's work; the CEO only reads). */
  can: { add: boolean };
};

export type HrPerson = {
  personId: number;
  name: string;
  role: Role;
  roleLabel: string;
  stage: PersonStage;
  login: LoginState;
  loginId: string | null;
  lastSignIn: string | null;
  seat: {
    id: number;
    title: string;
    team: string;
    channel: string | null;
    area: string | null;
    boss: string | null;
  } | null;
  /** Every seat they have held, newest first. */
  history: { title: string; team: string; from: string; to: string | null; why: string | null }[];
  record: {
    company: Company;
    employeeCode: string | null;
    classification: Classification;
    position: string | null;
    department: string | null;
    hireDate: string;
    regularizedOn: string | null;
    leftOn: string | null;
    leftReason: string | null;
    mobile: string | null;
    personalEmail: string | null;
    birthDate: string | null;
    address: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    emergencyRelation: string | null;
    gender: Gender | null;
    civilStatus: CivilStatus | null;
    citizenship: string | null;
    spouseName: string | null;
    fatherName: string | null;
    motherName: string | null;
    education: string | null;
    school: string | null;
    course: string | null;
    workArrangement: WorkArrangement | null;
    /** Where they work (the CRM's town list), for their local holidays, with its province. */
    workTown: string | null;
    workProvince: string | null;
    /** The place their local holidays follow: the record, else their seat area's first city. */
    holidayPlace: { town: string | null; province: string; from: "record" | "area" } | null;
    companyPhone: string | null;
    issuedEquipment: string | null;
    jobDescription: string | null;
    /** Pay, bank and government IDs: null for anyone but HR, the CEO, the Admin and the person. */
    salary: number | null;
    allowance: number | null;
    bankName: string | null;
    bankAccount: string | null;
    sss: string | null;
    philhealth: string | null;
    pagibig: string | null;
    tin: string | null;
    /** Schemes they aren't covered by, and no tax (HR, the CEO, the Admin, the person). */
    payExempt: { sss: boolean; philhealth: boolean; pagibig: boolean; tax: boolean } | null;
  };
  missing: string[];
  /** edit: the record; login: the login email and password; leave: mark as left. */
  /** back: marked as left, and can be brought back; schedule: give them another work schedule. */
  can: { edit: boolean; login: boolean; leave: boolean; back: boolean; schedule: boolean };
  /** Their work schedule: one HR gave them (id), or the company's default (id null). */
  schedule: { id: number | null; name: string; start: string; end: string; days: number[] };
  /** Their working life here, newest first: joined, position, department, employment, company,
   *  regularized, pay changed (never the amount), left, back. From HR's trail (since 24 Nov 2026). */
  career: { at: string; what: string }[];
};

export type Gender = "female" | "male";
export type CivilStatus = "single" | "married" | "widowed" | "separated";
export type WorkArrangement = "office" | "field" | "hybrid" | "remote";
/** The positions a record may say: HR keeps the list (archived ones stay on old records). */
export type HrPositions = {
  positions: { id: number; name: string; people: number; archived: boolean }[];
  can: { change: boolean };
};

/** One field of a record as it was and as it is. `hidden`: pay, bank, a government number or the
 *  birth date: the trail says it changed, never the values (both null). */
export type HrChange = { field: string; label: string; from: string | null; to: string | null; hidden: boolean };
export type HrEventKind =
  | "joined"
  | "record"
  | "login"
  | "left"
  | "back"
  | "paper"
  | "attendance"
  | "leave"
  | "move"
  | "document";
export type HrPaperKind = "contract" | "government_id" | "certificate" | "clearance" | "medical" | "other";
/** A person's papers on their HR record: the ones kept, then the ones taken off (archived). */
export type HrPapers = {
  kinds: { key: HrPaperKind; label: string }[];
  papers: {
    id: number;
    kind: HrPaperKind;
    kindLabel: string;
    title: string;
    expiresOn: string | null;
    /** Expired, or within 30 days of it. */
    expiry: "expired" | "soon" | null;
    fileName: string;
    fileMime: string;
    fileSize: number;
    addedBy: string;
    addedAt: string;
    archived: { at: string; by: string; reason: string } | null;
  }[];
  can: { add: boolean; archive: boolean };
};
/** A person's HR trail, newest first: who did what to their record, and when. */
export type HrHistory = {
  lines: { at: string; by: string; kind: HrEventKind; what: string; changes: HrChange[] }[];
};

export type HrRecordInput = Partial<{
  company: Company;
  employeeCode: string | null;
  classification: Classification;
  position: string | null;
  department: string | null;
  hireDate: string;
  regularizedOn: string | null;
  mobile: string | null;
  personalEmail: string | null;
  birthDate: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;
  gender: Gender | null;
  civilStatus: CivilStatus | null;
  citizenship: string | null;
  spouseName: string | null;
  fatherName: string | null;
  motherName: string | null;
  education: string | null;
  school: string | null;
  course: string | null;
  workArrangement: WorkArrangement | null;
  workTown: string | null;
  workProvince: string | null;
  companyPhone: string | null;
  issuedEquipment: string | null;
  jobDescription: string | null;
  salary: number | null;
  allowance: number | null;
  bankName: string | null;
  bankAccount: string | null;
  sss: string | null;
  philhealth: string | null;
  pagibig: string | null;
  tin: string | null;
  /** Not covered by a scheme (a foreign national, Pag-IBIG waived), or not taxed. */
  noSss: boolean;
  noPhilhealth: boolean;
  noPagibig: boolean;
  noTax: boolean;
}>;

/** What HR picks from to add a joiner: the seats nobody holds or is joining. */
export type JoinerForm = {
  today: string;
  seats: { id: number; title: string; team: string; channel: string | null; area: string | null }[];
};

/** A new joiner. HR types the login email and password they hand over; nothing is sent. */
export type JoinerInput = {
  name: string;
  mobile: string;
  company: Company;
  employeeCode?: string | null;
  seatId: number;
  startsOn: string;
  classification: Classification;
  position?: string | null;
  salary?: number | null;
  allowance?: number | null;
  loginEmail: string;
  password: string;
};

/** HR changes the email a person signs in with, or gives a new password (both typed by HR). */
export type HrLoginInput = { email?: string | null; password?: string | null };

// ---- Field: visits to doctors, hospitals and drugstores (SEFMED's daily work). ----

/** missed: a planned visit the day report closed with its reason (the field's day, PLAN 22). */
export type VisitStatus = "planned" | "done" | "skipped" | "missed";
export type PlanStatus = "draft" | "sent" | "approved" | "sent_back";
/** How often a customer is visited a month: A 4, B 2, C 1, D 1 (no class yet: once). */
export type VisitClass = "A" | "B" | "C" | "D";
/** How the doctor took a medicine detailed on the visit. */
export type VisitReaction = "will_prescribe" | "prescribes" | "needs_info" | "not_interested";
export type SkipReason =
  | "not_available"
  | "busy"
  | "clinic_closed"
  | "out_of_town"
  | "rescheduled"
  | "other";

export type VisitRow = {
  id: number;
  day: string;
  status: VisitStatus;
  customer: {
    id: number;
    name: string;
    kind: string;
    specialty: string | null;
    city: string | null;
    visitClass: VisitClass | null;
    /** The clinic's place is known: check-ins are compared with it. */
    pinned: boolean;
  };
  checkedInAt: string | null;
  checkInPlace: string | null;
  /** Metres from the clinic's pin at check-in (null: no pin or no place shared). */
  distanceM: number | null;
  doneAt: string | null;
  objective: string | null;
  detailed: { medicineId: number; name: string; reaction: VisitReaction }[];
  notes: string | null;
  nextDay: string | null;
  skipReason: string | null;
  /** The last visit done to this customer before this one. */
  lastVisit: string | null;
};

/** One person's visits on a day: theirs to work, or their team's / anyone's to look at. */
export type FieldDay = {
  day: string;
  today: string;
  person: { id: number; name: string; area: string | null };
  visits: VisitRow[];
  counts: { planned: number; done: number; skipped: number };
  /** work: it is the person's own day (plan, check in, report, skip). */
  can: { work: boolean };
};

/** What the visit forms pick from: the customers this person looks after, the medicines. */
export type FieldForm = {
  customers: {
    id: number;
    name: string;
    kind: string;
    specialty: string | null;
    city: string | null;
    lastVisit: string | null;
  }[];
  medicines: { id: number; name: string; strength: string | null }[];
};

export type VisitPlanInput = { customerId: number; day: string; objective?: string | null };
export type VisitReportInput = {
  objective?: string | null;
  detailed: { medicineId: number; reaction: VisitReaction }[];
  notes?: string | null;
  nextDay?: string | null;
};

/** Visits over chosen days, per person: the team lead's for the team, the CEO's for everyone. */
export type FieldReport = {
  from: string;
  to: string;
  /** The month the coverage counts (the last day's). */
  month: string;
  people: {
    personId: number;
    name: string;
    title: string | null;
    team: string | null;
    planned: number;
    done: number;
    skipped: number;
    /** Different doctors, hospitals and drugstores visited. */
    covered: number;
    /** Days with at least one visit done, and visits a day on those. */
    fieldDays: number;
    perDay: number;
    /** Visits done with the check-in far from the clinic's pin, and with no place shared. */
    away: number;
    noPlace: number;
    /** Customers they look after, and how many were seen this month as often as their class asks. */
    customers: number;
    seenEnough: number;
    /** This month's plan: not made, draft, sent to the team lead, approved, sent back. */
    plan: PlanStatus | null;
    /** Field expenses in these days (centavos): approved, and waiting for the team lead. */
    spent: number;
    spentPending: number;
  }[];
  totals: {
    planned: number;
    done: number;
    skipped: number;
    covered: number;
    fieldDays: number;
    away: number;
    customers: number;
    seenEnough: number;
    spent: number;
    spentPending: number;
  };
};

/** One person's month of visits: coverage by class, the days, and the plan's state. */
export type VisitPlanPage = {
  month: string;
  today: string;
  person: { id: number; name: string; area: string | null };
  plan: {
    status: PlanStatus | null;
    sentAt: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    note: string | null;
  };
  customers: {
    id: number;
    name: string;
    kind: string;
    specialty: string | null;
    city: string | null;
    visitClass: VisitClass | null;
    /** Visits a month its class asks for. */
    needed: number;
    planned: number;
    done: number;
    skipped: number;
    lastVisit: string | null;
  }[];
  days: { day: string; work: boolean; leave: boolean; planned: number; done: number }[];
  totals: { needed: number; planned: number; done: number };
  /** make: fill the month; send: to the team lead; decide: approve or send back; setClass. */
  can: { make: boolean; send: boolean; decide: boolean; setClass: boolean };
};

export type ExpenseKind = "petrol" | "fare" | "parking" | "toll" | "food" | "lodging" | "other";
export type ExpenseStatus = "pending" | "approved" | "sent_back";

export type ExpenseRow = {
  id: number;
  person: { id: number; name: string };
  day: string;
  kind: ExpenseKind;
  /** Whole centavos. */
  amount: number;
  km: number | null;
  visit: { id: number; customer: string } | null;
  note: string | null;
  /** The bill or payment proof is on file (opened at /api/field/expenses/:id/receipt). */
  receipt: { name: string; mime: string } | null;
  status: ExpenseStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  /** The person viewing may approve or send it back (their team lead's). */
  canDecide: boolean;
};

/** A person's field expenses over chosen days, or the team's / everyone's waiting ones. */
export type FieldExpenses = {
  from: string;
  to: string;
  person: { id: number; name: string } | null;
  rows: ExpenseRow[];
  totals: {
    pending: number;
    approved: number;
    sentBack: number;
    byKind: Partial<Record<ExpenseKind, number>>;
    km: number;
  };
  /** add: it is the person's own (they spend in the field). */
  can: { add: boolean };
};

export type ExpenseInput = {
  day: string;
  kind: ExpenseKind;
  amount: number;
  km?: number | null;
  visitId?: number | null;
  note?: string | null;
};

// ---- HR: leave asked for by people, decided by whom they report to (HR when none). ----

export type LeaveStatus = "asked" | "approved" | "refused" | "cancelled" | "revoked";

export type LeaveBalance = {
  /** The year's days: the opening days plus HR's adjustments (never below nothing). */
  allotted: number;
  /** Days a year by the rule (regular employees: 10 VL and 10 SL; others none). */
  opening: number;
  /** HR's adjustments this year, added up (+ or -, half days). */
  adjusted: number;
  used: number;
  /** Asked for and not decided yet. */
  asked: number;
  left: number;
};

export type LeaveLine = {
  id: number;
  person: { id: number; name: string; team: string | null };
  kind: LeaveKind;
  from: string;
  to: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  /** Who decides it while asked (null: HR). */
  approver: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  madeBy: string;
  madeAt: string;
  /** Its first paper (a medical certificate), opened at /api/hr/leave/:id/file: the one older
   *  rows kept on the leave, else the first of `files`. */
  file: { name: string; mime: string } | null;
  /** Proof files (up to five), opened at /api/hr/leave/:id/files/:fileId. */
  files: { id: number; name: string; mime: string }[];
  /** A second approver named on the person's record: also decides; the first to decide wins. */
  secondApprover: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  canDecide: boolean;
  canCancel: boolean;
  /** Approved leave the person takes back before it starts (HR any): kept, days come back. */
  canRevoke: boolean;
  /** The printout (/hr/print/leave/:id) opens: approved, and this person may read it. */
  canPrint: boolean;
};

/** One of HR's adjustments to a person's credits (a ledger line, never changed). */
export type LeaveCreditLine = {
  id: number;
  year: number;
  kind: "vl" | "sl";
  /** + adds, - takes off; half days allowed. */
  days: number;
  reason: string;
  by: string;
  at: string;
  /** The line this one reverses, and the line that reversed this one. */
  reverses: number | null;
  reversedBy: number | null;
};

/** A person's credits for a year as HR reads them: the ledger for VL and SL and HR's lines. */
export type LeaveCredits = {
  personId: number;
  name: string;
  year: number;
  classification: Classification;
  vl: LeaveBalance;
  sl: LeaveBalance;
  lines: LeaveCreditLine[];
  secondApprover: { id: number; name: string } | null;
  /** adjust: add or reverse a line, and name the second approver (HR and the Admin). */
  can: { adjust: boolean };
  /** Whom HR may name as the second approver (when it may). */
  approvers: { id: number; name: string }[];
};

/** Year-end: each person's unused vacation leave and the half of it that converts to pay, at
 *  their day rate (centavos). A report for HR: the CRM doesn't pay it (PLAN 12.16). */
export type VlConversion = {
  year: number;
  people: {
    personId: number;
    name: string;
    total: number;
    used: number;
    unused: number;
    convertDays: number;
    perDay: number | null;
    amount: number | null;
  }[];
  totals: { convertDays: number; amount: number };
};

/** A person's own leave: what is left this year, what they asked for, and whom they ask. */
export type MyLeave = {
  year: number;
  classification: Classification;
  balances: { vl: LeaveBalance; sl: LeaveBalance; lwop: { used: number; asked: number } };
  approver: string;
  secondApprover: string | null;
  /** HR's adjustments to this year's credits. */
  credits: LeaveCreditLine[];
  /** The rules the ask form keeps (vacation notice, proof for sick leave, files). */
  rules: { vlNoticeDays: number; earliestVl: string; slProofFromDays: number; filesMax: number };
  lines: LeaveLine[];
};

/** Leave for HR (everyone), a team lead (the team) and the CEO (everyone, to read). */
export type LeaveList = {
  lines: LeaveLine[];
  counts: {
    waiting: number;
    asked: number;
    approved: number;
    refused: number;
    cancelled: number;
    revoked: number;
  };
  /** Lines this person decides (their team's, all for HR). */
  mine: number;
};

/** Visits by day over a month: one person's (each visit), or a team's (counts, and who is out). */
export type FieldCalendar = {
  month: string;
  today: string;
  /** The person shown; null for the whole team (a team lead's, everyone for the CEO). */
  person: { id: number; name: string } | null;
  /** Whom this viewer may pick (a MedRep only themselves). */
  people: { id: number; name: string; team: string | null }[];
  days: {
    day: string;
    work: boolean;
    holiday: string | null;
    planned: number;
    done: number;
    skipped: number;
    /** On leave that day: the person's kind, or (whole team) how many people. */
    leave: LeaveKind | null;
    away: number;
    visits: {
      id: number;
      personId: number;
      personName: string;
      customer: string;
      kind: string;
      status: VisitStatus;
      at: string | null;
    }[];
  }[];
};

/** Where the field people are now: their phone's last place while their day runs. */
export type LivePeople = {
  people: {
    personId: number;
    name: string;
    team: string | null;
    place: string | null;
    at: string | null;
    accuracyM: number | null;
    /** Their working day is running (started, not ended). */
    working: boolean;
    /** The customer they checked in at and haven't reported yet. */
    atVisit: string | null;
  }[];
};

/** Official business, work from home, overtime, the daily accomplishment report (eod), the
 *  incident report. */
export type FormKind = "ob" | "wfh" | "ot" | "eod" | "incident";
/** A form may also be returned to the person to fix (they send it again or revoke it). */
export type FormStatus = LeaveStatus | "returned";
/** The kinds of day overtime is filed on; broken is broken time. */
export type OtType =
  | "regular"
  | "rest"
  | "legal"
  | "special"
  | "rest_legal"
  | "rest_special"
  | "broken";
export type EodActivity = {
  timeIn: string;
  timeOut: string;
  location: string | null;
  details: string;
  deadline: string | null;
  remarks: string | null;
};
export type IncidentType =
  | "Safety / Accident"
  | "Misconduct"
  | "Property Damage"
  | "Security"
  | "Other";
export type IncidentDetails = {
  time: string;
  location: string;
  type: IncidentType;
  otherText: string | null;
  persons: string;
  action: string;
};
/** What the daily accomplishment report and the incident report carry. */
export type FormDetails = { activities: EodActivity[] } | IncidentDetails;

export type FormLine = {
  id: number;
  person: { id: number; name: string; team: string | null };
  kind: FormKind;
  day: string;
  /** "HH:MM" (official business and overtime). */
  from: string | null;
  to: string | null;
  /** Overtime: the minutes that count (the overtime rules); else from–to. */
  minutes: number;
  /** Overtime: its type, and the night differential part of the minutes (10 PM to 6 AM). */
  otType: OtType | null;
  nightMinutes: number;
  place: string | null;
  /** The reason; the daily report's purpose; the incident's description. */
  reason: string;
  details: FormDetails | null;
  status: FormStatus;
  approver: string | null;
  /** Head Requisition: the lead who filed this overtime for the person (straight to HR). */
  headBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  returnNote: string | null;
  revoked: { by: string; at: string; from: string; stage: "approver" | "hr" } | null;
  canDecide: boolean;
  canCancel: boolean;
  /** Taken back (kept as revoked) before it is decided, or once returned. */
  canRevoke: boolean;
  /** HR sends it back to the person to fix. */
  canReturn: boolean;
  /** The person sends a returned form again, fixed. */
  canResend: boolean;
  canPrint: boolean;
};

export type FormList = {
  lines: FormLine[];
  counts: {
    waiting: number;
    asked: number;
    approved: number;
    refused: number;
    cancelled: number;
    returned: number;
    revoked: number;
  };
};

export type FormInput = {
  kind: FormKind;
  day: string;
  from?: string | null;
  to?: string | null;
  place?: string | null;
  reason: string;
  /** Overtime: the kind of day (else the day's own kind). */
  otType?: OtType | null;
  /** Head Requisition: overtime a team lead or manager files for someone under them. */
  forPersonId?: number | null;
  /** The daily report's activities. */
  activities?:
    | (Pick<EodActivity, "timeIn" | "timeOut" | "details"> & {
        location?: string | null;
        deadline?: string | null;
        remarks?: string | null;
      })[]
    | null;
  /** The incident report's fields. */
  incident?: (Omit<IncidentDetails, "otherText"> & { otherText?: string | null }) | null;
};

/** Everything waiting for this person's decision under Leave & forms, by kind. */
/** Vacant seats (HR-PLAN, moves and vacant seats): the lead's in their boxes, everyone's for HR,
 *  the CEO and the Admin. */
export type VacantSeats = {
  today: string;
  /** Days vacant with nobody covering before the lead is reminded, and before the head and HR. */
  leadDays: number;
  upDays: number;
  seats: {
    seatId: number;
    title: string;
    team: string;
    area: string | null;
    /** The seat's email ID (handed to whoever sits there next). */
    login: string | null;
    /** The first day it has been empty, and how many days that is. */
    since: string;
    days: number;
    /** The team lead it waits with. */
    lead: string | null;
    cover: { holdingId: number; personId: number; name: string; until: string | null } | null;
    /** A joiner or a move already planned into it. */
    promised: { name: string; startsOn: string } | null;
    customers: number;
    open: number;
    /** This month: the seat's quota (stays on the seat), sold from it, and of that sold covering. */
    quota: number | null;
    sold: number;
    soldCovering: number;
    /** "lead": past the lead's days with nobody covering; "up": past the head's and HR's. */
    alert: "none" | "lead" | "up";
  }[];
  /** Whom this person may give a cover to: their own people (a lead), anyone with a seat (HR). */
  people: { id: number; name: string; seat: string; unitId: number }[];
  can: { cover: boolean };
};

export type HrQueue = {
  leave: number;
  forms: number;
  fixes: number;
  total: number;
  /** HR, the Admin: of those, the ones routed to HR itself (nobody else decides them first). */
  atHr: { leave: number; forms: number; fixes: number; total: number } | null;
};

/** A person's own drawn signature (a PNG data URL), shown on printouts once they sign. */
export type MySignature = { signature: { id: number; at: string; image: string } | null };

/** A printable leave or form: what the paper form carries, and who signed (each box filled only
 *  once that person signed or decided). */
export type Printout = {
  kind: "leave" | FormKind;
  title: string;
  company: string;
  /** Its number on paper (LV-000123, OT-000045). */
  code: string;
  /** The employer's letterhead: its registered name and details. */
  letterhead: Letterhead;
  person: {
    name: string;
    employeeCode: string | null;
    position: string | null;
    department: string | null;
  };
  filedOn: string;
  status: string;
  /** Label and value pairs, in the paper form's order. */
  fields: { label: string; value: string }[];
  /** A table (the daily report's activities). */
  table: { head: string[]; rows: string[][] } | null;
  signers: {
    box: string;
    name: string | null;
    at: string | null;
    /** The signature as a data URL, or null (not signed yet, or no signature drawn). */
    image: string | null;
  }[];
};

/** A company's letterhead on HR's papers: the registered name (companies.ts) and the details the
 *  Admin keeps in Company details. */
export type Letterhead = {
  code: Company;
  name: string;
  address: string;
  phone: string;
  email: string;
  tin: string;
  footer: string;
};

// ------------------------------------------------------------------ HR's documents

/** coe: certificate of employment; coe_pay: with the pay; nte: notice to explain. */
export type HrDocKind = "coe" | "coe_pay" | "clearance" | "memo" | "nte";
/** A clearance's sign-offs, in order: HR signs last. */
export type ClearanceDesk = "lead" | "finance" | "inventory" | "admin" | "hr";
export type HrDocStatus = "issued" | "waiting" | "received" | "answered" | "cleared" | "void";

export type HrDocRow = {
  id: number;
  code: string;
  kind: HrDocKind;
  title: string;
  personId: number;
  name: string;
  employeeCode: string | null;
  company: Company;
  subject: string | null;
  issuedAt: string;
  issuedBy: string;
  status: HrDocStatus;
  /** In words: "Waiting for Finance, Inventory", "Received 26 Nov". */
  statusWords: string;
};

export type HrDocList = {
  rows: HrDocRow[];
  /** The person asked for (?person=), even before they have any document. */
  person: { id: number; name: string; employeeCode: string | null; position: string | null; company: Company; active: boolean } | null;
  kinds: { key: HrDocKind; label: string }[];
  can: { issue: boolean };
};

export type HrDocInput = {
  kind: HrDocKind;
  personId: number;
  subject?: string | null;
  body?: string | null;
  replyBy?: string | null;
};

export type HrDocPage = {
  id: number;
  code: string;
  kind: HrDocKind;
  title: string;
  status: HrDocStatus;
  statusWords: string;
  letterhead: Letterhead;
  person: { id: number; name: string; employeeCode: string | null; position: string | null; department: string | null };
  issuedOn: string;
  issuedBy: string;
  /** Label and value lines above the text (a memo's To, From, Date, Subject). */
  fields: { label: string; value: string }[];
  /** The letter, paragraph by paragraph. */
  paragraphs: string[];
  /** A notice to explain: the day to answer by, and the answer. */
  replyBy: string | null;
  reply: { text: string; at: string } | null;
  /** A clearance's desks. */
  clearance: { desk: ClearanceDesk; label: string; signer: string | null; at: string | null; note: string | null }[] | null;
  signers: Printout["signers"];
  void: { at: string; by: string; reason: string } | null;
  can: { void: boolean; acknowledge: boolean; reply: boolean; sign: ClearanceDesk[] };
};

/** A person's own documents, and the clearances waiting for their desk's sign-off. */
export type MyDocuments = { rows: HrDocRow[]; toSign: HrDocRow[] };

// ------------------------------------------------------------------ HR's sheets in and out

export type HrImportKind = "people" | "leave-balances" | "holidays";

/** An uploaded sheet read (never kept): its headings and rows, and each column matched to a heading. */
export type HrImportRead = {
  kind: HrImportKind;
  headers: string[];
  rows: string[][];
  columns: { key: string; label: string; note: string | null }[];
  /** A column's key → the heading's place (from 0), or null when none matched. */
  mapping: Record<string, number | null>;
};

export type HrImportRow = {
  /** The row's line in the file (the headings are line 1). */
  line: number;
  /** new: added; update: changed; same: nothing to change; not_found: no such person. */
  status: "new" | "update" | "same" | "problem" | "not_found";
  who: string;
  changes: string[];
  problem?: string;
};

export type HrImportResult = {
  /** False: a test run, nothing changed. */
  saved: boolean;
  rows: HrImportRow[];
  counts: Record<HrImportRow["status"], number>;
};

export type HrSheets = {
  kinds: { key: HrImportKind; title: string; what: string; columns: { label: string; readOnly: boolean; note: string | null }[] }[];
  can: { import: boolean };
};

// ------------------------------------------------------------------ HR's reports

export type HrReportKey =
  | "headcount"
  | "movement"
  | "attrition"
  | "attendance"
  | "leave-balances"
  | "leave-taken"
  | "overtime"
  | "forms"
  | "due-soon"
  | "missing";
/** What a report is asked for: a range of days, one day, a year, or the days ahead. */
export type HrReportPeriod = "range" | "day" | "year" | "ahead";
export type HrReportColumn = { key: string; label: string; type: "text" | "number" | "money" | "date" | "percent" | "hours" };
export type HrReportValue = string | number | null;

export type HrReportList = {
  reports: { key: HrReportKey; title: string; what: string; period: HrReportPeriod; group: string }[];
};

export type HrReport = {
  key: HrReportKey;
  title: string;
  what: string;
  period: HrReportPeriod;
  /** What it was asked for, in words ("1 Nov 2026 to 26 Nov 2026", "As of 26 Nov 2026", "2026"). */
  periodWords: string;
  asked: { from: string; to: string; year: number; days: number; company: Company | null };
  columns: HrReportColumn[];
  rows: Record<string, HrReportValue>[];
  totals: Record<string, HrReportValue> | null;
  /** The headline figures above the table. */
  figures: { label: string; value: string }[];
  letterhead: Letterhead;
  preparedBy: string;
  preparedAt: string;
};

// ------------------------------------------------------------------ payroll

import type { PayAttendance, PayLine } from "./hr/pay-rules";

export type { PayAttendance, PayLine } from "./hr/pay-rules";

/** One person's payslip for one month: worked out from their DTR while the month is a draft,
 *  frozen once HR releases it. */
export type Payslip = {
  /** "2026-11": the 1st to the month's last day. */
  month: string;
  person: {
    id: number;
    name: string;
    employeeCode: string | null;
    company: Company;
    position: string | null;
    department: string | null;
  };
  monthlySalary: number;
  monthlyAllowance: number;
  dailyRate: number;
  hourlyRate: number;
  attendance: PayAttendance;
  earnings: PayLine[];
  /** Time not worked, off the basic pay. */
  less: PayLine[];
  gross: number;
  /** What SSS was reckoned on: gross less earnings that aren't taxable. */
  sssBase: number;
  taxable: number;
  /** SSS, PhilHealth, Pag-IBIG, withholding tax, then HR's own deductions. */
  deductions: PayLine[];
  totalDeductions: number;
  net: number;
  /** Shown for information, nothing added or taken: night differential (not paid), local
   *  holidays. Missing on slips released before them. */
  notes?: { key: string; label: string; detail: string }[];
  /** The company's shares, beside the slip. */
  employer: { sss: number; philhealth: number; pagibig: number; total: number } | null;
  /** Where the pay goes. */
  bank: { name: string | null; account: string | null } | null;
};

export type PayPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  payDay: string;
  /** running: the month hasn't ended; ready: ended, not released; released: payslips out. */
  status: "running" | "ready" | "released";
  released: { by: string; at: string } | null;
};

export type PayrollList = {
  periods: (PayPeriod & { people: number | null; gross: number | null; net: number | null })[];
};

export type PayrollMonth = PayPeriod & {
  slips: Payslip[];
  /** People employed in the month with no salary on their record: not paid until HR adds it. */
  noSalary: { id: number; name: string; position: string | null }[];
  totals: {
    people: number;
    gross: number;
    deductions: number;
    tax: number;
    net: number;
    employer: number;
    byCompany: { company: Company; people: number; net: number }[];
  };
  /** adjust: add or take off lines; release: freeze the payslips (with why not, when not). */
  can: { adjust: boolean; release: boolean };
  whyNotRelease: string | null;
  before: string;
  after: string | null;
};

/** What a payroll register's column may hold: who (employee ID, name) and the figures compared. */
export type RegisterField =
  | "code"
  | "name"
  | "basic"
  | "ot"
  | "gross"
  | "deductions"
  | "sss"
  | "philhealth"
  | "pagibig"
  | "tax"
  | "net";
export type RegisterFigure = Exclude<RegisterField, "code" | "name">;

/** Which heading of HR's register holds what: HR maps it once, it is used again. */
export type RegisterMapping = {
  sheet: string;
  /** The row the headings are on (as Excel numbers it). */
  headerRow: number;
  columns: Partial<Record<RegisterField, string | null>>;
};

export type RegisterCompare = {
  id: number;
  at: string;
  by: string;
  /** What the CRM's side was: the released payslips, or the draft as it stood. */
  crmStatus: "released" | "draft";
  /** Figures that differ by ₱0.01 or more, people on one side only and names to confirm. */
  differences: number;
  fields: RegisterFigure[];
  rows: {
    row: number;
    personId: number;
    name: string;
    hrName: string | null;
    code: string | null;
    match: "code" | "name";
    figures: { field: RegisterFigure; crm: number; hr: number | null; diff: number | null }[];
    differs: boolean;
  }[];
  /** Rows whose name is exactly a person's, waiting for HR to say it is them. */
  toConfirm: { row: number; hrName: string; code: string | null; personId: number; name: string }[];
  onlyHr: { row: number; hrName: string | null; code: string | null }[];
  onlyCrm: { personId: number; name: string; code: string | null }[];
};

export type PayRegisterPage = {
  month: string;
  registers: { id: number; fileName: string; by: string; at: string }[];
  current: {
    id: number;
    fileName: string;
    by: string;
    at: string;
    /** Each sheet's first rows, to pick the headings' row and map them. */
    sheets: { name: string; rows: { number: number; cells: string[] }[]; guessedRow: number }[];
    /** The mapping in force (the newest HR made), and whether it fits this file. */
    mapping: RegisterMapping | null;
    fits: boolean;
    compare: RegisterCompare | null;
  } | null;
  people: { id: number; name: string; code: string | null }[];
  can: { upload: boolean };
};

export type PayAdjustmentInput = {
  personId: number;
  label: string;
  kind: "earning" | "deduction";
  taxable?: boolean;
  amount: number;
  note?: string | null;
};

export type MyPayslips = {
  slips: { month: string; label: string; payDay: string; gross: number; net: number }[];
};

export type PayRuleRow = {
  kind: "sss" | "philhealth" | "pagibig" | "tax";
  startsOn: string;
  source: string | null;
  rule: unknown;
};

/** Why an order paid in advance has no proof of payment yet. */
export type NoProofReason = "on_terms" | "payment_to_follow" | "paid_no_slip" | "other";

/** Orders a Finance person confirmed, over chosen days. */
export type MyConfirmations = {
  from: string;
  to: string;
  rows: {
    id: number;
    code: string;
    customer: string;
    total: number;
    at: string;
    status: string;
    statusLabel: string;
  }[];
  total: number;
};

// ---------------------------------------------------------------- returns

export type ReturnReason = "expired" | "damaged" | "wrong_item" | "not_needed" | "other";
/** What Dispatch found of a line (or `kept`: the customer kept it, credited without coming back). */
export type ReturnOutcome = "restocked" | "damaged" | "missing" | "kept";
/** Where the goods are (the hub's question): it decides the return's road. */
export type ReturnGoods = "coming_back" | "customer_keeps" | "not_shipped";
export type ReturnInput = {
  reason: ReturnReason;
  /** Coming back (Dispatch checks them) unless said otherwise. */
  goods?: ReturnGoods;
  note?: string | null;
  /** What comes back; not asked for "not shipped yet" (the whole order is cancelled). */
  lines: { orderItemId: number; qty: number }[];
};
/** Goods that came back after delivery, and what happened to them. */
export type ReturnRow = {
  id: number;
  code: string;
  orderId: number;
  orderCode: string;
  customer: string;
  medrep: string;
  status: "requested" | "approved" | "checked" | "received" | "rejected" | "cancelled";
  statusLabel: string;
  goods: ReturnGoods;
  goodsLabel: string;
  reason: ReturnReason;
  reasonLabel: string;
  note: string | null;
  requestedBy: string;
  requestedById: number;
  requestedAt: string;
  decidedBy: string | null;
  decidedNote: string | null;
  decidedAt: string | null;
  receivedBy: string | null;
  receivedAt: string | null;
  /** Who credited the bill (Management, after the goods were checked or on approving), when. */
  creditedBy: string | null;
  creditedAt: string | null;
  /** What was taken off the bill (checked: what will be, if Management credits it). */
  credit: number;
  lines: {
    id: number;
    medicine: string;
    qty: number;
    unitPrice: number;
    outcome: ReturnOutcome | null;
  }[];
  /** credit: Management credits the bill after Dispatch checked the goods (or doesn't). */
  can: { decide: boolean; receive: boolean; credit: boolean; cancel: boolean };
};
export type ReturnList = {
  rows: ReturnRow[];
  counts: Partial<Record<ReturnRow["status"], number>>;
};
/** An order's returns, what of it can still come back, and whether this person may ask. */
export type OrderReturns = {
  returns: ReturnRow[];
  left: {
    orderItemId: number;
    medicineId: number;
    medicine: string;
    qty: number;
    left: number;
    unitPrice: number;
    free: boolean;
  }[];
  /** ask: this person may ask for a return; goods: where the goods may be on this order now. */
  can: { ask: boolean; goods: ReturnGoods[] };
};

// ---------------------------------------------------------------- data checks

export type DataCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** How many things are wrong. */
  count: number;
  /** The first few, by name. */
  problems: string[];
};
export type DataChecks = { at: string; ok: boolean; checks: DataCheck[] };

/** Zoho's salespeople, each with the customers they last sold to, and the seats they can be tied to. */
/** A person's place in this CRM's org: their seat, team, channel and whom they report to. */
export type ZohoSellerPlace = { person: string; seat: string; team: string; channel: string | null; reportsTo: string | null };

export type ZohoSellers = {
  sellers: {
    /** As Zoho writes it ("HOS | PASAY"). */
    name: string;
    /** Customers whose latest Zoho order names them; of those, the ones who ordered in the last 18 months. */
    customers: number;
    recent: number;
    lastOn: string | null;
    /** The seat it is tied to, and the seat that looks like it. */
    seatId: number | null;
    suggested: number | null;
    /** Zoho's invoices under this name this year, in centavos. */
    year: number;
    /** Who the old hub's Sep 2026 sheet put on this name, and under whom. */
    hub: { channel: string; head: string | null; manager: string; person: string; hq: string | null; vacant: boolean } | null;
    /** Where this CRM has it: the tied seat's holder, or the person the hub's name looks like. */
    ours: ZohoSellerPlace | null;
    looksLike: ZohoSellerPlace | null;
  }[];
  /** Seats with an area (only those can hold customers). */
  seats: { id: number; title: string; unit: string; channel: string | null; area: string | null; holder: string | null }[];
};

/** A month's scorecard (Phase 2): the playbook card it is scored on and each KPI's figures. */
export type ScoreCard = {
  month: string;
  recipe: string;
  label: string;
  source: string;
  /** Still running: worked out now; else locked on the 1st. */
  live: boolean;
  lockedOn: string | null;
  upTo: string;
  total: number;
  max: number;
  percent: number;
  capped: boolean;
  kpis: {
    key: string;
    label: string;
    how: string;
    weight: number;
    unit: "%" | "days" | "count";
    value: number | null;
    points: number | null;
    band: string | null;
    next: { value: number; points: number } | null;
    note: string;
  }[];
};

export type ScoreDispute = {
  id: number;
  personId: number;
  person: string;
  month: string;
  kpi: string;
  note: string;
  raisedOn: string;
  state: "open" | "upheld" | "turned_down";
  answer: string | null;
  answeredBy: string | null;
};

type ScoreYear = {
  /** The locked months of the last year, oldest first. */
  history: { month: string; total?: number; max?: number; percent: number }[];
  average: number | null;
  increment: { percent: number; label: string } | null;
  /** Below 60 two locked months running. */
  pip: boolean;
};

export type MyScore = ScoreYear & {
  personId: number;
  name: string;
  seat: string | null;
  area: string | null;
  month: string;
  today: string;
  card: ScoreCard | null;
  /** A MedRep in the field: their Field work card beside their channel's (PLAN 23). */
  field: ScoreCard | null;
  disputes: ScoreDispute[];
  mine: boolean;
};

/** My KPIs, the hub's way (PLAN 23): a month's sales without VAT against target, and the counts. */
export type KpiFigures = {
  people: number;
  peopleWithTarget: number;
  /** Centavos; a team's includes the empty seats' targets under the lead. */
  target: number | null;
  vacantTarget: number;
  /** Sales without VAT, line by line (centavos). */
  sales: number;
  withVat: number;
  vat: number;
  /** Sales without VAT ÷ target × 100, one decimal; null with no target. */
  percent: number | null;
  ordersInvoiced: number;
  newCustomers: number;
  ordersRaised: number;
  ordersHeld: number;
  /** Placed, not invoiced yet (waiting for Management or held): shown, never counted. */
  waitingOrders: number;
  waitingSales: number;
};
export type KpiDay = { sales: number; orders: number };
export type KpiPanel = {
  month: string;
  today: string;
  running: boolean;
  /** The day picked (Today, Yesterday, a date), or null for the month only. */
  day: string | null;
  own: (KpiFigures & { enteredForOthers: number; enteredForMe: number }) | null;
  team: (KpiFigures & { label: string }) | null;
  ownDay: KpiDay | null;
  teamDay: KpiDay | null;
  /** The day's invoices behind the sales (a seller's own; a lead's or the CEO's, the team's). */
  dayOrders: { orderId: number | null; code: string; invoice: string; customer: string; sales: number; person: string | null }[];
};

/** The CEO's Home: the month's KPI picture of the whole company (PLAN 23). */
export type CompanyScores = {
  month: string;
  today: string;
  live: boolean;
  /** People with a card this month (sellers and leads). */
  scored: number;
  /** The sellers' cards, averaged (percent of each card's maximum). */
  average: number | null;
  leadsAverage: number | null;
  below60: number;
  best: CompanyScorePerson[];
  lowest: CompanyScorePerson[];
  /** Each kind of card (Hospital CHC, Rx CHC, Field work…) and its average. */
  kinds: { recipe: string; label: string; people: number; average: number; interim: boolean }[];
  field: { people: number; average: number | null };
  /** Questions on locked figures still open. */
  questions: number;
};
export type CompanyScorePerson = { personId: number; name: string; title: string; unit: string; card: string; recipe: string; percent: number; lead: boolean };

export type TeamScores = {
  month: string;
  today: string;
  rows: (ScoreYear & {
    seatId: number;
    title: string;
    area: string | null;
    unit: string;
    personId: number | null;
    name: string | null;
    card: ScoreCard | null;
    field: ScoreCard | null;
  })[];
  disputes: ScoreDispute[];
};

export type ReorderState = "soon" | "due" | "late" | "at_risk" | "lost";

/** Customers to call: who is due to reorder against their usual gap, who is late or slipping. */
export type Reorders = {
  today: string;
  state: ReorderState;
  kind: CustomerKind | null;
  counts: { state: ReorderState | "ok"; customers: number; lastValue: number }[];
  rows: {
    customerId: number;
    name: string;
    kind: CustomerKind;
    city: string | null;
    phone: string | null;
    area: string | null;
    seller: string | null;
    lastOn: string;
    orders: number;
    /** Their usual days between orders. */
    usual: number;
    since: number;
    /** When they should need more: the day a person set, else the last order plus the usual gap. */
    expectedOn: string;
    /** The day a person set (it counts until their next order), who set it, and their note. */
    setOn: string | null;
    setBy: string | null;
    refillNote: string | null;
    /** The field's last visit done there (and by whom), and the next one planned. */
    lastVisitOn: string | null;
    lastVisitBy: string | null;
    nextVisitOn: string | null;
    lastTotal: number;
    /** The medicines of their latest order. */
    lastItems: string | null;
  }[];
  /** For a lead or above: per area, how its customers stand. */
  areas: { areaId: number | null; area: string; seller: string | null; due: number; late: number; atRisk: number; lost: number; ok: number }[];
  /** Whose customers these are: the seat's area, the teams led, the online desk, the company. */
  scope: { label: string; detail: string };
};

/** A customer's next refill: the day a person set (until their next order), else the suggestion. */
export type Refill = {
  /** Their last order, this CRM's or the old system's; null with none. */
  lastOn: string | null;
  orders: number;
  /** Their usual days between orders (28 with one order). */
  usual: number;
  /** The last order plus the usual gap. */
  suggestedOn: string | null;
  /** The day a person set, who and when, and their note; null when none counts. */
  setOn: string | null;
  note: string | null;
  setBy: string | null;
  setAt: string | null;
  /** The day that counts: the one set, else the suggestion. */
  nextOn: string | null;
  canSet: boolean;
};

/** A seller's pulse for today: four numbers, each with its light. */
export type Pulse = {
  today: string;
  /** The working day before today, for "an invoice yesterday?". */
  lastDay: string;
  tiles: { key: string; label: string; value: string; sub: string; tone: "green" | "amber" | "red" | "none"; to: string }[];
};

/** Money to collect, customer by customer, by the age of the oldest unpaid invoice. */
export type Collections = {
  today: string;
  total: number;
  buckets: { key: "ok" | "d60" | "d75" | "d90"; label: string; amount: number }[];
  rows: {
    customerId: number;
    customer: string;
    kind: CustomerKind;
    phone: string | null;
    owed: number;
    invoices: number;
    oldestCode: string;
    /** The CRM's own order of the oldest invoice; empty for one that came from Zoho. */
    oldestOrderId: number | null;
    /** Where the oldest invoice opens: its order here, or Zoho's invoice in the books. */
    oldestHref: string;
    oldestOn: string;
    /** Days since the oldest unpaid invoice. */
    age: number;
    /** Days past the latest due date passed. */
    daysLate: number;
    seller: string | null;
    flag: "ok" | "d60" | "d75" | "d90";
  }[];
  scope: string;
};

type HuddleNumbers = { sales: number; collected: number; visits: number; invoiced: boolean };

/** The 7 PM huddle a seller declares: the day's numbers from the data, and what they declared. */
export type Huddle = {
  day: string;
  /** Whom it is declared to: the person they report to. */
  coach: string | null;
  actual: HuddleNumbers;
  declared: (HuddleNumbers & { blocker: string | null; tomorrow: string | null; at: string }) | null;
};

export type HuddleInput = HuddleNumbers & { blocker?: string | null; tomorrow?: string | null };

/** The coach's view of the team's huddle for a day. */
export type TeamHuddle = {
  day: string;
  today: string;
  declared: number;
  rows: {
    personId: number;
    name: string;
    seat: string;
    area: string | null;
    unit: string;
    actual: HuddleNumbers;
    declared: Huddle["declared"];
    /** No invoice that day. */
    red: boolean;
    /** No invoice three working days running: go with them tomorrow. */
    threeDry: boolean;
  }[];
};

/** A coach's district now: each seller's month so far and tonight's huddle, worst first. */
export type District = {
  today: string;
  month: string;
  /** From the 15th the rescue list counts. */
  rescueOpen: boolean;
  rows: {
    personId: number;
    name: string;
    seatId: number;
    seat: string;
    area: string | null;
    unit: string;
    /** Who leads the seller's team (their DSC). */
    coach: string | null;
    sales: number;
    target: number | null;
    /** Sales against the target on the working-day pace, %. */
    ist: number | null;
    dso: number | null;
    owed: number;
    /** Customers late or at risk against their usual gap, and their share of the area's. */
    lapsed: number;
    lapsedShare: number | null;
    /** Working days so far without an invoice. */
    zeroDays: number;
    workedSoFar: number;
    huddle: { declared: boolean; invoiced: boolean; threeDry: boolean; blocker: string | null } | null;
    rescue: string[];
    needs: string[];
    weight: number;
  }[];
};

/** An Rx CHC's day: the doctor list in tiers, each doctor's light, and their PAP applications. */
export type RxDay = {
  today: string;
  seatId: number | null;
  tiers: { tier: 1 | 2 | 3; doctors: number; visitsDue: number; visitsDone: number }[];
  doctors: {
    customerId: number;
    name: string;
    city: string | null;
    phone: string | null;
    specialty: string | null;
    /** On the list in this tier; null for a doctor of the area not listed yet. */
    tier: number | null;
    /** Visits done this month, and due by the tier. */
    visits: number;
    due: number;
    lastVisit: string | null;
    nextVisit: string | null;
    lastOrder: string | null;
    /** Their next refill by their usual gap. */
    refillOn: string | null;
    lastMonth: boolean;
    thisMonth: boolean;
    /** Red: refill within 48 hours or late; yellow: missing from last month; green: the rest. */
    light: "red" | "yellow" | "green";
  }[];
  pap: {
    pending: number;
    approved: number;
    rows: { leadId: number; patient: string; agency: string | null; appliedOn: string | null; letterOn: string | null }[];
  };
};

/** Patient Care Groups: enrolled by the Rx CHC, first contact by MD Telesales within 15 minutes. */
export type CareGroups = {
  today: string;
  firstContactMinutes: number;
  counts: {
    waiting: number;
    /** Waiting past the 15 minutes. */
    late: number;
    active: number;
    quiet14: number;
    quiet30: number;
    enrolledToday: number;
    enrolledThisMonth: number;
    contactedInTime: number;
    contactedThisMonth: number;
  };
  rows: {
    id: number;
    name: string;
    doctorId: number;
    doctor: string;
    doctorPhone: string | null;
    chc: string;
    telesales: string | null;
    patients: number;
    note: string | null;
    enrolledAt: string;
    firstContactAt: string | null;
    lastActivityAt: string | null;
    contactMinutes: number | null;
    waitingMinutes: number | null;
    quietDays: number;
    mine: boolean;
    state: "waiting" | "late" | "active" | "quiet14" | "quiet30";
  }[];
  can: { enrol: boolean; contact: boolean };
};

/** The Country Mentor's field team: each Rx CHC's month so far. */
export type RxField = {
  today: string;
  rows: {
    personId: number;
    name: string;
    seatId: number;
    seat: string;
    area: string | null;
    listed: number;
    visitsDue: number;
    visitsDone: number;
    /** Doctors on the list visited this month, %; null without a list. */
    coverage: number | null;
    newDoctors: number;
    retention: number | null;
    papApproved: number;
    groupsEnrolled: number;
    groupsQuiet: number;
  }[];
};

/** The prescription business at a glance (19 Nov): each person's day and month, the doctors
 *  prescribing most, the guarantee letters by agency from received to paid. */
export type RxBusiness = {
  today: string;
  summary: {
    prescriptions: number;
    prescribers: number;
    newPrescribers: number;
    value: number;
    visitsToday: number;
    visitsDoneToday: number;
    glOpen: number;
    glOpenAmount: number;
    glPaid: number;
  };
  people: {
    personId: number;
    name: string;
    title: string;
    area: string | null;
    visitsToday: number;
    doneToday: number;
    /** Where they checked in last, and when. */
    lastCheckIn: string | null;
    lastCheckInAt: string | null;
    /** This month: orders written with a prescribing doctor, the doctors, the first-time ones, ₱. */
    prescriptions: number;
    prescribers: number;
    newPrescribers: number;
    value: number;
    letters: number;
  }[];
  doctors: {
    customerId: number;
    name: string;
    specialty: string | null;
    city: string | null;
    seller: string | null;
    orders: number;
    value: number;
    lastOn: string;
    firstOn: string;
  }[];
  letters: {
    programme: string;
    received: { count: number; amount: number };
    serving: { count: number; amount: number };
    billed: { count: number; amount: number };
    paid: { count: number; amount: number };
    /** Zoho's history (served before this CRM): count and ₱. */
    zoho: { count: number; amount: number };
  }[];
};

/** A telesales team at a glance (19 Nov): calls and what came of them, callbacks due, orders and
 *  conversion, new against repeat customers, sold, owed, orders stopped; person by person. */
export type TelesalesTeam = {
  today: string;
  summary: {
    callsToday: number;
    callsMonth: number;
    reached: number;
    ordered: number;
    callbacksDue: number;
    orders: number;
    /** Calls this month that ended in an order, %. */
    conversion: number | null;
    newCustomers: number;
    repeatCustomers: number;
    sold: number;
    owed: number;
    stopped: number;
  };
  rows: {
    personId: number;
    seatId: number;
    name: string;
    title: string;
    area: string | null;
    callsToday: number;
    callsMonth: number;
    reached: number;
    ordered: number;
    callbacksDue: number;
    orders: number;
    customers: number;
    newCustomers: number;
    sold: number;
    owed: number;
    stopped: number;
  }[];
};

/** A B2C CHC's day: the morning pulse, the enquiries waiting for a reply, refills, orders. */
export type B2cDay = {
  today: string;
  replyMinutes: number;
  /** The playbook's 8:00 questions, each green or red, with what to do. */
  pulse: { key: string; question: string; value: string; green: boolean; action: string; to: string }[];
  waiting: {
    leadId: number;
    code: string | null;
    name: string;
    source: string;
    lastMessage: string | null;
    since: string;
    minutes: number;
    /** Never bought: a new prospect (answered first). */
    prospect: boolean;
    unassigned: boolean;
  }[];
  refills: Reorders["rows"];
  orders: { quoted: number; atFinance: number; toShip: number; day3: number };
  day3: { orderId: number; code: string; customerId: number; customer: string; phone: string | null; deliveredOn: string }[];
};

/** The coach's B2C desk now. */
export type B2cTeam = {
  today: string;
  rows: {
    personId: number;
    name: string;
    seat: string;
    waiting: number;
    lateToday: number;
    /** Three or more late replies today: the coach is told. */
    alarm: boolean;
    invoicesToday: number;
    invoicedLastDay: boolean;
    noInvoiceYet: boolean;
  }[];
};

/** An NBD's desk: their prospects from first call to hand-over. */
export type NbdDay = {
  today: string;
  prospects: {
    customerId: number;
    name: string;
    kind: CustomerKind;
    city: string | null;
    phone: string | null;
    nbdId: number;
    nbd: string | null;
    licenceNo: string | null;
    licenceExpires: string | null;
    permitNo: string | null;
    permitExpires: string | null;
    tin: string | null;
    nextCallOn: string | null;
    handedOverOn: string | null;
    crr: string | null;
    calls: number;
    lastOutcome: string | null;
    lastCallOn: string | null;
    firstOrderOn: string | null;
    orders: number;
    /** The papers still missing or expired. */
    missing: string[];
    sinceFirst: number | null;
    stage: "prospect" | "contacted" | "papers" | "ordered";
    /** At the 3rd order or day 90: hand it to CRR. */
    ready: boolean;
    /** One order and no second by day 45. */
    flagged: boolean;
    callDue: boolean;
  }[];
  handedOver: NbdDay["prospects"];
  month: { firstOrders: number; worked: number; conversion: number | null };
};

/** A CRR's accounts and each one's health against its own usual gap and 3-month average. */
export type CrrDay = {
  today: string;
  accounts: {
    customerId: number;
    name: string;
    kind: CustomerKind;
    city: string | null;
    phone: string | null;
    lastOrderOn: string;
    usual: number;
    since: number;
    expectedOn: string;
    last30: number;
    avg3: number;
    lastMonth: boolean;
    thisMonth: boolean;
    lastOutcome: string | null;
    lastCallOn: string | null;
    crr: string | null;
    state: "due" | "late" | "stopped" | "lost" | "ok";
    trend: "up" | "flat" | "down";
  }[];
  month: { retention: number | null; up: number; flat: number; down: number };
};

/** The B2B coach's team now. */
export type B2bTeam = {
  today: string;
  nbd: {
    personId: number;
    name: string;
    open: number;
    callsDue: number;
    papersMissing: number;
    ordered: number;
    ready: number;
    flagged: number;
    callsThisMonth: number;
    firstOrdersThisMonth: number;
  }[];
  crr: { personId: number; name: string; accounts: number; late: number; stopped: number; down: number; retention: number | null }[];
  /** Accounts ready to hand over or flagged (no 2nd order by day 45). */
  handOvers: NbdDay["prospects"];
  crrPeople: { personId: number; name: string }[];
  /** Each B2B seat's real accounts, from the invoices (this CRM's and Zoho's); vacant seats too. */
  seats: {
    seatId: number;
    personId: number | null;
    /** The holder, or null for a vacant seat (then `zoho` names whose customers it holds). */
    name: string | null;
    zoho: string | null;
    side: "nbd" | "crr" | null;
    /** Accounts that bought in the last 90 days. */
    active: number;
    /** First order with the company this month. */
    opened: number;
    /** Second order with the company this month (the account is activated). */
    activated: number;
    /** One order only, 45 to 180 days ago, no second yet. */
    oneOrder: number;
    /** Active accounts with no FDA licence (LTO) on file, or one expired. */
    noLicence: number;
    sold: number;
    /** What the seat's customers owe now. */
    owed: number;
  }[];
  /** What the B2B accounts owe, by how late. */
  owedByAge: { age: "not due" | "1–30" | "31–60" | "61–90" | "over 90"; invoices: number; amount: number }[];
};

/** A CLIDP Sales Coach's day. */
export type ClidpDay = {
  today: string;
  /** Volume against target on the working-day pace, %. */
  volume: { pace: number | null; note: string };
  accounts: CrrDay["accounts"];
  owed: { total: number; rows: Collections["rows"] };
  listings: {
    id: number;
    customerId: number;
    customer: string;
    medicine: string;
    brand: string;
    certificateNo: string | null;
    validUntil: string | null;
    daysLeft: number | null;
    state: "valid" | "expiring" | "expired" | "no date";
  }[];
};

/** The hospitals board (19 Nov): each hospital with 2MG's accreditation there, our medicines on its
 *  formulary, its buying against its own gap, open orders, money owed, visits and calls. */
export type HospitalBoard = {
  today: string;
  canEdit: boolean;
  summary: {
    hospitals: number;
    accredited: number;
    /** Accredited, ending within 60 days. */
    expiring: number;
    notAccredited: number;
    formularyApproved: number;
    formularyPending: number;
    due: number;
    late: number;
    stopped: number;
    owed: number;
    overdue: number;
    openOrders: number;
    openValue: number;
    /** This month's visits of the sellers: done, and all planned. */
    visitsDone: number;
    visitsPlanned: number;
  };
  rows: {
    customerId: number;
    name: string;
    kind: string;
    city: string | null;
    seller: string | null;
    lastOrderOn: string | null;
    since: number | null;
    usual: number | null;
    soldMonth: number;
    soldYear: number;
    owed: number;
    overdue: number;
    openOrders: number;
    openValue: number;
    lastVisitOn: string | null;
    nextVisitOn: string | null;
    lastCallOn: string | null;
    reorder: "never" | "ok" | "due" | "late" | "stopped" | "lost";
    accreditation: {
      status: "applied" | "accredited" | "refused" | null;
      onDay: string | null;
      validUntil: string | null;
      daysLeft: number | null;
      state: "none" | "applied" | "accredited" | "expiring" | "expired" | "refused";
    };
    formulary: {
      approved: number;
      requested: number;
      items: { medicine: string; status: "requested" | "approved" | "not_approved" | "removed"; onDay: string; doctor: string | null }[];
    };
  }[];
};

/** A step on CLIDP's road with a distributor or pharmacy (migration 0127). */
export type ClidpStage = "approached" | "interested" | "agreed" | "filed" | "listed" | "ordering" | "declined";

/** CLIDP's road (Aryan, 19 Nov: "how many pharmacies we went to, did they approve us, at what
 *  rate"): each account's stage and day, the rate agreed and the price really paid last, its
 *  listings, the agreement's end, the next step, its reorder state and what it owes. */
export type ClidpRoad = {
  today: string;
  canEdit: boolean;
  coaches: {
    personId: number;
    name: string;
    approached: number;
    agreed: number;
    listed: number;
    ordering: number;
    late: number;
    listingsEnding: number;
    owed: number;
    overdue: number;
  }[];
  counts: Record<ClidpStage, number>;
  /** This month's moves on the road. */
  month: { approached: number; agreed: number; listed: number; declined: number; firstOrders: number };
  rows: {
    customerId: number;
    name: string;
    kind: string;
    city: string | null;
    coach: string | null;
    stage: ClidpStage;
    /** The day it reached its stage (an account buying: its first order). */
    stageOn: string | null;
    approachedOn: string | null;
    agreedOn: string | null;
    listedOn: string | null;
    declinedReason: string | null;
    agreementUntil: string | null;
    nextStep: string | null;
    nextOn: string | null;
    note: string | null;
    rates: { medicine: string; unitPrice: number; moq: number | null; agreedOn: string }[];
    lastPrices: { medicine: string; unitPrice: number; qty: number; on: string }[];
    listings: {
      brand: string;
      medicine: string;
      certificateNo: string | null;
      validUntil: string | null;
      daysLeft: number | null;
      state: "valid" | "expiring" | "expired" | "no date";
    }[];
    lastOrderOn: string | null;
    /** Against its own reorder gap (an account buying). */
    reorder: "due" | "late" | "stopped" | "lost" | "ok" | null;
    usual: number | null;
    soldYear: number;
    firstOrderOn: string | null;
    owed: number;
    overdue: number;
  }[];
};

/** The heads' CLIDP coaches. */
export type ClidpTeam = {
  today: string;
  soon: string;
  rows: { personId: number; name: string; pace: number | null; owed: number; accounts: number; late: number; listingsExpiring: number }[];
};

export type TenderStep = "found" | "preparing" | "price_approved" | "submitted" | "won" | "lost" | "contract" | "delivered" | "accepted" | "billed" | "paid" | "dropped";
export type TenderMode = "competitive_bidding" | "limited_source" | "direct_contracting" | "direct_acquisition" | "repeat_order" | "small_value" | "negotiated" | "direct_sales" | "other";

/** A government tender from the PhilGEPS posting to the payment. Money in centavos. */
export type Tender = {
  id: number;
  code: string;
  title: string;
  agencyId: number;
  agency: string;
  philgepsRef: string | null;
  mode: TenderMode;
  abc: number | null;
  ownerId: number;
  owner: string;
  step: TenderStep;
  postedOn: string | null;
  prebidOn: string | null;
  deadlineAt: string | null;
  openingOn: string | null;
  ourBid: number | null;
  winningBid: number | null;
  resultNote: string | null;
  noaOn: string | null;
  ntpOn: string | null;
  deliverBy: string | null;
  deliveredOn: string | null;
  /** The Inspection and Acceptance Report's day: the government owes from it. */
  acceptedOn: string | null;
  billedOn: string | null;
  paidOn: string | null;
  bidSecurityForm: string | null;
  bidSecurityAmount: number | null;
  bidSecurityBackOn: string | null;
  priceApprovedBy: string | null;
  papers: { paper: string; done: boolean }[];
  droppedReason: string | null;
  /** The agency's city: where the bid was. */
  agencyCity: string | null;
  /** Why it was won or lost, in fixed words (migration 0126). */
  resultReason: TenderReason | null;
  /** The day the result came (the Notice of Award for a win). */
  resultOn: string | null;
  performanceSecurityForm: string | null;
  performanceSecurityAmount: number | null;
  performanceSecurityBackOn: string | null;
  /** The 1% kept on medicines for three months after acceptance. */
  retentionAmount: number | null;
  retentionBackOn: string | null;
};

/** Why a tender was won or lost (the bid report's words). */
export type TenderReason = "lowest" | "lower_price" | "above_abc" | "documents" | "post_disqualified" | "failed_bidding" | "other";

/** A bidder read at the opening (the abstract of bids). Money in centavos. */
export type TenderBidder = {
  id: number;
  name: string;
  price: number | null;
  /** Their price for one piece of our medicines, item by item. */
  lines: { medicineId: number; unitPrice: number }[];
  disqualified: boolean;
  note: string | null;
  by: string;
  at: string;
};

/** Where our bid stood among the bids read (ours and every bidder's, the lowest first). */
export type TenderStanding = {
  bids: { name: string; price: number; us: boolean; disqualified: boolean }[];
  lowest: { name: string; price: number; us: boolean } | null;
  /** Our place among the bids not disqualified (1 = the lowest). */
  rank: number | null;
  /** How far ours was above the lowest (centavos, and % of the lowest). */
  gap: number | null;
  gapPct: number | null;
};

/** The bid report (Aryan, 19 Nov): where we bid, every price read, won or lost and why, how low it
 *  went; then by agency, the reasons, the securities still out, late deliveries, what is coming. */
export type BidReport = {
  today: string;
  from: string;
  to: string;
  summary: {
    joined: number;
    won: number;
    wonValue: number;
    lost: number;
    lostValue: number;
    pending: number;
    failed: number;
    winRate: number | null;
    /** On the bids lost: how far above the winner we were, on average (%). */
    avgGapPct: number | null;
  };
  rows: (Pick<
    Tender,
    "id" | "code" | "title" | "agency" | "agencyCity" | "owner" | "abc" | "ourBid" | "step" | "openingOn" | "resultOn" | "resultReason" | "resultNote" | "mode"
  > &
    TenderStanding & { result: "won" | "lost" | "pending" | "failed" })[];
  byAgency: { agency: string; city: string | null; joined: number; won: number; lost: number; wonValue: number }[];
  byReason: { reason: TenderReason; count: number }[];
  securities: { code: string; id: number; agency: string; kind: "bid" | "performance" | "retention"; amount: number; dueBack: string | null }[];
  late: { code: string; id: number; agency: string; deliverBy: string; daysLate: number; penalty: number }[];
  comingUp: Pick<Tender, "id" | "code" | "title" | "agency" | "agencyCity" | "owner" | "abc" | "step" | "deadlineAt" | "prebidOn" | "openingOn">[];
};

/** A notice the tender finder's robot found on PhilGEPS or PS-PhilGEPS. Money in centavos. */
export type FoundTender = {
  id: number;
  source: "philgeps" | "ps";
  refNo: string;
  title: string;
  /** The procuring entity as the portal writes it, and the CRM customer it is (when known). */
  agency: string | null;
  agencyId: number | null;
  customer: string | null;
  noticeType: string | null;
  procurementMode: string | null;
  abc: number | null;
  publishedOn: string | null;
  closingAt: string | null;
  link: string | null;
  /** Our molecules it asks for. */
  molecules: string[];
  firstSeenAt: string;
  screenedAt: string | null;
  screenedBy: string | null;
  tenderId: number | null;
  tenderCode: string | null;
  /** Still open for bids (no closing date read, or it is not past). */
  open: boolean;
  lines: number;
  /** Its type as the bidding system shows it: ITB, RFQ, Negotiated, … ("" when none is read). */
  type: string;
  /** How many of its papers are kept or named; and what the robot said of them (pick-up, downloaded, …). */
  files: number;
  docsStatus: string | null;
};

/** The bidding system's document chips: all, with papers, pick-up only, none yet. */
export type FoundDocs = "all" | "with" | "pickup" | "none";
/** Its sorts: latest published (default), oldest published, closing soonest, highest budget. */
export type FoundSort = "latest" | "oldest" | "closing" | "budget";

/** opportunities: every tender found that is ours, any state: asking for one of our medicines, or on PS-PhilGEPS's Bid Match. */
export type FoundView = "opportunities" | "screened" | "tenders" | "all";

/** One run of the robot, as it reported it. */
export type FindRun = { id: number; source: "philgeps" | "ps"; trigger: string | null; status: "success" | "failed"; summary: string | null; found: number; matched: number; fresh: number; at: string };

export type FoundList = {
  view: FoundView;
  docs: FoundDocs;
  sort: FoundSort;
  /** The page shown (from 1), how many one page holds (25, 50 or 100), and how many are listed in all. */
  page: number;
  pageSize: number;
  total: number;
  rows: FoundTender[];
  /** Each tab's count and each document chip's, under the same search and filters. */
  counts: Record<FoundView, number>;
  docCounts: Record<FoundDocs, number>;
  /** The summary cards over what is listed: how many, of how many of ours (medicines left out excluded);
   *  our medicines asked for, of how many in the tab; the budgets' total (centavos); papers and of how many tenders. */
  stats: { listed: number; ours: number; products: number; productsAll: number; abc: number; files: number; withFiles: number };
  /** Our medicines in the tab, most asked for first (Our product, Exclude products), and the types present. */
  products: { name: string; n: number }[];
  types: { code: string; n: number }[];
  /** Our molecules among what was found, A to Z. */
  molecules: string[];
  /** The robot: whether it has a way in on this server, its last runs, and where its PhilGEPS
   *  log-in for the tender papers stands ("refused" stops it until a person says to try again). */
  robot: {
    ready: boolean;
    runs: FindRun[];
    login: { state: "never" | "ok" | "refused" | "busy" | "trouble"; at: string | null; said: string | null };
    /** The PS-PhilGEPS robot: connected or not (a person's captcha tick makes its session), and its last Sync. */
    ps: {
      connected: boolean;
      connectedAt: string | null;
      status: string | null;
      stage: string | null;
      error: string | null;
      finishedAt: string | null;
      /** The last step of a laptop log-in: started | submitted | rejected | ok | error | cancelled | paused, with what was said. */
      login: { outcome: string; detail: string | null; source: string | null; at: string } | null;
    };
    /** Fetch now: whether a person can start the robot at once from this server, and how it went. */
    fetch: FetchState;
  };
};

/** How Fetch now starts the robot on this server: GitHub's workflow, on this computer, or not at all. */
export type FetchWay = "github" | "local" | "off";
/** Fetch now on one portal's card. */
export type PortalFetch = {
  /** A press still waiting for its run, or pressed in the last 10 minutes; done once a run of that portal started by a person came in. */
  running: { by: string | null; at: string; done: boolean } | null;
  /** The last press that could not start, until a run of that portal comes after it. */
  failed: { at: string; note: string | null } | null;
};
export type FetchState = { way: FetchWay; philgeps: PortalFetch; ps: PortalFetch };

/** A found notice's papers: the files the robot got from PhilGEPS and what it said of them. */
export type FoundPapers = {
  files: { id: number; kind: "paper" | "bulletin"; name: string; size: number }[];
  /** downloaded | pick-up | closed | needs-payment | none-found | no-order-link | order-flow-changed; null = not looked at yet. */
  status: string | null;
  remark: string | null;
  checkedAt: string | null;
  readNote: string | null;
  /** Scanned pages still waiting for their reading. */
  reading: boolean;
  /** How well the papers were read, 0 to 100. */
  accuracy: number | null;
  /** What the bid data sheet says, as written. */
  sheet: { key: "prebid_conference" | "bid_opening" | "bid_submission_deadline" | "delivery_period" | "bid_validity" | "bid_security" | string; label: string; said: string }[];
};

/** A line a found notice asks for. */
export type FoundLine = {
  id: number;
  origin: "notice" | "papers";
  itemNo: string | null;
  description: string;
  qty: number | null;
  unit: string | null;
  /** The budget for one piece and for the line. */
  abcUnit: number | null;
  abcTotal: number | null;
  molecules: string[];
  /** Our medicine it is (matched, or picked by a person), and the ones it could be. */
  medicineId: number | null;
  medicine: string | null;
  candidates: { id: number; name: string; price: number | null }[];
};

export type FoundDetail = {
  found: FoundTender & {
    itemsText: string | null;
    /** When the robot last read it (the bidding system's "Last fetched"). */
    seenAt: string;
    details: {
      solicitationNo: string | null;
      classification: string | null;
      areaOfDelivery: string | null;
      deliveryPeriod: string | null;
      contactName: string | null;
      contactInfo: string[];
      preBid: string | null;
      bidOpening: string | null;
      status: string | null;
      /** When the portal says the notice last changed, as written. */
      lastUpdated: string | null;
      supplements: { no: string; title: string; type: string; published: string | null }[];
      documents: string[];
    };
  };
  lines: FoundLine[];
  papers: FoundPapers;
  events: { what: string; note: string | null; by: string; at: string }[];
  /** For "Make it a tender": the customers the agency could be, the mode and days read. */
  agencies: { id: number; name: string; city: string | null }[];
  mode: TenderMode;
  prebidOn: string | null;
  openingOn: string | null;
};

export type TenderInput = {
  agencyId: number;
  title: string;
  philgepsRef?: string | null;
  mode: TenderMode;
  abc?: number | null;
  postedOn?: string | null;
  prebidOn?: string | null;
  deadlineAt?: string | null;
  openingOn?: string | null;
};

export type CompanyPaper = {
  id: number;
  name: string;
  number: string | null;
  expiresOn: string | null;
  note: string | null;
  daysLeft: number | null;
  state: "valid" | "expiring" | "expired";
};

/** The bidding desk: deadlines, prices to approve, the awards on their way to payment. */
export type TenderDesk = {
  today: string;
  deadlines: Tender[];
  toApprove: Tender[];
  awaiting: Tender[];
  toDeliver: Tender[];
  toAccept: Tender[];
  toBill: Tender[];
  toCollect: Tender[];
  month: { won: number; lost: number; winRate: number | null; wonValue: number };
  resultsCount: number;
  papersEnding: CompanyPaper[];
  canApprove: boolean;
};

/** Modern Trade's day: the chains, their money, their listings. */
export type MtDay = {
  today: string;
  /** The chains: Modern Trade's areas' customers and those its seats invoiced, each against its gap. */
  chains: CrrDay["accounts"];
  /** Each chain's money with Modern Trade (its seats' invoices, this CRM's and Zoho's), what it
   *  deducted and sent back in 12 months. */
  money: {
    customerId: number;
    name: string;
    /** The seat that invoiced it last: its holder, or null when vacant (then `zoho`). */
    seller: string | null;
    zoho: string | null;
    soldMonth: number;
    sold12: number;
    owed: number;
    overdue: number;
    /** Days since the oldest unpaid invoice was issued. */
    oldestDays: number | null;
    deducted: number;
    returns: number;
    returnsCredit: number;
  }[];
  /** Modern Trade's seats: the COO's own and her sellers', vacant ones too. */
  seats: { seatId: number; title: string; lead: boolean; name: string | null; zoho: string | null; chains: number; soldMonth: number; owed: number }[];
  /** What the chains deducted from their payments in 12 months, by why (Finance records each). */
  deductions: { kind: DeductionKind; count: number; amount: number }[];
  /** The chains' returns in 12 months, by why. */
  returns: { reason: string; count: number; credit: number }[];
  listings: { id: number; customerId: number; chain: string; medicine: string; branches: number; listed: boolean; since: string }[];
};

/** A person's own work log (optional): what they did, today, tomorrow. */
export type WorkLog = {
  today: string;
  todayEntry: WorkLog["entries"][number] | null;
  entries: { day: string; done: string | null; today: string | null; tomorrow: string | null; at: string }[];
};

/** Everyone's (or a team's) work log for a day. */
export type WorkLogDay = {
  day: string;
  today: string;
  entries: (WorkLog["entries"][number] & { personId: number; name: string; title: string | null; unit: string | null })[];
};

// ---- In-licensing & Regulatory (docs/PLAN.md 16.9) ----

export type PipelineStage = "identified" | "talks" | "agreement" | "dossier" | "filed" | "registered" | "launched" | "dropped";
export type RegistrationStatus = "preparing" | "filed" | "approved" | "renewal_filed" | "expired" | "withdrawn";

export type PipelineRow = {
  id: number;
  name: string;
  generic: string | null;
  strength: string | null;
  partner: string | null;
  country: string | null;
  stage: PipelineStage;
  handledBy: { id: number; name: string } | null;
  nextStep: string | null;
  nextOn: string | null;
  note: string | null;
  updatedOn: string;
  /** The registration Regulatory Affairs opened for it, once handed over. */
  registrationId: number | null;
};

export type RegistrationRow = {
  id: number;
  product: string;
  medicineId: number | null;
  pipelineId: number | null;
  number: string | null;
  status: RegistrationStatus;
  filedOn: string | null;
  validUntil: string | null;
  /** Days left before it expires (negative: past), for an approved one. */
  daysLeft: number | null;
  /** soon: within 180 days and no renewal filed; urgent: within 90; expired. */
  flag: "soon" | "urgent" | "expired" | null;
  handledBy: { id: number; name: string } | null;
  note: string | null;
};

export type RegEvent = { at: string; what: string; by: string };

/** The In-licensing & Regulatory desk: whichever team the seat is in, and both lists to read. */
export type RegulatoryDesk = {
  today: string;
  /** inlicensing or ra by the seat's title; null for the Founder, the Admin and the bidding desk. */
  team: "inlicensing" | "ra" | null;
  canPipeline: boolean;
  canRegistrations: boolean;
  people: { id: number; name: string; title: string | null }[];
  pipeline: PipelineRow[];
  registrations: RegistrationRow[];
};

// ---- The books: Zoho Inventory's Sales and Purchases documents (docs/PLAN.md 17) ----

export type BookKind =
  | "purchase_order" | "purchase_receive" | "bill" | "vendor_payment" | "vendor_credit"
  | "sales_order" | "invoice" | "customer_payment" | "sales_return" | "credit_note"
  | "package" | "shipment" | "transfer_order" | "adjustment"
  | "expense" | "journal" | "transfer_fund" | "deposit" | "refund" | "recurring_bill" | "recurring_expense" | "fixed_asset";

/** Nothing, some or all of an order line's quantity done (received, billed…): Zoho's dots. */
export type DoneState = "none" | "partial" | "full";

export type BookRow = {
  id: number;
  number: string;
  reference: string | null;
  date: string;
  dueDate: string | null;
  /** Zoho's key (issued, partially_billed…); a bill past its due day with money owed is overdue. */
  status: string;
  /** Days past due, for an overdue bill or invoice. */
  overdueDays: number | null;
  party: string | null;
  partyId: number | null;
  currency: string;
  /** Centavos of the document's currency. */
  total: number;
  balance: number;
  received: DoneState | null;
  billed: DoneState | null;
  /** The purchase order a receive is for; the bills a payment was put on. */
  linked: string | null;
  mode: string | null;
  /** Centavos of a payment or credit not put on any bill yet. */
  unused: number | null;
  qty: number | null;
  /** A sales order's dots: invoiced, paid, packed, shipped (Zoho's), and how it goes out. */
  invoiced?: DoneState | null;
  paid?: DoneState | null;
  packed?: DoneState | null;
  shipped?: DoneState | null;
  deliveryMethod?: string | null;
  /** Made in this CRM (its order line), not brought from Zoho: opens the CRM's own record too. */
  crm?: { href: string } | null;
  /** An inventory document's own columns: reason, type, warehouses, carrier, package… */
  extra?: Record<string, string | number | null> | null;
};

/** An account of Zoho Books' chart, with what moved on it (centavos; balance = debits less credits). */
export type BookAccountRow = {
  id: number;
  name: string;
  code: string | null;
  /** Zoho's type key: bank, cash, expense, other_current_asset… */
  type: string;
  /** Asset, liability, equity, income or expense. */
  head?: string;
  parent: string | null;
  parentId: number | null;
  active: boolean;
  balance: number;
  debits: number;
  credits: number;
  moves: number;
  lastOn: string | null;
};
export type BookAccountList = { views: { key: string; count: number }[]; view: string; rows: BookAccountRow[] };
export type BookEntryRow = {
  docId: number;
  /** A book document's kind, or this CRM's own ("crm_invoice", "crm_payment"…). */
  kind: BookKind | CrmEntryKind;
  number: string;
  date: string;
  reference: string | null;
  party: string | null;
  debit: number;
  credit: number;
  /** This CRM's own entries: where the record opens. */
  link: string | null;
};
/** This CRM's own documents in the books (migration 0096). */
export type CrmEntryKind = "crm_invoice" | "crm_payment" | "crm_refund" | "crm_return" | "crm_stock" | "crm_sample";
export type BookAccountDetail = BookAccountRow & {
  description: string | null;
  currency: string;
  fields: Record<string, unknown>;
  /** What moved on it, by kind of document. */
  kinds: { kind: BookKind; count: number; debit: number; credit: number }[];
  page: number;
  perPage: number;
  total: number;
  entries: BookEntryRow[];
};
export type Banking = { accounts: BookAccountRow[]; totals: { bank: number; cash: number; clearing: number; card: number } };

export type BookList = {
  kind: BookKind;
  today: string;
  views: { key: string; count: number }[];
  view: string;
  page: number;
  perPage: number;
  total: number;
  rows: BookRow[];
};

export type BookLine = {
  id: number;
  n: number;
  medicineId: number | null;
  medicine: string | null;
  itemName: string | null;
  sku: string | null;
  description: string | null;
  account: string | null;
  warehouse: string | null;
  unit: string | null;
  qty: number | null;
  rate: number | null;
  taxName: string | null;
  taxPct: number | null;
  amount: number | null;
  qtyDone: Record<string, number>;
  batches: Record<string, unknown>[];
  fields: Record<string, unknown>;
  /** The order line a receive's or bill's line came from. */
  fromLine: number | null;
};

export type BookLinked = { id: number; kind: BookKind; number: string; date: string; status: string; total: number; balance: number; amount: number | null; on: string | null; direction: "from" | "to" };

export type BookDoc = BookRow & {
  kind: BookKind;
  fxRate: number;
  subTotal: number | null;
  paymentTerms: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  fromZoho: boolean;
  zohoCreated: string | null;
  vendor: { id: number; name: string; company: string | null; email: string | null; phone: string | null; address: string | null; country: string | null } | null;
  /** Files on it (Zoho's, and any added here). */
  files?: { id: number; name: string; mime: string; size: number; uploadedBy: string | null; uploadedOn: string | null }[];
  lines: BookLine[];
  linkedDocs: BookLinked[];
  /** Its debits and credits on the chart of accounts (Finance, the CEO and the Admin see them). */
  entries?: { account: string; accountId: number | null; debit: number; credit: number }[];
};

export type VendorRow = { id: number; name: string; company: string | null; email: string | null; phone: string | null; payables: number; credits: number; active: boolean };
export type VendorList = { views: { key: string; count: number }[]; view: string; page: number; perPage: number; total: number; rows: VendorRow[] };
export type VendorDetail = VendorRow & {
  mobile: string | null;
  website: string | null;
  currency: string;
  country: string | null;
  tin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  paymentTerms: string | null;
  fields: Record<string, unknown>;
  people: { id: number; name: string; email: string | null; phone: string | null; mobile: string | null; designation: string | null }[];
  counts: { kind: BookKind; count: number; total: number }[];
  recent: (BookRow & { kind: BookKind })[];
};

/** What the books' forms pick from. */
/** Purchases' board: what the Inventory and Finance desks act on. Money in centavos of pesos. */
export type PurchaseBoard = {
  today: string;
  /** `old`: how many of them are on the first purchase pages (opened from there). */
  toReceive: { orders: number; pieces: number; late: number; value: number; old: number };
  toBill: { orders: number; value: number };
  bills: { open: number; owed: number; overdue: number; overdueAmount: number; dueThisWeek: number };
  /** Vendor credits and payments not put on a bill yet. */
  unusedCredits: number;
  buyMore: {
    id: number;
    name: string;
    pack: string | null;
    packSize: number;
    /** On the shelf less what placed orders are promised (never under zero). */
    free: number;
    /** What placed orders need beyond the shelf. */
    short: number;
    reorderLevel: number;
    sold30: number;
    coming: number;
    daysLeft: number | null;
    vendorId: number | null;
    vendor: string | null;
    /** In the vendor's currency, as it was typed. */
    lastRate: number | null;
    lastCurrency: string | null;
    lastOn: string | null;
  }[];
  recent: { id: number; kind: BookKind; number: string; party: string | null; date: string; total: number; currency: string; status: string; fromZoho: boolean }[];
};
export type PurchaseOrderExtra = {
  batches: { receiveId: number; receive: string; date: string; lineId: number | null; batchNo: string | null; expiresOn: string | null; qty: number; warehouse: string | null; orderCost: number; costNow: number | null }[];
  /** `pending`: the part still to be put on goods not received yet. */
  landed: { id: number; number: string; vendor: string | null; date: string; amount: number; pending: number; status: string }[];
  /** Whose order it is, for the printed purchase order. */
  company: CompanyInfo;
};
export type VendorItems = {
  items: { medicineId: number | null; name: string; orders: number; qty: number; lastRate: number | null; currency: string | null; lastOn: string }[];
};

export type BookChoices = {
  today: string;
  vendors: { id: number; name: string; currency: string; paymentTerms: string | null }[];
  warehouses: { id: number; name: string }[];
  medicines: { id: number; name: string; sku: string | null; unit: string | null }[];
  accounts: string[];
  modes: string[];
  paidThrough: string[];
  next: { purchaseOrder: string; receive: string; payment: string; vendorCredit: string };
  /** Purchase orders sent to a vendor: a freight, customs, airfare or other bill can be added to
   *  their goods' cost (landed cost), before or after they come. Newest first. */
  /** `worth`: the order's total in pesos' centavos. */
  receivedOrders: { id: number; number: string; party: string; date: string; worth: number }[];
};

export type CustomerKind2 = "hospital" | "doctor" | "patient" | "drugstore" | "distributor" | "government";
export type BookCustomerRow = { id: number; name: string; kind: CustomerKind2; company: string | null; email: string | null; phone: string | null; city: string | null; receivables: number; credits: number; active: boolean };
export type BookCustomerList = { views: { key: string; count: number }[]; view: string; page: number; perPage: number; total: number; rows: BookCustomerRow[] };
export type BookCustomer = BookCustomerRow & {
  code: string | null;
  address: string | null;
  tin: string | null;
  licenceNo: string | null;
  licenceExpires: string | null;
  permitNo: string | null;
  permitExpires: string | null;
  paymentTerms: string;
  paymentDays: number | null;
  creditLimit: number | null;
  specialty: string | null;
  worksAt: { id: number; name: string } | null;
  area: string | null;
  note: string | null;
  createdOn: string;
  /** What Zoho kept about them that has no place of its own here. */
  zohoFields: Record<string, unknown>;
  /** A patient's details as their orders carried them (Zoho's PX fields, doctor, senior / PWD). */
  patient: Record<string, string> | null;
  /** Doctors who work at this hospital; the hospitals a doctor's patients were sent from. */
  doctors: { id: number; name: string; specialty: string | null }[];
  people: { id: number; name: string; email: string | null; phone: string | null; mobile: string | null; designation: string | null }[];
  counts: { kind: BookKind; count: number; total: number }[];
  recent: (BookRow & { kind: BookKind })[];
};

export type BookItemRow = { id: number; name: string; sku: string | null; status: string; unit: string | null; rate: number | null; reorderLevel: number | null; stock: number | null; medicineId: number | null; zoho: boolean };
export type BookItemList = { views: { key: string; count: number }[]; view: string; page: number; perPage: number; total: number; rows: BookItemRow[] };
export type BookItem = BookItemRow & {
  itemType: string | null;
  purchaseRate: number | null;
  fields: Record<string, unknown>;
  zohoStock: Record<string, unknown>;
  zohoBatches: Record<string, unknown>[];
  /** This CRM's own stock of the medicine, by warehouse and batch. */
  warehouses: { name: string; qty: number }[];
  batches: { batchNo: string; expiresOn: string; qty: number; warehouse: string }[];
  committed: number;
  medicine: { id: number; name: string; generic: string | null; strength: string | null; form: string | null; pack: string | null } | null;
  /** Documents with this item, newest first. */
  recent: (BookRow & { kind: BookKind; qty: number | null })[];
};
export type BookPriceList = { id: number; name: string; currency: string | null; kind: string | null; details: string | null; scheme: string | null; rounding: string | null; status: string | null };

// ---------------------------------------------------------------- statements (ERP phase 1)

/** One account's line on a statement (its amount on the statement's own side). */
export type StatementLine = { account: string; accountId: number | null; type: string | null; amount: number };
export type TrialBalance = {
  asOf: string;
  lines: (StatementLine & { head: string; debit: number; credit: number })[];
  totals: { debit: number; credit: number; difference: number };
};
export type PlTotals = {
  income: number;
  costOfSales: number;
  grossProfit: number;
  /** Gross profit over income, in %. */
  grossMargin: number | null;
  expenses: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpenses: number;
  netProfit: number;
};
export type ProfitAndLoss = {
  from: string;
  to: string;
  parts: { income: StatementLine[]; costOfSales: StatementLine[]; expenses: StatementLine[]; otherIncome: StatementLine[]; otherExpenses: StatementLine[] };
  totals: PlTotals;
  /** The same number of days just before. */
  before: { from: string; to: string; totals: PlTotals };
  notes: string[];
};
export type BalanceSheet = {
  asOf: string;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  /** Earned and not yet closed into equity. */
  profitToDate: number;
  /** Accounts the documents name that the chart doesn't have (debit less credit). */
  notInChart: StatementLine[];
  totals: { assets: number; liabilities: number; equity: number; difference: number };
};
export type CashFlow = {
  from: string;
  to: string;
  accounts: { account: string; accountId: number; type: string; opening: number; in: number; out: number; closing: number }[];
  what: { what: string; in: number; out: number; net: number }[];
  totals: { opening: number; in: number; out: number; closing: number };
};
export type VatSummary = {
  from: string;
  to: string;
  /** Output VAT on sales, input VAT on bills and expenses, other Tax Payable moves, tax withheld from us (2307). */
  months: { month: string; output: number; input: number; other: number; withheld: number; net: number }[];
  totals: { output: number; input: number; other: number; withheld: number; net: number };
};
export type PayablesAging = {
  today: string;
  suppliers: { supplier: string; supplierId: number | null; bills: number; current: number; d30: number; d60: number; d90: number; older: number; total: number }[];
  totals: { current: number; d30: number; d60: number; d90: number; older: number; total: number; bills: number };
};
export type GrossProfitBy = "medicine" | "channel" | "customer" | "order" | "branch";
export type GrossProfit = {
  from: string;
  to: string;
  by: GrossProfitBy;
  rows: { key: string; label: string; link: string | null; qty: number; revenue: number; cost: number; profit: number; margin: number | null; uncosted: boolean }[];
  totals: { revenue: number; cost: number; profit: number; margin: number | null };
  /** Billed in these days with the goods not out yet: no cost to count yet. */
  notOut: { invoices: number; total: number };
};
export type MoneySummary = {
  today: string;
  /** Gross profit this month on the CRM's orders whose goods have left. */
  profit: GrossProfit["totals"];
  notOut: GrossProfit["notOut"];
  owed: number;
  billed90: number;
  /** Days of sales owed: owed now against the last 90 days' billing. */
  dso: number | null;
};

// ---------------------------------------------------------------- to decide (ERP phase 2)

/** One kind of decision waiting (or one ask), how many, and the page where it is made. */
export type DecisionLine = { key: string; label: string; count: number; to: string; kind: "orders" | "people"; since?: string };
export type Decisions = { forMe: DecisionLine[]; mine: DecisionLine[]; total: number };
/** Who did what, when (ERP phase 2): one line of any of the CRM's logs. */
export type AuditTrail = {
  kinds: { key: string; label: string }[];
  page: number;
  more: boolean;
  lines: { at: string; who: string; kind: string; record: string | null; link: string | null; what: string }[];
};
/** One of the old CRM's insight reports (ERP phase 2): its columns, rows and totals, ready to show and export. */
export type Insight = {
  title: string;
  note: string;
  columns: { key: string; label: string; kind: "text" | "money" | "number" | "percent" }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number>;
};
/** A batch traced for a recall (ERP phase 3): where it is, every move, every customer it reached. */
export type BatchTrace = {
  batches: { id: number; batchNo: string; medicineId: number; medicine: string; expires: string | null; unitCost: number | null; onHand: number }[];
  places: { batchId: number; warehouse: string; qty: number }[];
  moves: { batchId: number; at: string; kind: string; qty: number; warehouse: string; ref: string | null; note: string | null; by: string; orderId: number | null; customer: string | null }[];
  customers: { customerId: number; name: string; kind: string; phone: string | null; address: string | null; city: string | null; orders: string; pieces: number; first: string; last: string; returned: number }[];
};

// ---------------------------------------------------------------- samples and gifts (ERP phase 3)

export type SampleKind = "samples" | "gifts";
export type SampleLineInput = { medicineId: number; qty: number };
export type SampleRequestStatus = "submitted" | "approved" | "rejected" | "withdrawn" | "issued" | "received";
export type SamplesOfPerson = {
  personId: number;
  person: string;
  month: string;
  own: boolean;
  held: { kind: SampleKind; batchId: number; batchNo: string; medicineId: number; medicine: string; expires: string | null; qty: number; tone: "ok" | "soon" | "expired" }[];
  requests: { id: number; code: string; kind: SampleKind; status: SampleRequestStatus; note: string | null; rejectReason: string | null; askedAt: string; lines: { medicine: string; qty: number }[] }[];
  month_: { givenSamples: number; givenGifts: number; doctors: number; receivedSamples: number; receivedGifts: number; countedSamples: boolean; countedGifts: boolean };
  can: { ask: boolean };
};
export type TeamSamples = {
  month: string;
  reps: { personId: number; name: string; samples: number; gifts: number; received: number; given: number; doctors: number; counted: boolean; difference: number }[];
  requests: { id: number; code: string; kind: SampleKind; status: SampleRequestStatus; note: string | null; personId: number; person: string; askedAt: string; lines: { medicine: string; qty: number }[]; canDecide: boolean; canIssue: boolean }[];
  counts: { person: string; kind: SampleKind; medicine: string; difference: number; reason: string | null; at: string }[];
  doctors: { customerId: number; doctor: string; person: string; medicines: string; pieces: number; visits: number }[];
  can: { send: boolean };
};
/** Every file about a customer (ERP phase 4): where it came from, what it is, where it opens. */
export type CustomerFiles = {
  files: { source: "customer" | "order" | "case" | "sample"; kind: string; name: string; mime: string; at: string; by: string; record: string | null; link: string | null; url: string }[];
};

// ---------------------------------------------------------------- complaints and side-effects

export type ComplaintKind = "quality" | "side_effect" | "delivery" | "service" | "other";
export type ComplaintInput = {
  kind: ComplaintKind;
  serious?: boolean;
  customerId?: number | null;
  patientName?: string | null;
  medicineId?: number | null;
  batchNo?: string | null;
  orderId?: number | null;
  description: string;
  receivedOn?: string | null;
};
export type ComplaintList = {
  view: "open" | "closed" | "all";
  rows: {
    id: number;
    code: string;
    kind: ComplaintKind;
    kindLabel: string;
    serious: boolean;
    status: "open" | "investigating" | "closed";
    description: string;
    receivedOn: string;
    dueOn: string;
    late: boolean;
    customerId: number | null;
    customer: string | null;
    patientName: string | null;
    medicine: string | null;
    batchNo: string | null;
    orderId: number | null;
    orderCode: string | null;
    reportedBy: string;
    owner: string | null;
    ownerId: number | null;
    fdaRef: string | null;
    outcome: string | null;
    events: { at: string; message: string }[];
  }[];
  counts: { open: number; late: number; serious: number };
  can: { handle: boolean };
};

// ------------------------------------------------------------------ writing the books (docs/BOOKS-PLAN.md)

export type LockModule = "all" | "sales" | "purchases" | "banking" | "accountant";
export type BookLocks = {
  locks: { module: LockModule; lockDate: string; reason: string | null; by: string | null; at: string }[];
  log: { module: LockModule; action: "lock" | "unlock"; lockDate: string | null; reason: string | null; by: string | null; at: string }[];
};

/** What the expense, journal, transfer, deposit and credit note forms pick from. */
export type LedgerChoices = {
  today: string;
  accounts: { id: number; name: string; code: string | null; type: string; parent: string | null }[];
  moneyAccounts: { name: string; type: string }[];
  taxes: { id: number; name: string; pct: number; kind: "vat" | "withholding" | "other" }[];
  options: Record<string, string[]>;
  people: { id: number; name: string }[];
  vendors: { id: number; name: string }[];
  next: { expense: string; journal: string; transfer: string; deposit: string; creditNote: string; refund: string };
  locks: { module: LockModule; lockDate: string }[];
};

export type BookExpenseLineInput = { account: string; amount: number; description?: string | null; taxId?: number | null };
export type BookExpenseInput = {
  date: string;
  /** Itemized: one line per account; else one. Amounts in centavos. */
  lines: BookExpenseLineInput[];
  taxInclusive: boolean;
  paidThrough: string;
  supplierId?: number | null;
  customerId?: number | null;
  reference?: string | null;
  notes?: string | null;
  costCentre: string;
  type: string;
  department: string;
  pic: string;
  voucher?: string | null;
  orNumber?: string | null;
};

export type JournalLineInput = { account: string; description?: string | null; contact?: string | null; debit: number; credit: number; taxId?: number | null };
export type JournalInput = {
  date: string;
  number?: string | null;
  reference?: string | null;
  notes: string;
  department: string;
  company: string;
  pic?: string | null;
  reverseOn?: string | null;
  publish: boolean;
  lines: JournalLineInput[];
};

export type TransferInput = { date: string; from: string; to: string; amount: number; reference?: string | null; notes?: string | null };
export type DepositInput = { date: string; to: string; from: string; amount: number; reference?: string | null; notes?: string | null; payer?: string | null };

export type CreditNoteLineInput = { medicineId?: number | null; itemName?: string | null; account?: string | null; description?: string | null; qty: number; rate: number; taxId?: number | null };
export type CreditNoteInput = { customerId: number; date: string; reference?: string | null; reason: string; notes?: string | null; lines: CreditNoteLineInput[] };
export type CreditRefundInput = { date: string; amount: number; from: string; mode?: string | null; reference?: string | null; notes?: string | null };

export type AccountInput = { name: string; code?: string | null; type: string; parentId?: number | null; description?: string | null };

// ------------------------------------------------------------------ bank statements and reconciliation

/** One document's entries on a bank account: 'books:<doc>' or 'crm:<kind>:<id>'; amount into the bank positive. */
export type BankEntry = { key: string; kind: string; docId: number; date: string; amount: number; number: string | null; party: string | null };
export type BankLineRow = {
  id: number;
  date: string;
  description: string | null;
  reference: string | null;
  amount: number;
  status: "uncategorized" | "matched" | "categorized" | "excluded";
  entryKey: string | null;
  /** The kind of the book document it stands for, to open it. */
  docKind: BookKind | null;
  reconciled: boolean;
  suggestions?: BankEntry[];
};
export type BankStatement = { account: string; view: string; counts: Record<string, number>; booksBalance: number; lines: BankLineRow[] };
export type BankReconcileView = {
  account: string;
  end: string;
  /** The day after the last reconciliation (null for the first). */
  start: string | null;
  opening: number;
  entries: (BankEntry & { onStatement: boolean })[];
  history: { id: number; start: string; end: string; opening: number; closing: number; status: "done" | "undone"; by: string | null; at: string }[];
};

/** Books → Home (Zoho Books' Dashboard). Centavos. */
export type BooksDashboard = {
  today: string;
  year: number;
  receivables: { current: number; overdue: number };
  payables: { current: number; overdue: number };
  cashFlow: { opening: number; incoming: number; outgoing: number; closing: number; months: { month: string; incoming: number; outgoing: number; closing: number }[] };
  incomeExpense: { month: string; income: number; expense: number }[];
  topExpenses: { total: number; accounts: { account: string; amount: number }[] };
  banks: { id: number; name: string; type: string; balance: number; uncategorized: number }[];
};

// ------------------------------------------------------------------ sales calls and daily performance

export type SalesCallOutcome = "reached" | "no_answer" | "call_back" | "ordered" | "not_interested" | "won_back";
export type SalesCallInput = { customerId?: number | null; customerName?: string | null; outcome: SalesCallOutcome; note?: string | null; nextOn?: string | null };
export type CallList = {
  from: string;
  to: string;
  rows: { id: number; at: string; person: string | null; personId: number; customer: string | null; customerId: number | null; outcome: string; note: string | null; nextOn: string | null }[];
  perDay: { personId: number; person: string; day: string; n: number }[];
  can: { log: boolean };
};

type PerfCountRow = { key: string; name: string; channel: string; target: number | null; weeks: number[]; total: number; pct: number | null };
/** The B2B team's end-of-day report, from the ERP's own data. Money in centavos, VAT-exclusive. */
export type SalesPerformance = {
  from: string;
  to: string;
  today: string;
  weeks: { key: string; label: string; from: string; to: string }[];
  /** Each day, when the days are 31 or fewer. */
  days: string[];
  revenue: {
    rows: (PerfCountRow & { target110: number | null; btd: number | null })[];
    total: { target: number | null; target110: number | null; weeks: number[]; total: number; pct: number | null; btd: number | null };
  };
  tlb: { rows: PerfCountRow[]; total: { target: number | null; weeks: number[]; total: number; pct: number | null } };
  billing: { rows: PerfCountRow[]; total: { target: number | null; weeks: number[]; total: number; pct: number | null } };
  calls: { rows: { key: string; name: string; channel: string; days: number[]; weeks: number[]; total: number }[]; total: { days: number[]; weeks: number[]; total: number } };
  channels: {
    rows: { channel: string; rank: number; weeks: number[]; days: number[]; total: number; share: number }[];
    total: { weeks: number[]; days: number[]; total: number };
  };
  daily: { people: { key: string; name: string; channel: string; days: number[]; total: number }[] };
  /** The one business line shown, when one was picked. */
  channel: string | null;
  scope: "company" | "team" | "self";
};

/** The month's target sheet (Aryan, 18 Nov 2026): each row as the company's sheet has it, with
 *  what it achieved to the day (centavos, VAT out) and that day's invoicing. */
export type TargetSheet = {
  month: string;
  months: string[];
  day: string;
  rows: {
    id: number;
    head: string;
    channel: string;
    manager: string;
    salesperson: string;
    zoho: string;
    hq: string | null;
    /** Who holds the row's seat in this ERP today. */
    holder: string | null;
    target: number;
    ach: number;
    today: number;
  }[];
  /** Sales this month under names on no row of the sheet. */
  apart: { name: string; ach: number; today: number }[];
};

/** The CEO's custom report (22 Nov): one person, any days, the parts ticked; each part is a table
 *  with its totals, ready to show and to export. */
export type PersonReport = {
  people: { id: number; name: string; title: string | null; role: string; active: boolean }[];
  parts: { key: string; label: string }[];
  person: { id: number; name: string; title: string | null; roleLabel: string; active: boolean; reportsTo: string | null } | null;
  from: string;
  to: string;
  sections: {
    key: string;
    label: string;
    totals: { label: string; value: number; money?: boolean }[];
    columns: { label: string; kind: "text" | "money" | "day" | "time" }[];
    rows: (string | number | null)[][];
    /** Where each row opens, when it has a page. */
    links: (string | null)[];
    /** More rows than shown: narrow the days. */
    more: boolean;
  }[];
};

/** The Admin's Slow screens: every address whose answer took the server longer than slowMs, in the
 *  last two weeks, the costliest first. */
export type SlowScreens = {
  slowMs: number;
  times: number;
  since: string | null;
  rows: { method: string; path: string; times: number; avgMs: number; worstMs: number; questions: number; roles: string; lastAt: string }[];
};

// ---- A person's own profile (account/profile.ts)

export type ProfilePersonal = {
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  /** YYYY-MM-DD. */
  birthDate: string;
};
export type ProfileContact = {
  mobile: string | null;
  personalEmail: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;
};
export type Profile = {
  name: string;
  personal: ProfilePersonal;
  /** First and last name and birth date are saved. */
  complete: boolean;
  contact: ProfileContact;
  work: {
    loginId: string | null;
    position: string | null;
    team: string | null;
    reportsTo: string | null;
    employeeCode: string | null;
    hireDate: string;
  };
  security: {
    twoStep: { on: boolean; since: string | null; codesLeft: number };
    lastSignIn: string | null;
    otherSessions: number;
    /** `by` is set only when someone else did it. */
    events: { id: number; what: string; detail: string | null; by: string | null; at: string }[];
  };
};
/** The sign-in's answer: in, or the password was right and the code is asked next. */
export type SignInAnswer = { me: Me; twoStep?: undefined } | { twoStep: true; ticket: string; me?: undefined };

// ---- Sign-ups (account/sign-up.ts)

export type SignUpInput = {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  email: string;
  phone: string;
  /** What they say they work in: it grants nothing. */
  department: string;
};
export type SignUpRow = {
  id: number;
  name: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  email: string;
  phone: string;
  department: string;
  departmentLabel: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reason: string | null;
  emailedAt: string | null;
  emailProblem: string | null;
  account: "waiting" | "expired" | "ready" | "left" | null;
  /** Whose account already has this email. */
  knownAs: string | null;
  /** A colleague of the same name. */
  sameName: string | null;
};
export type SignUpList = { rows: SignUpRow[]; mailFrom: string | null };
/** `link` only when the email didn't go, for the Admin to pass on. */
export type SignUpSent = { email: string; emailed: boolean; problem: string | null; link: string | null };
export type WelcomeInfo = { firstName: string; email: string; seatLogin: string | null; department: string | null };
