// What each department does in Bishnoi One, for its page on the portal (Aryan, 18 Nov: "a click
// on a tile shows that department, then the same sign-in below"). Every line is what the app
// already does for that desk (its menu in src/menus.ts and its steps in the API): how work moves
// through it, what it handles, and what each kind of seat on its team is there for.

export type DepartmentInfo = {
  /** One line on what it is for. */
  about: string;
  /** How work moves through it, in order: the step and who does it. */
  flow: { step: string; who: string }[];
  /** What it handles, from its own menu. */
  handles: string[];
};

export const DEPARTMENTS: Record<string, DepartmentInfo> = {
  sales: {
    about: "MedReps, team leads and the head of each channel: visits, orders and customers in the field.",
    flow: [
      { step: "Plan the visits", who: "Seller" },
      { step: "Visit and check in", who: "Seller" },
      { step: "Place the order", who: "Seller" },
      { step: "Approved, checked, shipped", who: "Management · Finance · Dispatch" },
      { step: "Collect and call back", who: "Seller" },
    ],
    handles: [
      "Today's visits and the visit plan",
      "New orders, taken on the spot",
      "Hospitals, doctors and patients",
      "Collections and calls",
      "Score, targets and sales performance",
    ],
  },
  management: {
    about: "Approves every order before it moves on, and checks new customers.",
    flow: [
      { step: "An order comes in", who: "Seller or Online desk" },
      { step: "Check price, stock, customer, papers", who: "Management" },
      { step: "Approve, send back or hold", who: "Management" },
      { step: "Invoice made, on to Finance", who: "Automatic" },
    ],
    handles: [
      "Orders to check: approve, send back or hold",
      "Orders stuck past their time",
      "Returns to approve",
      "New customers to check",
    ],
  },
  finance: {
    about: "Checks the money on every approved order, collects what comes later and keeps the books.",
    flow: [
      { step: "Approved order arrives", who: "Management" },
      { step: "Check the payment or what they owe", who: "Finance" },
      { step: "Let it go to Dispatch", who: "Finance" },
      { step: "Mark later payments paid", who: "Finance" },
      { step: "Books and reports", who: "Finance" },
    ],
    handles: [
      "Orders to check",
      "Payments to collect",
      "Invoices, payments received and refunds",
      "What each customer owes",
      "Banking, expenses, journals and reports",
    ],
  },
  books: {
    about: "The company's accounts: sales and supplier documents, the bank, journals and reports.",
    flow: [
      { step: "Invoices and payments", who: "Sales side" },
      { step: "Bills and supplier payments", who: "Purchases side" },
      { step: "Bank statements matched", who: "Banking" },
      { step: "Journals into the ledger", who: "Accountant" },
      { step: "Profit and loss, balance sheet, VAT", who: "Reports" },
    ],
    handles: [
      "Invoices, bills and expenses",
      "Banking and reconciliation",
      "Manual journals and the chart of accounts",
      "Reports and transaction locking",
    ],
  },
  inventory: {
    about: "Medicines, prices, batches and purchasing: what is on the shelf and what is coming.",
    flow: [
      { step: "Purchase order", who: "Inventory" },
      { step: "Goods received: batch, expiry, cost", who: "Inventory" },
      { step: "Stock in the warehouses", who: "Inventory" },
      { step: "Picked for orders, nearest expiry first", who: "Dispatch" },
      { step: "Restock when low", who: "Inventory" },
    ],
    handles: [
      "Every medicine, batch and expiry",
      "Purchase orders, receives and bills",
      "Transfers and adjustments between warehouses",
      "Batch trace for a recall",
      "Medicines the sellers ask for",
    ],
  },
  dispatch: {
    about: "Packs, ships and hands over every order, and takes returns back in.",
    flow: [
      { step: "Approved and checked order", who: "Finance" },
      { step: "Pack, nearest expiry first", who: "Dispatch" },
      { step: "Ship by courier or rider", who: "Dispatch" },
      { step: "Delivered, receipt kept", who: "Dispatch" },
      { step: "Returns received", who: "Dispatch" },
    ],
    handles: ["Orders to pack", "Orders on the road", "Orders on hold", "Returns to check", "The warehouse's stock"],
  },
  online: {
    about: "Patients' enquiries from Messenger, the websites and calls, taken all the way to their order.",
    flow: [
      { step: "Enquiry comes in", who: "Messenger, website, call" },
      { step: "Quotation", who: "Online desk" },
      { step: "Prescription and papers", who: "Online desk" },
      { step: "Order: approved, checked, shipped", who: "Management · Finance · Dispatch" },
      { step: "Payment and the refill", who: "Online desk" },
    ],
    handles: ["One inbox for every message", "Leads and enquiries", "Quotations and papers", "Patients and their points", "Refills due"],
  },
  hr: {
    about: "The company's people: who sits where, who is working, leave and pay.",
    flow: [
      { step: "Joins a seat on the chart", who: "HR" },
      { step: "Times in and out", who: "Everyone" },
      { step: "Leave asked and approved", who: "HR" },
      { step: "Payroll run", who: "HR" },
      { step: "Payslips out", who: "HR" },
    ],
    handles: ["People and who is joining", "Who's working today", "Leave and forms", "Payroll", "The attendance report"],
  },
  regulatory: {
    about: "Gets products registered and keeps them registered, and follows every complaint.",
    flow: [
      { step: "Product in the pipeline", who: "In-licensing" },
      { step: "Preparing the file", who: "Regulatory" },
      { step: "Filed", who: "Regulatory" },
      { step: "Approved, valid until", who: "Regulatory" },
      { step: "Renewal filed", who: "Regulatory" },
    ],
    handles: ["The pipeline", "Registrations (CPRs)", "Complaints and side effects, each with a due day", "The day's work log"],
  },
  office: {
    about: "The office team's day, written down: what was done, what is next.",
    flow: [
      { step: "Plan the day", who: "Each person" },
      { step: "Log what was done", who: "Each person" },
      { step: "Set tomorrow", who: "Each person" },
      { step: "Read by their mentor", who: "Mentor" },
    ],
    handles: ["My work log", "The team's work logs, for mentors", "Messages"],
  },
  ceo: {
    about: "The whole company on one screen: sales, orders, money, stock and people.",
    flow: [
      { step: "Sales against target", who: "Every channel" },
      { step: "Orders and their speed", who: "Every desk" },
      { step: "Money owed and collected", who: "Finance" },
      { step: "Stock and expiry", who: "Inventory" },
      { step: "Decisions", who: "CEO" },
    ],
    handles: ["Company figures", "Sales by channel and person", "Speed of every desk", "The company chart and map", "Decisions"],
  },
  admin: {
    about: "Sets up the company in the system: people, seats, logins and settings, and checks the data.",
    flow: [
      { step: "People and seats", who: "Admin" },
      { step: "Logins", who: "Admin" },
      { step: "Teams and channels", who: "Admin" },
      { step: "Settings", who: "Admin" },
      { step: "Data checks and audit", who: "Admin" },
    ],
    handles: ["Teams and people", "Company settings", "Data checks", "The audit trail"],
  },
};

/** What each kind of seat is there for (the seat's module decides its screens). */
export const SEAT_DOES: Record<string, { name: string; does: string }> = {
  ceo: { name: "CEO", does: "Sees and steers the whole company" },
  admin: { name: "System admin", does: "Sets up people, seats, logins and settings" },
  manager: { name: "Head of a business", does: "Leads its teams, targets and sales" },
  team_lead: { name: "Team lead", does: "Leads a team: its orders, visit plans and scores" },
  medrep: { name: "Seller", does: "Visits customers, places orders, follows payments" },
  management: { name: "Approver", does: "Approves orders: price, stock, customer, papers" },
  finance: { name: "Finance", does: "Checks payments, records money, keeps the books" },
  dispatch: { name: "Dispatch", does: "Packs, ships and hands over orders" },
  inventory: { name: "Inventory", does: "Keeps medicines, stock and purchasing" },
  online: { name: "Online desk", does: "Answers enquiries and takes patients' orders" },
  hr: { name: "HR", does: "Seats, attendance, leave and payroll" },
  regulatory: { name: "Regulatory", does: "Registrations, renewals and complaints" },
  staff: { name: "Office staff", does: "Writes the day's work log" },
};

/** The picture for each step of a department's flow, in the same order (see the page's ICONS). */
export const FLOW_ICONS: Record<string, string[]> = {
  sales: ["calendar", "map", "cart", "check", "wallet"],
  management: ["inbox", "search", "check", "file"],
  finance: ["inbox", "check", "truck", "wallet", "chart"],
  books: ["file", "card", "bank", "book", "chart"],
  inventory: ["clipboard", "box", "warehouse", "package", "refresh"],
  dispatch: ["check", "package", "truck", "home", "refresh"],
  online: ["chat", "file", "clipboard", "truck", "wallet"],
  hr: ["user", "clock", "calendar", "wallet", "file"],
  regulatory: ["flask", "clipboard", "file", "shield", "refresh"],
  office: ["calendar", "check", "arrow", "users"],
  ceo: ["chart", "clock", "wallet", "box", "check"],
  admin: ["users", "key", "network", "settings", "shield"],
};
