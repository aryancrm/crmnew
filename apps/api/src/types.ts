// What the API sends and takes. The web app imports these types, so the two can't drift.

import type { Role } from "./people/roles";

export type { Role } from "./people/roles";

/** The signed-in person, as every screen needs them. */
export type Me = {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  role: Role;
  roleLabel: string;
  mustChangePassword: boolean;
  /** Their channel, and the Division its orders carry (set in the Admin panel). */
  channel: { code: string; name: string; division: string | null } | null;
  area: { id: number; name: string; cities: string[] } | null;
  reportsTo: { name: string; title: string | null } | null;
  /** The CEO or Admin looking as this person (read only), when it is that. */
  viewedBy?: { id: number; name: string } | null;
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
  /** Sellable pieces in all warehouses. */
  total: number;
  /** Of it, promised to placed orders not packed yet; and what is still free to sell. */
  promised: number;
  free: number;
  status: StockStatus;
  /** Average landed cost of what is on the shelf (centavos). Null when not known or not yours to see. */
  cost: number | null;
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
};

export type MedicineDetail = {
  can: InventoryCan;
  today: string;
  warehouses: Warehouse[];
  buyerTypes: { key: BuyerType; label: string }[];
  medicine: MedicineInput & { id: number; code: string; active: boolean; packSize: number };
  status: StockStatus;
  total: number;
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
};

/** Stock on an open purchase, on its way. */
export type ComingRow = {
  purchaseId: number;
  code: string;
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
  tin?: string | null;
  note?: string | null;
  /** Only those who manage customers set these; from anyone else they are ignored. */
  areaId?: number | null;
  paymentTerms?: PaymentTerms;
  paymentDays?: number | null;
  creditLimit?: number | null;
};

export type CustomerDetail = {
  can: CustomerCan;
  today: string;
  kinds: CustomerList["kinds"];
  areas: { id: number; name: string; channel: string }[];
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
  /** People by name or seat login: the CEO's anyone, a lead's own team. */
  people: {
    id: number;
    name: string;
    title: string | null;
    login: string | null;
    seatId: number | null;
    team: string | null;
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
  kind: "price" | "stock" | "customer" | "licence" | "papers" | "rx" | "owes" | "credit";
  /** A few words for a pill on the card: "Below hospital price". */
  short: string;
  /** What is to be decided, for the card's "Next action". */
  decide: string;
  text: string;
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
  | "done"
  | "all"
  /** Sent back to the MedRep and not placed again yet. */
  | "sent"
  /** Dispatch's own piles. */
  | "to_pack"
  | "to_ship"
  | "road"
  | "came_back";

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
  /** Pays in advance with no proof of payment attached: why. */
  noProofReason?: NoProofReason | null;
  noProofNote?: string | null;
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
    /** The Division their orders carry: their channel's. */
    division: string | null;
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

export type InvoiceFrom = "2mg" | "getmeds";
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
    /** The licence that lets them buy (a hospital's LTO, a doctor's PRC), its expiry and TIN:
     *  what Management checks. */
    licenceNo: string | null;
    licenceExpires: string | null;
    tin: string | null;
    /** Pays in advance and placed with no proof: why (the MedRep's word). */
    noProofReason: NoProofReason | null;
    noProofNote: string | null;
    /** Who approves it instead of Management (a PAP order's head), when someone does. */
    approverName: string | null;
    /** Finance's screenshots with the hold it is on now. */
    holdProofs: { id: number; name: string }[];
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
    deliveryMethod: DeliveryMethod | null;
    courier: string | null;
    tracking: string | null;
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
  }[];
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
    /** Orders placed this month (not drafts, not cancelled), their value. */
    placed: number;
    /** What was sold this month: their orders' invoices (not cancelled), as the target counts. */
    sold: number;
    setBy: string | null;
  }[];
};

// ---------------------------------------------------------------- finance

export type PaymentMethod = "bank" | "cash" | "check" | "ewallet" | "other" | "points";

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
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  paidOn: string;
  note?: string | null;
  proofId?: number | null;
};

export type RefundInput = {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  refundedOn: string;
  note?: string | null;
};

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
  rider?: string | null;
  note?: string | null;
};
export type DeliverInput = { receivedBy: string; deliveredOn: string; note?: string | null };

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
    /** PCSO's other two quotations: each vendor's name and total, from their written quote. */
    canvass: { vendor: string; amount: number }[];
    /** online: the Online desk's; pap: a PAP MedRep's patient-assistance case. */
    desk: "online" | "pap";
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
    owed: number;
    overdue: number;
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
  items: { name: string; qty: number; packSize: number; unit: string | null; free: boolean }[];
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
  /** Cash the courier or rider collects on delivery (an open cash-on-delivery invoice). */
  collect: number | null;
};

export type DispatchBoard = {
  today: string;
  counts: {
    toPack: number;
    toShip: number;
    road: number;
    delivered: number;
    held: number;
    coming: number;
  };
  toPack: DispatchCard[];
  toShip: DispatchCard[];
  road: DispatchCard[];
  /** Delivered today. */
  delivered: DispatchCard[];
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
export type OwedInvoices = {
  today: string;
  rows: {
    invoiceId: number;
    invoiceCode: string;
    orderId: number;
    orderCode: string;
    customerId: number;
    customer: string;
    kind: CustomerKind;
    city: string | null;
    medrepId: number;
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
  }[];
  totals: {
    owed: number;
    overdue: number;
    onDelivery: number;
    invoices: number;
    customers: number;
  };
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
  outFrom: "button" | "last_seen" | "field" | "hr" | null;
  inFrom: "sign_in" | "button" | "field" | "hr" | null;
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
  /** putRight: change a day's times; leave: record or cancel leave (HR's work). */
  can: { putRight: boolean; leave: boolean };
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

export type Company = "2mg" | "gpi";
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
  can: { edit: boolean; login: boolean; leave: boolean };
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

export type VisitStatus = "planned" | "done" | "skipped";
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

export type LeaveStatus = "asked" | "approved" | "refused" | "cancelled";

export type LeaveBalance = {
  /** Days a year (regular employees: 10 VL and 10 SL; others none). */
  allotted: number;
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
  /** A paper with it (a medical certificate), opened at /api/hr/leave/:id/file. */
  file: { name: string; mime: string } | null;
  canDecide: boolean;
  canCancel: boolean;
};

/** A person's own leave: what is left this year, what they asked for, and whom they ask. */
export type MyLeave = {
  year: number;
  classification: Classification;
  balances: { vl: LeaveBalance; sl: LeaveBalance; lwop: { used: number; asked: number } };
  approver: string;
  lines: LeaveLine[];
};

/** Leave for HR (everyone), a team lead (the team) and the CEO (everyone, to read). */
export type LeaveList = {
  lines: LeaveLine[];
  counts: { waiting: number; asked: number; approved: number; refused: number; cancelled: number };
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

/** Official business, work from home, overtime. */
export type FormKind = "ob" | "wfh" | "ot";

export type FormLine = {
  id: number;
  person: { id: number; name: string; team: string | null };
  kind: FormKind;
  day: string;
  /** "HH:MM" (official business and overtime). */
  from: string | null;
  to: string | null;
  minutes: number;
  place: string | null;
  reason: string;
  status: LeaveStatus;
  approver: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  canCancel: boolean;
};

export type FormList = {
  lines: FormLine[];
  counts: { waiting: number; asked: number; approved: number; refused: number; cancelled: number };
};

export type FormInput = {
  kind: FormKind;
  day: string;
  from?: string | null;
  to?: string | null;
  place?: string | null;
  reason: string;
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
export type NoProofReason = "payment_to_follow" | "paid_no_slip" | "other";

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
export type ReturnOutcome = "restocked" | "damaged" | "missing";
export type ReturnInput = {
  reason: ReturnReason;
  note?: string | null;
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
  status: "requested" | "approved" | "received" | "rejected" | "cancelled";
  statusLabel: string;
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
  /** What was taken off the bill. */
  credit: number;
  lines: {
    id: number;
    medicine: string;
    qty: number;
    unitPrice: number;
    outcome: ReturnOutcome | null;
  }[];
  can: { decide: boolean; receive: boolean; cancel: boolean };
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
  can: { ask: boolean };
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
  disputes: ScoreDispute[];
  mine: boolean;
};

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
    expectedOn: string;
    lastTotal: number;
    /** The medicines of their latest order. */
    lastItems: string | null;
  }[];
  /** For a lead or above: per area, how its customers stand. */
  areas: { areaId: number | null; area: string; seller: string | null; due: number; late: number; atRisk: number; lost: number; ok: number }[];
  /** Whose customers these are: the seat's area, the teams led, the online desk, the company. */
  scope: { label: string; detail: string };
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
    oldestOrderId: number;
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
