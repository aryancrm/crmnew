// A new order, as designed on the canvas (artboard "NewOrder") in the old CRM's look: who it is
// for, the medicines (search to add one; its stock by warehouse and what is coming; tap the
// price being given; a lower price says how much and why), payment and address, a note, the
// total, and what Management will see. A MedRep's order is always his own; Dispatch decides how
// it goes out.

import { COMPANIES, COMPANY_CODES } from "@2mg/api/companies";
import {
  DIVISION_BUYERS,
  DIVISIONS,
  divisionOf,
  divisionRule,
  isPatientType,
  ORDER_SOURCES,
  ORDER_TYPE_HINT,
  ORDER_TYPE_LABEL,
  type OrderTypeKey,
  orderTypesFor,
  PAP_DIVISIONS,
  PAP_PROGRAMS,
  PAYMENT_TERMS,
  RX_DIVISIONS,
  SUB_DIVISIONS,
  subDivisionOfArea,
} from "@2mg/api/divisions";
import { formatPhone } from "@2mg/api/phone";
import type {
  BuyerType,
  Catalogue,
  CatalogueRow,
  CustomerDetail,
  CustomerKind,
  CustomerList,
  InventoryList,
  InvoiceFrom,
  NoProofReason,
  OrderDetail,
  OrderForList,
  OrderInput,
  PaperKind,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  Check,
  ClipboardCheck,
  FileCheck2,
  Gift,
  MapPin,
  Megaphone,
  Minus,
  Paperclip,
  Pill,
  Plus,
  Search,
  TriangleAlert,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AGENCIES } from "../online/parts";
import { VAT_WORDS } from "../inventory/vat";
import { MedicineFinder } from "./medicine-finder";
import { useMe } from "../auth";
import { shownChannel } from "../seat-words";
import { shortPeso } from "../ceo";
import { CustomerDialog } from "../customers/dialog";
import { NO_PROOF_REASONS } from "../finance/no-proof";
import { MedicineRequestDialog } from "../inventory/requests";
import { avatarTone, initials } from "../look";
import { OrderChecksBox } from "./parts";
import { PAPER_ACCEPT, uploadPaper } from "../photo";
import { count, Dialog, dayLabel, inPacks, PageState, peso, timeLabel, useAction } from "../ui";

/** The price a kind of customer usually gets. */
const USUAL: Record<CustomerKind, string> = {
  hospital: "hospital",
  doctor: "doctor",
  patient: "patient",
  drugstore: "drugstore",
  distributor: "distributor",
  government: "bidding",
};

/** The lead page's boxes and fields (frontend/components/case-start-dialog.tsx), so the order
 *  form reads like the case. */
const BOX = "rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs";
const FIELD =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[14px] text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none";
const FIELD_LABEL = "text-xs font-semibold text-slate-600";
/** A value the form fills by itself (the day, the MedRep): shown in a field, not typed. */
const FIXED =
  "flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[14px] text-ink";

/** The five parts, what each is for, and which "Missing" items belong to it (for the ticks). */
const PARTS = [
  { number: 1, title: "General", sub: "Whose order it is and which Division it counts for." },
  { number: 2, title: "Customer", sub: "Who buys, where it goes, how and when they pay." },
  { number: 3, title: "Medicines", sub: "What they want. Each price comes from Inventory by itself." },
  { number: 4, title: "Documents", sub: "Prescription, their PO, proof of payment: a photo or a PDF." },
  { number: 5, title: "Review and place", sub: "Check the total and what Management will see, then place it." },
] as const;
const partOf = (missing: string): number =>
  missing === "Division"
    ? 1
    : ["Customer", "Delivery address", "Source", "Customer remarks", "Date needed"].includes(missing)
      ? 2
      : ["At least one medicine", "Why the price is different", "SC / PWD ID number"].includes(missing)
        ? 3
        : missing === "Your answer to Management"
          ? 5
          : 4;

/** The parts as steps across the top: a tick on each one filled, a press goes to it. */
function PartSteps({ missing, show }: { missing: string[]; show: boolean }) {
  if (!show) return null;
  const left = (n: number) => missing.filter((item) => partOf(item) === n).length;
  const ready = PARTS.filter((part) => left(part.number) === 0 && (part.number < 5 || missing.length === 0)).length;
  return (
    <nav
      aria-label="The order's parts"
      className="sticky top-2 z-20 flex items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)] backdrop-blur"
    >
      {PARTS.map((part, at) => {
        const done = left(part.number) === 0 && (part.number < 5 || missing.length === 0);
        return (
          <Fragment key={part.number}>
            {at > 0 && <span className="h-px w-3 shrink-0 bg-slate-200" aria-hidden="true" />}
            <a
              href={`#part-${part.number}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`part-${part.number}`)?.scrollIntoView({ block: "start" });
              }}
              className="flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-slate-700 hover:bg-slate-50"
            >
              <span
                className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
                  done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                }`}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : part.number}
              </span>
              {part.title}
              {!done && left(part.number) > 0 && (
                <span className="rounded-full bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                  {left(part.number)}
                </span>
              )}
            </a>
          </Fragment>
        );
      })}
      <span className="ml-auto hidden shrink-0 pr-2 pl-3 text-[12px] font-medium text-slate-500 sm:block">
        {ready} of 5 ready
      </span>
    </nav>
  );
}

/** A part of the form as the hub draws it (Aryan, 17 Nov: simple like the hub): a white card
 *  headed by its icon and "1. General". */
function Part({
  number,
  title,
  icon: Icon,
  aside,
  missing,
  children,
}: {
  number: number;
  title: string;
  icon: typeof Pill;
  aside?: React.ReactNode;
  /** What is still missing on the whole form: this part's own get counted on its header. */
  missing?: string[];
  children: React.ReactNode;
}) {
  const left = missing?.filter((item) => partOf(item) === number) ?? [];
  const done = missing !== undefined && left.length === 0 && (number < 5 || missing.length === 0);
  const sub = PARTS.find((part) => part.number === number)?.sub;
  return (
    <section
      id={`part-${number}`}
      className="scroll-mt-20 overflow-visible rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-18px_rgba(15,23,42,0.18)]"
    >
      <div className="flex items-center gap-3 rounded-t-2xl border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-2.5 sm:px-5">
        <span
          className={`relative grid size-9 shrink-0 place-items-center rounded-xl ${done ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-brand-tint text-brand ring-1 ring-brand/15"}`}
        >
          <Icon className="size-[18px]" aria-hidden="true" />
          <span
            className={`absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full text-[10px] font-bold ring-2 ring-white ${done ? "bg-emerald-600 text-white" : "bg-slate-800 text-white"}`}
          >
            {done ? <Check className="size-3" aria-hidden="true" /> : number}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {sub && <p className="hidden truncate text-[12px] text-slate-500 lg:block">{sub}</p>}
        </div>
        {left.length > 0 && (
          <span
            className="hidden shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 sm:inline"
            title={left.join(", ")}
          >
            {left.length} to fill
          </span>
        )}
        {aside}
      </div>
      <div className="flex flex-col gap-3 p-4 sm:px-5">{children}</div>
    </section>
  );
}

/** A field's name as the hub writes it: small capitals, a star when it is needed. */
function Label({ text, needed }: { text: string; needed?: boolean }) {
  return (
    <span className="text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
      {text}
      {needed && <span className="text-bad"> *</span>}
    </span>
  );
}
const HELP = "text-[11px] text-ink-2";
/** A kind of customer in the plural, for "HOS orders are usually for hospitals and doctors". */
const BUYER_WORDS: Record<string, string> = {
  hospital: "hospitals",
  doctor: "doctors",
  patient: "patients",
  drugstore: "drugstores",
  distributor: "distributors",
  government: "government buyers",
};
/** Dispatch's word about a medicine, as its stock news says it. */
const NEWS_WORDS: Record<string, string> = {
  out: "Dispatch: out of stock",
  low: "Dispatch: low stock",
  back: "Dispatch: back in stock",
  note: "Dispatch",
};

type Line = {
  key: number;
  medicineId: number;
  priceKind: string;
  qty: number;
  lower: boolean;
  given: string;
  reason: string;
  /** The same medicine again at no charge (a Buy 1 Take 1, a sample). */
  free?: boolean;
  /** A changed order's SC/PWD price as it stands (a case's quote): sent back as it is, kept. */
  kept?: number;
};

type Relief = { kind: "senior" | "pwd"; idNo: string; name: string };


/** A price without its VAT (a 12% medicine), and a senior's or PWD's: no VAT, then 20% off. The
 *  form's estimate; the API works out the price it keeps (the same rule). */
const exVat = (price: number, vat: string) => (vat === "vat12" ? Math.round(price / 1.12) : price);
const reliefOf = (price: number, vat: string) =>
  Math.round((vat === "vat12" ? price / 1.12 : price) * 0.8);

/** What "Save draft" keeps on this device. Photos are not kept. */
type Draft = {
  savedAt: string;
  customerId: number | null;
  lines: Line[];
  address: string;
  receiver: string;
  receiverPhone: string;
  expectedOn: string;
  customerPo: string;
  note: string;
  invoiceFrom: InvoiceFrom;
  doctor: { id: number; name: string } | null;
  division?: string;
  subDivision?: string;
  headquarter?: string | null;
  paymentTerm?: string;
  source?: string;
  orderType?: OrderTypeKey | null;
};
const draftKey = (personId: number) => `crm:draft:order:${personId}`;
const readDraft = (personId: number): Draft | null => {
  try {
    const text = localStorage.getItem(draftKey(personId));
    return text ? (JSON.parse(text) as Draft) : null;
  } catch {
    return null;
  }
};

const PAPERS: { kind: PaperKind; label: string; patient?: boolean; business?: boolean }[] = [
  { kind: "prescription", label: "Prescription", patient: true },
  { kind: "valid_id", label: "Patient's ID", patient: true },
  { kind: "senior_id", label: "Senior citizen / PWD ID", patient: true },
  { kind: "gl", label: "Guarantee letter", patient: true },
  { kind: "po", label: "Customer's PO", business: true },
  { kind: "hospital_doc", label: "Their papers (LTO, accreditation…)", business: true },
  { kind: "payment_proof", label: "Proof of payment" },
];

/** The order papers are shown in: a patient's prescription and ID first; a hospital's PO first. */
const paperRank = (kind: PaperKind, patient: boolean) =>
  (patient
    ? ["prescription", "valid_id", "senior_id", "gl", "po", "payment_proof"]
    : ["po", "hospital_doc", "prescription", "payment_proof"]
  ).indexOf(kind);

/** Today's date in Manila, as the API counts days. */
const manilaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const centavos = (text: string) => Math.round(Number(text.replace(/[,₱\s]/g, "")) * 100);
const monthYear = (day: string) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(`${day}T00:00:00+08:00`));

export function OrderNew({
  fix = false,
  change: management = false,
}: {
  fix?: boolean;
  /** Management changing a placed order before approving it. */
  change?: boolean;
}) {
  const me = useMe().data;
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const [params] = useSearchParams();
  // Fixing an order Management sent back: the same form, filled from the order.
  const routeId = useParams().id;
  // Management changing a placed order before approving it: the same form again.
  const fixId = fix || management ? Number(routeId) || null : null;
  const fixing = useQuery({
    queryKey: ["orders", "one", fixId],
    queryFn: () => api<OrderDetail>(`/api/orders/${fixId}`),
    enabled: Boolean(fixId),
  });
  const sentBack = fix ? fixing.data?.order : undefined;
  const changing = management ? fixing.data?.order : undefined;
  const [answer, setAnswer] = useState("");
  const catalogue = useQuery({
    queryKey: ["inventory", "medicines"],
    queryFn: () => api<Catalogue>("/api/inventory/medicines"),
  });
  const stock = useQuery({
    queryKey: ["inventory", "list"],
    queryFn: () => api<InventoryList>("/api/inventory"),
  });

  const [customerId, setCustomerId] = useState<number | null>(
    Number(params.get("customer")) || null,
  );
  // Add order on a field visit (docs/PLAN.md 22): the order joins the call, then back to it.
  const visitId = fixId ? null : Number(params.get("visit")) || null;
  const [findCustomer, setFindCustomer] = useState("");
  // A team lead (or Management) places the order in one of their MedReps' names: the MedRep of
  // the customer's area unless they pick another; nobody picked = their own (an empty seat's).
  const [medrepId, setMedrepId] = useState<number | null>(null);
  const [medrepTouched, setMedrepTouched] = useState(false);
  const forWhom = useQuery({
    queryKey: ["orders", "for", customerId],
    queryFn: () => api<OrderForList>(`/api/orders/for?customerId=${customerId}`),
    enabled:
      Boolean(customerId) && Boolean(me) && me?.role !== "medrep" && me?.role !== "online" && !fix,
  });
  useEffect(() => {
    if (!medrepTouched) setMedrepId(forWhom.data?.suggested ?? null);
  }, [forWhom.data, medrepTouched]);
  const [askedCustomer, setAskedCustomer] = useState("");
  const [adding, setAdding] = useState(false);
  // The customer list opens on the Division's usual buyers; every customer is one click away.
  const [everyKind, setEveryKind] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAskedCustomer(findCustomer.trim()), 250);
    return () => clearTimeout(timer);
  }, [findCustomer]);
  const customers = useQuery({
    queryKey: ["customers", "pick", askedCustomer],
    queryFn: () => api<CustomerList>(`/api/customers?q=${encodeURIComponent(askedCustomer)}`),
    enabled: !customerId,
  });
  const customer = useQuery({
    queryKey: ["customers", "one", customerId],
    queryFn: () => api<CustomerDetail>(`/api/customers/${customerId}`),
    enabled: Boolean(customerId),
  });
  const picked = customer.data?.customer;
  // The Documents part lists only the papers the order asks for; "Another paper" opens the rest.
  const [morePapers, setMorePapers] = useState(false);
  const standing = customer.data?.standing;

  const [lines, setLines] = useState<Line[]>([]);
  const [findMedicine, setFindMedicine] = useState("");
  const [askingMedicine, setAskingMedicine] = useState(false);
  const [address, setAddress] = useState("");
  const [receiver, setReceiver] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const [customerPo, setCustomerPo] = useState("");
  // A bidding order: the tender whose award it delivers (one of the customer's awards with no order).
  const [tenderId, setTenderId] = useState<number | null>(null);
  // The hub's "Customer remarks": what Management reads with the order (needed, as in the hub).
  const [note, setNote] = useState("");
  // Where the order came from: the hub's Source list (needed).
  const [source, setSource] = useState("");
  // The hub's last step: a Confirm window, and "why are you proceeding?" when a medicine is short.
  const [confirming, setConfirming] = useState(false);
  // The "Hand to PAP" window (a guarantee-letter patient, 22 Nov).
  const [handing, setHanding] = useState(false);
  const [stockReason, setStockReason] = useState("");
  const [invoiceFrom, setInvoiceFrom] = useState<InvoiceFrom>("2mg");
  const [doctor, setDoctor] = useState<{ id: number; name: string } | null>(null);
  const [findDoctor, setFindDoctor] = useState("");
  const [papers, setPapers] = useState<Partial<Record<PaperKind, File>>>({});
  // The order's type, picked first (Aryan, 19 Nov: "the MedRep knows whose order it is; pick it
  // first, as the Online case's GL, PWD and Regular, and the whole order follows it"): its papers,
  // the SC/PWD price and the PO follow it. A patient's type with a hospital or a doctor as the
  // customer is an order for one patient: its prescription and the patient's ID go with it, and
  // Management checks them as on a patient's own order.
  const [orderType, setOrderType] = useState<OrderTypeKey | null>(null);
  const patientOrder = Boolean(picked && picked.kind !== "patient" && isPatientType(orderType));
  const [patientName, setPatientName] = useState("");
  // A senior citizen's or PWD's ID shown (RA 9994, RA 10754), on any order: 20% off and no VAT,
  // or a promo without VAT when lower, never both. Their OSCA / PWD ID number goes on the invoice.
  const [relief, setRelief] = useState<Relief | null>(null);
  // An advance order without its slip says why (the hub's rule): Finance reads it.
  const [noProof, setNoProof] = useState<NoProofReason | "">("");
  const [noProofNote, setNoProofNote] = useState("");
  const [noProofAsk, setNoProofAsk] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // The switch at the top: to Management and to Finance before Dispatch. Off unless asked, or
  // unless something is wrong on the order (then Management is locked on).
  // A field MedRep's order goes to Management by default (Management completes and approves it).
  const [askManagement, setAskManagement] = useState<boolean | null>(null);
  const toManagement = askManagement ?? me?.role === "medrep";
  const setToManagement = (on: boolean) => setAskManagement(on);
  // Who chooses whether Management and Finance check their own order (the API reads no one else's).
  const switches = me?.role === "admin";
  // The hub's Division, Sub-division and the Payment Terms agreed with the customer.
  const [division, setDivision] = useState<string | null>(null);
  const [subDivision, setSubDivision] = useState<string | null>(null);
  // The hub's Headquarter (null: the Division's own), a prescription Division's order's reason for
  // having no prescription, and a guarantee letter's programme, which is its Source (19 Nov, evening).
  const [headquarter, setHeadquarter] = useState<string | null>(null);
  const [noRxReason, setNoRxReason] = useState("");
  const [program, setProgram] = useState("");
  // The letter's number and approved amount, when it is already in (else written on the order later).
  const [glNumber, setGlNumber] = useState("");
  const [glAmount, setGlAmount] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  // How the terms are given: from the list, as a number of days, or as a date to pay by.
  const [termMode, setTermMode] = useState<"list" | "__days" | "__date">("list");
  // A lead ordering in a MedRep's name books it under that MedRep's channel and area.
  const forRep = forWhom.data?.can
    ? forWhom.data.medreps.find((rep) => rep.id === medrepId)
    : undefined;
  // The order's Division starts as its person's own and may be any other (Aryan, 19 Nov, evening:
  // "universal, as the hub's: a hospital MedRep who gets a prescription order picks that Division
  // and the fields follow"); it still counts for its MedRep. Management and the Admin, ordering for
  // nobody in particular, pick one.
  const anyDivision = me ? ["management", "admin", "ceo"].includes(me.role) && !forRep : false;
  // The Divisions are the sales tracker's eight channels (Aryan, 19 Nov); a hub word (an older
  // draft's) is read as its channel.
  const ownDivisions = (
    forRep ? forRep.divisions : (me?.divisions ?? (me?.channel?.division ? [me.channel.division] : []))
  )
    .map(divisionOf)
    .filter((one): one is string => Boolean(one));
  // Their own marked; every channel one press away.
  const ownChips: readonly string[] = anyDivision ? [] : ownDivisions;
  const ownDivision = ownDivisions[0] ?? "";
  // The General part is the account's (26 Nov, the backend developer; it replaces "any other a pick
  // away"): a seller orders in their account's Divisions only; another Division's order is placed
  // from an account of that Division (Add another account, then switch). The API refuses it too.
  const lockedDivisions = !anyDivision && ownDivisions.length > 0;
  const askedDivision = divisionOf(division);
  const pickedDivision =
    // An order being fixed keeps the Division it was placed in.
    (askedDivision && (!lockedDivisions || fixId || ownDivisions.includes(askedDivision)) ? askedDivision : null) ?? ownDivision;
  const pickedSubDivision =
    subDivision ??
    (pickedDivision
      ? subDivisionOfArea(pickedDivision, forRep ? forRep.area : me?.area?.name, forRep ? null : me?.title)
      : "");
  // The hub's rule for the Division (and a guarantee letter's order in its five Divisions): a fixed
  // Sub-division shows as it is, B2B's is CRR or NBD; the Headquarter starts as the Division's.
  const pap = orderType === "gl" && PAP_DIVISIONS.includes(pickedDivision);
  const rule = divisionRule(pickedDivision, pap);
  const sentSub =
    rule?.sub ??
    (rule?.subOptions ? (rule.subOptions.includes(pickedSubDivision) ? pickedSubDivision : "") : pickedSubDivision);
  const shownHq = headquarter ?? rule?.hq ?? "";
  // A prescription Division's order (RX Business, MD Telesales) carries the prescription, or says why.
  const rxDivision = RX_DIVISIONS.includes(pickedDivision);
  /** Another Division (or type) picked: its own Sub-division and Headquarter, as the hub does. */
  const divisionPicked = (name: string) => {
    setDivision(name);
    setSubDivision(name === ownDivision ? null : "");
    setHeadquarter(null);
    if (orderType === "gl" && !PAP_DIVISIONS.includes(name)) setOrderType(null);
  };
  // The customers shown: the Division's usual buyers, unless every customer is asked for.
  const divisionKinds = DIVISION_BUYERS[pickedDivision] ?? null;
  // A business's order type never lists patients (19 Nov).
  const allCustomerRows = (customers.data?.rows ?? []).filter(
    (row) => !orderType || isPatientType(orderType) || row.kind !== "patient",
  );
  const kindRows =
    divisionKinds && !everyKind
      ? allCustomerRows.filter((row) => divisionKinds.includes(row.kind))
      : allCustomerRows;
  const otherKinds = allCustomerRows.length - kindRows.length;
  // Finance checks every order unless Management switches it off (Aryan, 17 Nov).
  const [toFinance, setToFinance] = useState(true);
  const doctors = useQuery({
    queryKey: ["customers", "doctors", findDoctor.trim()],
    queryFn: () =>
      api<CustomerList>(`/api/customers?kind=doctor&q=${encodeURIComponent(findDoctor.trim())}`),
    enabled: !doctor && findDoctor.trim().length >= 1,
  });

  // An order placed at a visit to a doctor names that doctor (Aryan, 23 Nov: the order is made
  // right there on the call): if the buyer is then changed to the doctor's patient, the doctor stays.
  const doctorFromVisit = useRef(false);
  useEffect(() => {
    if (!visitId || doctorFromVisit.current || !picked) return;
    doctorFromVisit.current = true;
    if (picked.kind === "doctor") setDoctor((now) => now ?? { id: picked.id, name: picked.name });
  }, [visitId, picked]);

  // A draft saved on this device comes back when the form is opened again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only once, when the person is known
  useEffect(() => {
    if (!me || params.get("customer") || fix) return;
    const draft = readDraft(me.id);
    if (!draft) return;
    setCustomerId(draft.customerId);
    setLines(draft.lines);
    setReceiver(draft.receiver);
    setReceiverPhone(draft.receiverPhone);
    setExpectedOn(draft.expectedOn);
    setCustomerPo(draft.customerPo);
    setNote(draft.note);
    if (draft.division !== undefined) setDivision(draft.division);
    if (draft.subDivision !== undefined) setSubDivision(draft.subDivision);
    if (draft.headquarter !== undefined) setHeadquarter(draft.headquarter);
    if (draft.paymentTerm !== undefined) {
      setPaymentTerm(draft.paymentTerm);
      if (draft.paymentTerm.startsWith("Pays by ")) setTermMode("__date");
      else if (/^\d+ days$/.test(draft.paymentTerm) && !PAYMENT_TERMS.includes(draft.paymentTerm as (typeof PAYMENT_TERMS)[number]))
        setTermMode("__days");
    }
    if (draft.source !== undefined) setSource(draft.source);
    if (draft.orderType !== undefined) setOrderType(draft.orderType);
    setInvoiceFrom(draft.invoiceFrom);
    setDoctor(draft.doctor);
    restoredAddress.current = draft.address;
    setDraftNote(
      `Draft from ${timeLabel(draft.savedAt)} brought back. Photos aren't kept in a draft.`,
    );
  }, [me?.id]);
  const restoredAddress = useRef<string | null>(null);
  const filled = useRef(false);
  useEffect(() => {
    const data = fixing.data;
    if (!data || filled.current) return;
    filled.current = true;
    const { order, items } = data;
    setCustomerId(order.customerId);
    setLines(
      items.map((item, index) => ({
        key: index + 1,
        medicineId: item.medicineId,
        priceKind: item.priceKind,
        qty: item.qty,
        lower: !item.free && !item.relief && item.unitPrice !== item.listPrice,
        given:
          !item.free && !item.relief && item.unitPrice !== item.listPrice
            ? (item.unitPrice / 100).toFixed(2)
            : "",
        reason: item.relief ? "" : (item.reason ?? ""),
        free: item.free,
        ...(item.relief ? { kept: item.unitPrice } : {}),
      })),
    );
    setRelief(
      order.relief
        ? { kind: order.relief.kind, idNo: order.relief.idNo ?? "", name: order.relief.name ?? "" }
        : null,
    );
    restoredAddress.current = order.deliveryAddress ?? "";
    setReceiver(order.receiver ?? "");
    setReceiverPhone(order.receiverPhone ?? "");
    setExpectedOn(order.expectedOn && order.expectedOn >= manilaToday() ? order.expectedOn : "");
    setCustomerPo(order.customerPo ?? "");
    setNote(order.note ?? "");
    setInvoiceFrom(order.invoiceFrom);
    setDoctor(order.doctorId && order.doctor ? { id: order.doctorId, name: order.doctor } : null);
    if (order.division) setDivision(order.division);
    if (order.subDivision) setSubDivision(order.subDivision);
    setPaymentTerm(order.paymentTerm ?? "");
    setTermMode(
      order.paymentTerm?.startsWith("Pays by ")
        ? "__date"
        : order.paymentTerm && /^\d+ days$/.test(order.paymentTerm) && !PAYMENT_TERMS.includes(order.paymentTerm as (typeof PAYMENT_TERMS)[number])
          ? "__days"
          : "list",
    );
    setSource(order.source ?? "");
    setHeadquarter(order.headquarter ?? null);
    setNoRxReason(order.noRxReason ?? "");
    if ((PAP_PROGRAMS as readonly string[]).includes(order.source ?? "")) setProgram(order.source ?? "");
    setStockReason(order.stockReason ?? "");
    // An order placed before types: worked out from what it carries.
    setOrderType(
      order.type ??
        (order.relief
          ? "senior_pwd"
          : order.customerKind === "patient" || order.patientOrder
            ? "patient"
            : order.customerPo
              ? "po"
              : "no_po"),
    );
    setPatientName(order.patientName ?? "");
    setNoProof(order.noProofReason ?? "");
    setNoProofNote(order.noProofNote ?? "");
  }, [fixing.data]);

  function saveDraft() {
    if (!me) return;
    const draft: Draft = {
      savedAt: new Date().toISOString(),
      customerId,
      lines,
      address,
      receiver,
      receiverPhone,
      expectedOn,
      customerPo,
      note,
      invoiceFrom,
      doctor,
      division: pickedDivision,
      subDivision: pickedSubDivision,
      headquarter,
      paymentTerm,
      source,
      orderType,
    };
    try {
      localStorage.setItem(draftKey(me.id), JSON.stringify(draft));
      setDraftNote(
        `Draft saved on this device at ${timeLabel(draft.savedAt)}. Photos aren't kept in a draft.`,
      );
    } catch {
      setDraftNote("This device couldn't keep the draft.");
    }
  }
  function discardDraft() {
    if (me) localStorage.removeItem(draftKey(me.id));
    setDraftNote(null);
    setCustomerId(null);
    setLines([]);
    setAddress("");
    setReceiver("");
    setReceiverPhone("");
    setExpectedOn("");
    setCustomerPo("");
    setNote("");
    setSource("");
    setInvoiceFrom("2mg");
    setDoctor(null);
    setPapers({});
  }
  // The delivery address starts as the customer's own (or the draft's).
  useEffect(() => {
    if (!picked) return;
    setAddress(
      restoredAddress.current ??
        (picked.address &&
        picked.city &&
        picked.address.toLowerCase().endsWith(picked.city.toLowerCase())
          ? picked.address
          : [picked.address, picked.city].filter(Boolean).join(", ")),
    );
    restoredAddress.current = null;
    // On credit or cash on delivery there is no slip yet: the hub's first reason says so.
    if (picked.paymentTerms !== "advance") setNoProof((now) => now || "on_terms");
  }, [picked]);

  const medicines = catalogue.data?.rows ?? [];
  const byId = useMemo(() => new Map(medicines.map((row) => [row.id, row])), [medicines]);
  const stockOf = (id: number) => stock.data?.medicines.find((row) => row.id === id);
  /** The offer running for this buyer on a medicine: one for their kind first, else every
   *  buyer's (the server picks the same). */
  const offerOf = (row: CatalogueRow) =>
    (row.offers ?? []).find((one) => picked && one.buyerKind === picked.kind) ??
    (row.offers ?? []).find((one) => one.buyerKind === null) ??
    null;
  const pricesOf = (row: CatalogueRow) => {
    const usual = picked ? USUAL[picked.kind] : "";
    const offer = offerOf(row);
    const options = [
      // An offer's own price (the Christmas offers' "customer pays") comes first.
      ...(offer && offer.price !== null
        ? [{ kind: "offer", label: offer.name, amount: offer.price }]
        : []),
      ...(catalogue.data?.buyerTypes ?? [])
        .filter((type) => row.prices[type.key] !== undefined)
        .map((type) => ({
          kind: type.key as string,
          label: type.label,
          amount: row.prices[type.key] as number,
        })),
      ...(row.promo
        ? [
            {
              kind: "promo",
              label: `Promo to ${dayLabel(row.promo.endsOn)}`,
              amount: row.promo.amount,
            },
          ]
        : []),
    ];
    // The customer's own kind of price first, then the promo, then the rest.
    return options.sort(
      (a, b) =>
        Number(b.kind === "offer") - Number(a.kind === "offer") ||
        Number(b.kind === usual) - Number(a.kind === usual) ||
        Number(b.kind === "promo") - Number(a.kind === "promo"),
    );
  };
  const listOf = (line: Line) => {
    const row = byId.get(line.medicineId);
    return row ? (pricesOf(row).find((option) => option.kind === line.priceKind)?.amount ?? 0) : 0;
  };
  // Any order whose buyer shows a senior citizen's or PWD's ID takes their price (Aryan, 17 Nov).
  const withRelief = Boolean(relief);
  // An SC/PWD line: the lowest of the law's price (the patient price less VAT and 20%), a promo
  // without VAT, or the price it keeps.
  const reliefBase = (line: Line) => byId.get(line.medicineId)?.prices.patient ?? listOf(line);
  const reliefEach = (line: Line) => {
    const row = byId.get(line.medicineId);
    if (!row) return 0;
    const options = [reliefOf(reliefBase(line), row.vat)];
    if (row.promo) options.push(exVat(row.promo.amount, row.vat));
    if (line.kept !== undefined) options.push(line.kept);
    return Math.min(...options);
  };
  /** The free pieces an offer adds to a paid line, worked out as the server does (Buy X Take Y:
   *  Y for every X bought); none with an SC/PWD price (the law: never both). */
  const offerTakes = (medicineId: number) => {
    const row = byId.get(medicineId);
    const offer = row ? offerOf(row) : null;
    return offer && offer.take > 0 && !withRelief ? offer : null;
  };
  const offerFree = (line: Line) => {
    const offer = line.free ? null : offerTakes(line.medicineId);
    return offer ? Math.floor(line.qty / offer.buy) * offer.take : 0;
  };
  const eachOf = (line: Line) =>
    line.free
      ? 0
      : withRelief
        ? reliefEach(line)
        : line.lower && line.given.trim()
          ? centavos(line.given)
          : listOf(line);
  const change = (key: number, changes: Partial<Line>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...changes } : line)));

  /** A free line of the same medicine (a Buy 1 Take 1): the same quantity at ₱0, under the paid one. */
  function addFree(paid: Line) {
    setLines((all) => {
      const at = all.findIndex((line) => line.key === paid.key);
      const free: Line = {
        ...paid,
        key: Math.max(0, ...all.map((line) => line.key)) + 1,
        lower: false,
        given: "",
        reason: "Buy 1 Take 1",
        free: true,
      };
      return [...all.slice(0, at + 1), free, ...all.slice(at + 1)];
    });
  }
  function addMedicine(row: CatalogueRow) {
    const first = pricesOf(row)[0];
    setLines((all) => [
      ...all,
      {
        key: Math.max(0, ...all.map((line) => line.key)) + 1,
        medicineId: row.id,
        priceKind: first?.kind ?? "",
        qty: row.packSize,
        lower: false,
        given: "",
        reason: "",
      },
    ]);
    setFindMedicine("");
  }

  const listTotal = lines.reduce((sum, line) => sum + line.qty * listOf(line), 0);
  const total = lines.reduce((sum, line) => sum + line.qty * eachOf(line), 0);
  const warnings: string[] = [];
  for (const line of lines) {
    const row = byId.get(line.medicineId);
    if (!row) continue;
    const name = [row.name, row.strength].filter(Boolean).join(" ");
    if (line.free)
      warnings.push(`${name} × ${count(line.qty)} given free (${line.reason.trim() || "promo"})`);
    if (line.qty > row.free)
      warnings.push(
        `${name} is short by ${count(line.qty - row.free)}${row.promised ? ` (${count(row.promised)} of the shelf already promised to other orders)` : ""}`,
      );
    if (!withRelief && line.lower && eachOf(line) < listOf(line))
      warnings.push(`${name} is ${peso(listOf(line) - eachOf(line))} below the price, each`);
    if (!withRelief && line.lower && eachOf(line) > listOf(line))
      warnings.push(`${name} is ${peso(eachOf(line) - listOf(line))} above the price, each`);
  }
  if (withRelief)
    warnings.push(
      `${relief?.kind === "pwd" ? "PWD" : "Senior citizen"} discount: 20% off and no VAT (or a promo, never both)`,
    );
  if (picked?.review === "to_review")
    warnings.push("This customer is new: Management hasn't checked its details yet");
  if (picked?.licenceState === "expired") warnings.push("The customer's licence has expired");
  if (picked?.paymentTerms === "advance" && !papers.payment_proof)
    warnings.push("No proof of payment yet, and this customer pays in advance");
  // What sends it to Management whatever the switch says (short stock is Dispatch's).
  const checkReasons = warnings.filter(
    (warning) =>
      !warning.includes(" is short by ") &&
      (toFinance ? !warning.startsWith("No proof of payment") : true),
  );

  if (fixId && !fixing.data) return <PageState query={fixing} what="the order" />;
  if (changing && changing.status !== "pending_approval")
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-2xs">
        {changing.code} isn't waiting for Management: it is {changing.statusLabel.toLowerCase()}{" "}
        now.{" "}
        <Link
          to={`/orders/${changing.id}`}
          className="font-semibold text-emerald-700 hover:underline"
        >
          Open the order
        </Link>
      </div>
    );
  if (sentBack && sentBack.status !== "draft")
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-2xs">
        {sentBack.code} isn't waiting for a fix: it is {sentBack.statusLabel.toLowerCase()} now.{" "}
        <Link
          to={`/orders/${sentBack.id}`}
          className="font-semibold text-emerald-700 hover:underline"
        >
          Open the order
        </Link>
      </div>
    );
  if (!catalogue.data || !stock.data)
    return <PageState query={catalogue.data ? stock : catalogue} what="the medicines" />;

  // The field says why there is no proof of payment on any order (the hub's rule; Management
  // doesn't). A customer on credit or cash on delivery starts as "on payment terms".
  const asksProof = !management && !(me && ["management", "admin"].includes(me.role));
  const proofMissing = asksProof && !papers.payment_proof;
  const forPatient = isPatientType(orderType) || picked?.kind === "patient" || patientOrder;
  // What a sent-back order already has on file counts (its prescription stays on the order).
  const onFile = new Set((fixing.data?.papers ?? []).map((paper) => paper.kind));
  // Whenever a patient buys, the prescription is needed (Aryan, 17 Nov). The type's own papers
  // are asked for too (19 Nov): Management's Documents check reads them; only the prescription
  // keeps the order from going.
  const paperNeeded = (kind: PaperKind) =>
    (kind === "prescription" && (forPatient || rxDivision)) ||
    (kind === "senior_id" && orderType === "senior_pwd") ||
    (kind === "gl" && orderType === "gl") ||
    (kind === "po" && orderType === "po");
  // The papers the Documents part lists without being asked: the needed ones, and the proof of
  // payment (or why there is none), which the field says on every order.
  const paperAsked = (kind: PaperKind) => paperNeeded(kind) || (kind === "payment_proof" && asksProof);
  const shortLines = lines.filter((line) => {
    const row = byId.get(line.medicineId);
    return row ? line.qty > row.free : false;
  });
  // What still keeps the order from going (the hub's "Missing: …"): Management changing an
  // order isn't held by it.
  const missing: string[] = management
    ? []
    : [
        ...(customerId ? [] : ["Customer"]),
        ...(pickedDivision ? [] : ["Division"]),
        ...(orderType ? [] : ["Order type"]),
        // A patient's own order is one of the patient types (19 Nov).
        ...(orderType && !isPatientType(orderType) && picked?.kind === "patient"
          ? ["A patient's order type (Patient, Senior / PWD or Guarantee letter)"]
          : []),
        ...(orderType === "senior_pwd" && !relief ? ["Senior citizen or PWD"] : []),
        ...(orderType === "po" && !customerPo.trim() ? ["Their PO number"] : []),
        // A guarantee letter's order: its programme and the letter itself (the hub's PAP rule).
        ...(pap && !program ? ["Programme (DSWD, PCSO…)"] : []),
        ...(orderType === "gl" && !papers.gl && !onFile.has("gl") ? ["Guarantee letter"] : []),
        ...(address.trim() ? [] : ["Delivery address"]),
        ...(source ? [] : ["Source"]),
        ...(note.trim() ? [] : ["Customer remarks"]),
        ...(expectedOn ? [] : ["Date needed"]),
        ...(lines.length ? [] : ["At least one medicine"]),
        ...(lines.some((line) => !line.free && !withRelief && line.lower && !line.reason.trim())
          ? ["Why the price is different"]
          : []),
        ...(patientOrder && picked?.kind !== "patient" && !patientName.trim()
          ? ["The patient's name"]
          : []),
        ...(withRelief && !relief?.idNo.trim() ? ["SC / PWD ID number"] : []),
        // Whenever a patient buys, the prescription goes with the order (Aryan, 17 Nov).
        ...(forPatient && !papers.prescription && !onFile.has("prescription")
          ? ["Prescription"]
          : []),
        // A prescription Division's order (the hub's rule): the prescription, or why there is none.
        ...(rxDivision && !forPatient && !papers.prescription && !onFile.has("prescription") && !noRxReason.trim()
          ? ["Prescription (or why there is none)"]
          : []),
        ...(proofMissing &&
        !onFile.has("payment_proof") &&
        (!noProof || (noProof === "other" && !noProofNote.trim()))
          ? ["Proof of payment (or why there is none)"]
          : []),
        ...(fixId && !answer.trim() ? ["Your answer to Management"] : []),
      ];
  // A PAP MedRep's patient is paid by a guarantee letter: that starts as a PAP case, where the
  // quotation, the application, the letter and the claim are tracked.
  const papPatient =
    me?.role === "medrep" && me.channel?.code === "PAP" && picked?.kind === "patient";
  // PAP is a process one person looks after (Aryan, 22 Nov): a guarantee-letter patient from any
  // channel is handed to PAP, who gets the quotations and the letter; the sale stays the seller's.
  const handsToPap =
    orderType === "gl" &&
    !fixId &&
    !management &&
    !papPatient &&
    Boolean(me && ["medrep", "team_lead", "manager", "online"].includes(me.role) && me.channel?.code !== "PAP");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (papPatient && !fixId) {
      navigate("/pap?new=1");
      return;
    }
    if (handsToPap) {
      setHanding(true);
      return;
    }
    if (missing.length) {
      if (missing.some((item) => item.startsWith("Proof of payment"))) setNoProofAsk(true);
      return;
    }
    // Management changing an order saves at once; the field confirms what goes (the hub's window).
    if (management) void place();
    else setConfirming(true);
  }
  async function place() {
    let id = 0;
    const body: OrderInput = {
      customerId: customerId ?? 0,
      ...(forWhom.data?.can ? { medrepId } : {}),
      items: lines.filter((line) => !(line.free && offerTakes(line.medicineId))).map((line) => ({
        medicineId: line.medicineId,
        qty: line.qty,
        priceKind: line.priceKind,
        // An SC/PWD line sends the price it keeps (or none): the API works the rest out.
        unitPrice: withRelief ? (line.free ? 0 : line.kept) : eachOf(line),
        reason: line.free ? line.reason || "Free" : !withRelief && line.lower ? line.reason : null,
        free: Boolean(line.free),
      })),
      relief: withRelief && relief
        ? { kind: relief.kind, idNo: relief.idNo.trim() || null, name: relief.name.trim() || null }
        : null,
      deliveryAddress: address,
      receiver,
      receiverPhone,
      expectedOn: expectedOn || null,
      customerPo,
      note,
      invoiceFrom,
      doctorId: doctor?.id ?? null,
      tenderId: (customer.data?.standing.awards ?? []).some((award) => award.id === tenderId) ? tenderId : null,
      // The field sends no choice: Management checks it and decides about Finance on approving.
      // Only the Admin's switch is read (the API's ORDER_MANAGE_ROLES; Management places none).
      ...(switches ? { checks: { management: toManagement, finance: toFinance } } : {}),
      division: pickedDivision || null,
      subDivision: sentSub || null,
      headquarter: shownHq.trim() || null,
      ...(orderType === "gl"
        ? {
            glNumber: glNumber.trim() || null,
            glAmount: glAmount.trim() && Number.isFinite(centavos(glAmount)) ? centavos(glAmount) : null,
          }
        : {}),
      noRxReason:
        rxDivision && !forPatient && !papers.prescription && !onFile.has("prescription")
          ? noRxReason.trim() || null
          : null,
      paymentTerm: paymentTerm.trim() || null,
      type: orderType,
      patientOrder,
      patientName: patientOrder ? patientName.trim() || null : null,
      noProofReason: proofMissing && noProof ? noProof : null,
      noProofNote: proofMissing && noProof ? noProofNote.trim() || null : null,
      source: source || null,
      stockReason: shortLines.length ? stockReason.trim() || null : null,
    };
    const done = await action.run(async () => {
      if (fixId) {
        await api(`/api/orders/${fixId}/${management ? "change" : "revise"}`, {
          body: { ...body, answer },
        });
        id = fixId;
      } else
        id = (await api<{ id: number }>("/api/orders", { body: visitId ? { ...body, visitId } : body })).id;
    });
    if (!done) {
      setConfirming(false);
      return;
    }
    // The order is placed; now its papers. One that fails can be added again on the order.
    const failed: string[] = [];
    for (const [kind, file] of Object.entries(papers) as [PaperKind, File][]) {
      try {
        await uploadPaper(id, kind, file);
      } catch {
        failed.push(PAPERS.find((paper) => paper.kind === kind)?.label ?? kind);
      }
    }
    if (me && !fixId) localStorage.removeItem(draftKey(me.id));
    await queries.invalidateQueries({ queryKey: ["orders"] });
    if (visitId && !failed.length) {
      await queries.invalidateQueries({ queryKey: ["mr"] });
      navigate(`/visits/${visitId}`, { replace: true });
      return;
    }
    // A refill call's order (refill-flow.tsx): back to the same list, for the next one.
    const refills = !fixId && params.get("from") === "refills" ? params.get("state") : null;
    if (refills && !failed.length) {
      navigate(`/to-call?state=${refills}`, { replace: true, state: { placed: { orderId: id } } });
      return;
    }
    navigate(`/orders/${id}`, {
      replace: true,
      state: failed.length
        ? {
            paperProblem: `The order is ${fixId ? "sent again" : "placed"}, but ${failed.join(" and ")} didn't upload. Add it again under Papers.`,
          }
        : null,
    });
  }

  const kindLabel = picked
    ? customer.data?.kinds.find((kind) => kind.key === picked.kind)?.label
    : "";
  const terms = picked
    ? picked.paymentTerms === "days"
      ? `${picked.paymentDays} days after delivery`
      : picked.paymentTerms === "cod"
        ? "Cash on delivery"
        : "Pays in advance"
    : "";
  const lineError = (index: number, name: string) => action.at(`items.${index}.${name}`);

  return (
    <>
    <form onSubmit={submit} className="mx-auto flex max-w-4xl flex-col gap-4 pb-4">
      {handsToPap && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-950 ring-1 ring-amber-200">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />A guarantee letter
            is PAP's work: hand the patient over. The sale stays yours.
          </span>
          <span className="flex items-center gap-3">
            <Link to="/pap" className="text-amber-800 hover:underline">
              My patients with PAP
            </Link>
            <button type="button" onClick={() => setHanding(true)} className="font-semibold text-emerald-700 hover:underline">
              Hand to PAP
            </button>
          </span>
        </div>
      )}
      {handing && (
        <HandToPapDialog
          name={picked?.name ?? ""}
          phone={picked?.phone ?? ""}
          city={picked?.city ?? ""}
          address={picked?.address ?? ""}
          onClose={() => setHanding(false)}
          onDone={(id) => navigate(`/leads/${id}`)}
        />
      )}
      {papPatient && !fixId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />A patient on a
            guarantee letter starts as a PAP case.
          </span>
          <Link to="/pap?new=1" className="font-semibold text-emerald-700 hover:underline">
            Start a PAP case
          </Link>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">
            {sentBack
              ? `Fix order ${sentBack.code}`
              : changing
                ? `Change order ${changing.code}`
                : "Create New Order"}
          </h1>
          <p className="text-sm text-ink-2">
            {changing
              ? "Change the medicines or details before you approve it."
              : visitId
                ? "Placed at your visit: it joins the call. Management approves it, then Finance and Dispatch take it on."
                : "Fill the five parts. Management approves it, then Finance and Dispatch take it on."}
          </p>
        </div>
        <button
          type="button"
          hidden={Boolean(fixId)}
          onClick={saveDraft}
          className="h-9 rounded-lg px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          Save draft
        </button>
      </div>
      {draftNote && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-600 shadow-sm">
          <span>{draftNote}</span>
          <button
            type="button"
            onClick={discardDraft}
            className="font-semibold text-rose-700 hover:underline"
          >
            Discard draft
          </button>
        </div>
      )}

      {sentBack && (
        <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
          <Undo2 className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <div className="font-semibold">
              {sentBack.sentBackBy ?? "Management"} sent it back
              {sentBack.sentBackAt ? ` · ${timeLabel(sentBack.sentBackAt)}` : ""}
            </div>
            <div className="mt-0.5">{sentBack.sentBackReason ?? sentBack.flagReason}</div>
            <div className="mt-1.5 text-xs text-amber-800">
              Change what is needed below, write your answer at the bottom, and send it to
              Management again.
            </div>
          </div>
        </div>
      )}

      {changing && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-sky-950">
          You're changing {changing.medrep}'s order before approving it. Write why at the bottom:
          they are told what changed. It stays with you to approve.
        </div>
      )}

      {/* Who checks the order is the office's call: the field and the Online desk only place it,
          so only the Admin, whose switch the API reads, sees it. */}
      {switches && !changing && (
        <OrderChecksBox
          reasons={checkReasons}
          management={toManagement}
          onManagement={setToManagement}
          finance={toFinance}
          onFinance={setToFinance}
        />
      )}

      {/* 1 · General: whose order, the day, the Division (the hub's first part) */}
      <PartSteps missing={missing} show={!management} />

      {/* Short as the hub's (Aryan, 23 Nov: "he went to take an order, not to sit an exam"): the
          day and the MedRep on the part's header, the Division one small list. */}
      <Part
        number={1}
        title="General"
        icon={UserRound}
        missing={management ? undefined : missing}
        aside={
          <span className="min-w-0 shrink text-right text-[11px] leading-tight text-slate-500">
            <span className="block">{dayLabel(manilaToday())}</span>
            <span className="block truncate font-medium text-slate-700">
              {changing || sentBack ? (changing ?? sentBack)?.medrep : [me?.name, me?.area?.name].filter(Boolean).join(" · ")}
            </span>
          </span>
        }
      >
        {/* The order's Division: the sales tracker's eight channels (Aryan, 19 Nov: "we have 8
            channels"), their own marked, any other one pick away; the sub-division, the order
            types, the customer list and the papers follow it. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <Label text="Division" needed />
            {lockedDivisions && ownDivisions.length === 1 ? (
              // The account's own, as it is: another Division's order comes from that Division's account.
              <div className={FIXED} title="Your account's Division. For another Division, switch to an account of that Division.">
                {pickedDivision}
                {fixId ? "" : forRep ? " · theirs" : " · yours"}
              </div>
            ) : (
              <select
                aria-label="Division"
                value={pickedDivision}
                disabled={Boolean(fixId)}
                onChange={(event) => event.target.value && divisionPicked(event.target.value)}
                className={FIELD}
              >
                {!pickedDivision && <option value="">-- Pick the Division --</option>}
                {(lockedDivisions ? ownDivisions : DIVISIONS).map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {ownChips.includes(name) ? (forRep ? " · theirs" : " · yours") : ""}
                  </option>
                ))}
              </select>
            )}
          </label>
            <label className="flex flex-col gap-1">
              <Label text="Sub-division" />
              {rule?.sub ? (
                // Fixed by the Division (the hub's rule).
                <div className={FIXED}>{rule.sub}</div>
              ) : rule?.subOptions ? (
                <select value={sentSub} onChange={(event) => setSubDivision(event.target.value)} className={FIELD}>
                  <option value="">-- Not set --</option>
                  {rule.subOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (SUB_DIVISIONS[pickedDivision] ?? []).length > 0 ? (
                <select
                  value={pickedSubDivision}
                  onChange={(event) => setSubDivision(event.target.value)}
                  className={FIELD}
                >
                  <option value="">-- Not set --</option>
                  {[
                    ...(pickedSubDivision &&
                    !(SUB_DIVISIONS[pickedDivision] ?? []).includes(pickedSubDivision)
                      ? [pickedSubDivision]
                      : []),
                    ...(SUB_DIVISIONS[pickedDivision] ?? []),
                  ].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={pickedSubDivision}
                  onChange={(event) => setSubDivision(event.target.value.toUpperCase())}
                  className={FIELD}
                  placeholder="The area within the Division"
                />
              )}
            </label>
            <label className="flex flex-col gap-1">
              <Label text="Headquarter" />
              {rule?.hqOptions ? (
                <select value={shownHq} onChange={(event) => setHeadquarter(event.target.value)} className={FIELD}>
                  <option value="">-- Pick the location --</option>
                  {[...(shownHq && !rule.hqOptions.includes(shownHq) ? [shownHq] : []), ...rule.hqOptions].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={shownHq}
                  onChange={(event) => setHeadquarter(event.target.value.toUpperCase())}
                  className={FIELD}
                  placeholder="Optional"
                />
              )}
            </label>
        </div>
        {!pickedDivision && (
          <span className="text-[12px] text-amber-700">Pick the Division this order counts for.</span>
        )}
        {pickedDivision && ownChips.length > 0 && !ownChips.includes(pickedDivision) && (
          <span className={HELP}>
            Another Division's order: its fields and papers are {pickedDivision}'s; it still counts for{" "}
            {forRep ? "them" : "you"} and goes to {forRep ? "their" : "your"} own team lead and head.
          </span>
        )}
        {/* The order's type, first (Aryan, 19 Nov): whose order it is; its papers follow. */}
        <div className="flex flex-col gap-1.5">
          <Label text="Order type" needed />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Order type">
            {orderTypesFor(pickedDivision)
              .filter((key) => key !== "gl" || PAP_DIVISIONS.includes(pickedDivision))
              .map((key) => {
              const on = orderType === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={management}
                  onClick={() => {
                    setOrderType(key);
                    // Only a Senior / PWD order has their price.
                    if (key !== "senior_pwd") setRelief(null);
                    if ((key === "gl") !== (orderType === "gl")) setHeadquarter(null);
                    if (key !== "gl") setProgram("");
                  }}
                  className={`inline-flex h-9 items-center rounded-xl border px-3 text-[13px] font-semibold transition ${
                    on
                      ? "border-brand bg-brand text-white shadow-2xs"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {ORDER_TYPE_LABEL[key]}
                </button>
              );
            })}
          </div>
          {orderType ? (
            <span className={HELP}>{ORDER_TYPE_HINT[orderType]}.</span>
          ) : (
            <span className="text-[12px] text-amber-700">Pick whose order it is: the papers it needs follow.</span>
          )}
        </div>
        {/* A guarantee letter's order: its programme, as the hub's Patient Assistance Program; it
            is the order's Source, and the Sub-division and Headquarter become Telesales. */}
        {pap && (
          <div className="flex flex-col gap-1.5">
            <Label text="Programme" needed />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Programme">
              {PAP_PROGRAMS.map((name) => {
                const on = program === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={management}
                    onClick={() => {
                      setProgram(name);
                      if ((ORDER_SOURCES as readonly string[]).includes(name)) setSource(name);
                    }}
                    className={`inline-flex h-9 items-center rounded-xl border px-3 text-[13px] font-semibold transition ${
                      on
                        ? "border-brand bg-brand text-white shadow-2xs"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <span className={HELP}>
              Sub-division and Headquarter are Telesales; attach the guarantee letter under Documents.
            </span>
            {/* The agency writes on the letter what it pays for our quotation (Aryan, 19 Nov): typed
                here when the letter is already in, else on the order when it comes. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <Label text="Letter number (when it is in)" />
                <input value={glNumber} onChange={(event) => setGlNumber(event.target.value)} className={FIELD} />
              </label>
              <label className="flex flex-col gap-1">
                <Label text="Amount on the letter, ₱ (when it is in)" />
                <input
                  inputMode="decimal"
                  value={glAmount}
                  onChange={(event) => setGlAmount(event.target.value)}
                  className={FIELD}
                  placeholder="What the agency approves"
                />
              </label>
            </div>
          </div>
        )}
      </Part>

      {/* 2 · Customer details: who buys, where it goes, how they pay (the hub's second part) */}
      <Part number={2} title="Customer details" icon={Users} missing={management ? undefined : missing}>
        {picked ? (
          <div className={`${BOX} flex flex-col gap-2.5`}>
            <div className="flex items-start gap-3">
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-2xs ${avatarTone(picked.name)}`}
              >
                {initials(picked.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold tracking-tight text-slate-900">
                  {picked.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  {[
                    kindLabel,
                    picked.city,
                    picked.lastOrderOn
                      ? `last order ${dayLabel(picked.lastOrderOn)}`
                      : "no order yet",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {!fixId && (
                <button
                  type="button"
                  onClick={() => setCustomerId(null)}
                  className="h-9 px-1 text-xs font-medium text-emerald-700 hover:underline"
                >
                  Change
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {me?.role === "medrep" &&
                (picked.inMyArea ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    In your area
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    Not in your area
                  </span>
                ))}
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                {terms}
              </span>
              {picked.licenceState === "expired" ? (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                  Licence expired
                </span>
              ) : picked.licenceExpires ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  Licence to {monthYear(picked.licenceExpires)}
                </span>
              ) : null}
              {picked.review === "to_review" && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  New customer, not checked yet
                </span>
              )}
              {/* What the customer's channel keeps on it (19 Nov: "as the MedRep picks, the relevant
                  things come"): the licence missing, a hospital's accreditation and formulary, a
                  chain's listings. */}
              {picked.licenceState === "none" && ["hospital", "drugstore", "distributor"].includes(picked.kind) && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  No FDA licence on file
                </span>
              )}
              {standing?.accreditation ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    standing.accreditation.status === "accredited"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                      : standing.accreditation.status === "refused"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {standing.accreditation.status === "accredited"
                    ? `2MG accredited${standing.accreditation.validUntil ? ` to ${monthYear(standing.accreditation.validUntil)}` : ""}`
                    : standing.accreditation.status === "refused"
                      ? "Accreditation refused"
                      : "Accreditation applied for"}
                </span>
              ) : (
                picked.kind === "hospital" &&
                pickedDivision === "HOSP" && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    Accreditation not recorded
                  </span>
                )
              )}
              {standing && standing.formulary.approved + standing.formulary.requested > 0 && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  {standing.formulary.approved} of ours on its formulary
                  {standing.formulary.requested ? ` · ${standing.formulary.requested} asked for` : ""}
                </span>
              )}
              {standing && standing.listed > 0 && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  {standing.listed} of ours listed
                </span>
              )}
            </div>
            {standing && standing.awards.length > 0 && (
              <label className="mt-2 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-700">Which award does this order deliver?</span>
                <select
                  value={tenderId ?? ""}
                  onChange={(event) => setTenderId(event.target.value ? Number(event.target.value) : null)}
                  className={FIELD}
                >
                  <option value="">None: not for a tender</option>
                  {standing.awards.map((award) => (
                    <option key={award.id} value={award.id}>
                      {award.code} · {award.title}
                      {award.deliverBy ? ` · deliver by ${dayLabel(award.deliverBy)}` : ""}
                    </option>
                  ))}
                </select>
                <span className={HELP}>Its tender won, with no order yet: the tender keeps this order as its delivery.</span>
                {/* A tender's order is placed at the bid that won it (Aryan, 23 Nov): its medicines,
                    pieces and prices in one press. Each line says it is the bid's price. */}
                {(() => {
                  const award = standing.awards.find((one) => one.id === tenderId);
                  if (!award || award.lines.length === 0) return null;
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        setLines(
                          award.lines.flatMap((bid, at) => {
                            const row = byId.get(bid.medicineId);
                            const first = row ? pricesOf(row)[0] : undefined;
                            if (!row || !first) return [];
                            return [
                              {
                                key: at + 1,
                                medicineId: bid.medicineId,
                                priceKind: first.kind,
                                qty: bid.qty,
                                lower: bid.unitPrice !== first.amount,
                                given: (bid.unitPrice / 100).toFixed(2),
                                reason: `Bid price of ${award.code}`,
                              },
                            ];
                          }),
                        )
                      }
                      className="self-start rounded-[10px] border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      Take the bid's {award.lines.length} {award.lines.length === 1 ? "medicine" : "medicines"} and prices
                    </button>
                  );
                })()}
              </label>
            )}
            {standing && standing.clidpRates.length > 0 && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                <b className="text-slate-900">Agreed CLIDP prices</b>
                {standing.clidpRates.map((rate) => (
                  <span key={rate.medicineId} className="block">
                    {rate.medicine}: {peso(rate.unitPrice)} each{rate.moq ? ` · at least ${rate.moq}` : ""}
                    <span className="text-slate-500"> · since {dayLabel(rate.agreedOn)}</span>
                  </span>
                ))}
              </div>
            )}
            {(picked.overdue > 0 ||
              (picked.creditLimit != null && picked.owed + total > picked.creditLimit)) && (
              // Said before placing, so the MedRep can collect or talk to Management first.
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                {picked.overdue > 0 && (
                  <div>
                    <b>{shortPeso(picked.overdue)} past due</b>, the oldest {picked.overdueDays}{" "}
                    days late (owes {shortPeso(picked.owed)} in all). Management sees it before
                    approving: collect first if you can.
                  </div>
                )}
                {picked.creditLimit != null && picked.owed + total > picked.creditLimit && (
                  <div>
                    With this order they would owe {shortPeso(picked.owed + total)}, over their
                    credit limit of {shortPeso(picked.creditLimit)}.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
        {picked && forWhom.data?.can && !fixId && (
          <label className={`${BOX} flex flex-col gap-1.5`}>
            <span className="text-xs font-semibold text-slate-700">Whose order is it?</span>
            <select
              value={medrepId ?? ""}
              onChange={(event) => {
                setMedrepTouched(true);
                setMedrepId(event.target.value ? Number(event.target.value) : null);
              }}
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">Mine (no MedRep: an empty seat's customer)</option>
              {forWhom.data.medreps.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                  {rep.login ? ` · ${rep.login}` : ""}
                  {rep.area ? ` · ${rep.area}` : ""}
                  {rep.id === forWhom.data?.suggested ? " (this customer's MedRep)" : ""}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">
              The order counts for this MedRep's sales and target, and they follow it like their
              own.
            </span>
          </label>
        )}
        {picked ? null : customerId ? (
          <PageState query={customer} what="the customer" />
        ) : (
          <div className="flex flex-col gap-2">
            {/* Most orders from the field are for someone new: adding them comes first. */}
            {customers.data?.can.add && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-left text-slate-900 shadow-2xs transition hover:border-slate-400 hover:bg-slate-50"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                  <UserPlus className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">New customer</span>
                  <span className="block text-[11px] text-slate-500">
                    A hospital, doctor or patient not in the CRM yet. Their phone number is checked
                    first.
                  </span>
                </span>
              </button>
            )}
            <div className="flex items-center gap-2 px-1 pt-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              <span className="h-px flex-1 bg-slate-200" />
              {findCustomer.trim() ? "found" : "or one you ordered for lately"}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
              <input
                aria-label="Search a customer"
                placeholder="Search by name, phone number or city"
                value={findCustomer}
                onChange={(event) => setFindCustomer(event.target.value)}
                className={`${FIELD} pl-9`}
              />
            </div>
            {action.at("customerId") && (
              <div className="text-xs text-rose-700">{action.at("customerId")}</div>
            )}
            {divisionKinds && (
              <div className="flex flex-wrap items-center gap-1.5 px-1" role="radiogroup" aria-label="Which customers">
                {(
                  [
                    [false, `${pickedDivision}: ${divisionKinds.map((kind) => BUYER_WORDS[kind] ?? kind).join(" & ")}`],
                    [true, "Every customer"],
                  ] as const
                ).map(([every, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={everyKind === every}
                    onClick={() => setEveryKind(every)}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${
                      everyKind === every
                        ? "bg-slate-900 text-white ring-slate-900"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              {(findCustomer.trim()
                ? kindRows.slice(0, 12)
                : [...kindRows]
                    .filter((row) => row.lastOrderAt)
                    .sort((a, b) => (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? ""))
                    .slice(0, 5)
              ).map((row) => (
                <li key={row.id} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setCustomerId(row.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${avatarTone(row.name)}`}
                    >
                      {initials(row.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">
                        {row.name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {[
                          customers.data?.kinds.find((kind) => kind.key === row.kind)?.label,
                          row.city,
                          row.phone,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {customers.data && findCustomer.trim() && kindRows.length === 0 && otherKinds === 0 && (
                <li className="px-3.5 py-3 text-xs text-slate-500">
                  No customer matches: add them as a New customer above.
                </li>
              )}
              {customers.data && otherKinds > 0 && !everyKind && (findCustomer.trim() || kindRows.length === 0) && (
                <li className="px-3.5 py-2.5">
                  <button type="button" onClick={() => setEveryKind(true)} className="text-xs font-semibold text-brand hover:underline">
                    {otherKinds} more of other kinds: show every customer
                  </button>
                </li>
              )}
              {customers.data &&
                !findCustomer.trim() &&
                !kindRows.some((row) => row.lastOrderAt) && (
                  <li className="px-3.5 py-3 text-xs text-slate-500">
                    Type a name, phone number or city to find one.
                  </li>
                )}
              {customers.isPending && (
                <li className="px-3.5 py-3 text-xs text-slate-500">Searching…</li>
              )}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <label className="col-span-2 flex flex-col gap-1">
            <Label text="Delivery address" needed />
            <textarea
              rows={2}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={`${FIELD} h-auto py-2`}
              placeholder="Filled from the customer: change it if it goes elsewhere"
            />
          </label>
          <label className="flex flex-col gap-1">
            <Label text="Receiver name" />
            <input
              value={receiver}
              onChange={(event) => setReceiver(event.target.value)}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1">
            <Label text="Receiver contact no." />
            <input
              type="tel"
              value={receiverPhone}
              onChange={(event) => setReceiverPhone(event.target.value)}
              onBlur={(event) => setReceiverPhone(formatPhone(event.target.value) ?? "")}
              className={FIELD}
            />
          </label>
          <div className="flex flex-col gap-1">
            <Label text="Payment terms" needed />
            {/* Any terms the customer agreed (Aryan, 18 Nov: "30, 45, 60 days, three months, a
                date"): the usual list, any number of days, or a particular date. */}
            <select
              aria-label="Payment terms"
              value={termMode === "list" ? paymentTerm : termMode}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "__days" || value === "__date") {
                  setTermMode(value);
                  setPaymentTerm("");
                } else {
                  setTermMode("list");
                  setPaymentTerm(value);
                }
              }}
              className={FIELD}
            >
              <option value="">
                {picked ? `Usual: ${terms}` : "-- Not set --"}
              </option>
              {PAYMENT_TERMS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {termMode === "list" &&
                paymentTerm &&
                !PAYMENT_TERMS.includes(paymentTerm as (typeof PAYMENT_TERMS)[number]) && (
                  <option value={paymentTerm}>{paymentTerm}</option>
                )}
              <option value="__days">Other: number of days…</option>
              <option value="__date">By a date…</option>
            </select>
            {termMode === "__days" && (
              <label className="flex items-center gap-2 text-[13px] text-slate-600">
                <input
                  aria-label="Days to pay"
                  inputMode="numeric"
                  value={paymentTerm.replace(/\D/g, "")}
                  onChange={(event) => {
                    const n = event.target.value.replace(/\D/g, "").slice(0, 3);
                    setPaymentTerm(n ? `${n} days` : "");
                  }}
                  placeholder="e.g. 75"
                  className={`${FIELD} w-24`}
                />
                days after delivery
              </label>
            )}
            {termMode === "__date" && (
              <label className="flex items-center gap-2 text-[13px] text-slate-600">
                Pays by
                <input
                  aria-label="Pays by"
                  type="date"
                  min={manilaToday()}
                  value={paymentTerm.startsWith("Pays by ") ? paymentTerm.slice(8) : ""}
                  onChange={(event) => setPaymentTerm(event.target.value ? `Pays by ${event.target.value}` : "")}
                  className={`${FIELD} w-44`}
                />
              </label>
            )}
          </div>
          <label className="flex flex-col gap-1">
            <Label text="Source" needed />
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className={FIELD}
            >
              <option value="">-- Pick the source --</option>
              {ORDER_SOURCES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {action.at("source") && <span className="text-xs text-rose-700">{action.at("source")}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <Label text="Invoicing from" needed />
            <select
              value={invoiceFrom}
              onChange={(event) => setInvoiceFrom(event.target.value as InvoiceFrom)}
              className={FIELD}
            >
              {COMPANY_CODES.map((code) => (
                <option key={code} value={code}>
                  {COMPANIES[code].name}
                </option>
              ))}
            </select>
          </label>
          {/* Their PO number: asked on an order with their PO, never on a patient's own (19 Nov). */}
          {(orderType === "po" || patientOrder || customerPo || (!orderType && picked?.kind !== "patient")) && (
            <label className="flex flex-col gap-1">
              <Label
                text={picked?.kind === "hospital" ? "Hospital PO number" : "Customer's PO number"}
                needed={orderType === "po"}
              />
              <input
                value={customerPo}
                onChange={(event) => setCustomerPo(event.target.value)}
                className={FIELD}
              />
              {orderType === "po" && (
                <span className={HELP}>As on their PO: it goes on the invoice. Attach the PO under Documents.</span>
              )}
            </label>
          )}
          <label className="flex flex-col gap-1">
            <Label text="Date needed" needed />
            <input
              type="date"
              value={expectedOn}
              min={manilaToday()}
              onChange={(event) => setExpectedOn(event.target.value)}
              className={FIELD}
            />
            {action.at("expectedOn") && (
              <span className="text-xs text-rose-700">{action.at("expectedOn")}</span>
            )}
          </label>
          <div className="col-span-2 flex flex-col gap-1">
            <Label text="Doctor (if any)" />
            {doctor ? (
              <div className="flex items-center justify-between gap-2 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px]">
                <span className="font-medium text-slate-900">{doctor.name}</span>
                <button
                  type="button"
                  aria-label="Take the doctor off"
                  onClick={() => setDoctor(null)}
                  className="grid size-6 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={findDoctor}
                  onChange={(event) => setFindDoctor(event.target.value)}
                  placeholder="Search a doctor"
                  className={FIELD}
                  aria-label="Search a doctor"
                />
                {(findDoctor.trim() ? (doctors.data?.rows ?? []) : (customer.data?.doctors ?? []))
                  .length > 0 &&
                  (findDoctor.trim() || picked?.kind === "hospital") && (
                    <ul className="mt-1 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      {!findDoctor.trim() && (
                        <li className="px-3 pt-2 text-[10px] font-semibold text-slate-400 uppercase">
                          Doctors at this hospital
                        </li>
                      )}
                      {(findDoctor.trim()
                        ? (doctors.data?.rows ?? [])
                        : (customer.data?.doctors ?? [])
                      )
                        .slice(0, 6)
                        .map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setDoctor({ id: row.id, name: row.name });
                                setFindDoctor("");
                              }}
                              className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50"
                            >
                              <span className="font-semibold text-slate-900">{row.name}</span>
                              {row.specialty && (
                                <span className="text-slate-500"> · {row.specialty}</span>
                              )}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
              </div>
            )}
            {action.at("doctorId") && (
              <span className="text-xs text-rose-700">{action.at("doctorId")}</span>
            )}
          </div>
          <label className="col-span-2 flex flex-col gap-1">
            <Label text="Customer remarks" needed />
            <textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={`${FIELD} h-auto py-2`}
              placeholder="What the customer asked, anything Management should know"
            />
          </label>
        </div>
      </Part>

      {/* 3 · Medicines: price from Inventory by the buyer's kind, VAT shown (the hub's third part) */}
      <Part
        number={3}
        title="Medicines"
        icon={Pill}
        missing={management ? undefined : missing}
        aside={
          picked ? (
            <span className="text-[11px] text-ink-2">
              {catalogue.data.buyerTypes.find((type) => type.key === USUAL[picked.kind])?.label}{" "}
              prices first
            </span>
          ) : undefined
        }
      >
          <datalist id="promo-kinds">
            {["Buy 1 Take 1", "Buy 2 Take 1", "Buy 10 Take 1", "Sample", "Promo"].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

        <MedicineFinder
          id="order-medicine"
          buyer={(picked ? USUAL[picked.kind] : "patient") as BuyerType}
          catalogue={{ ...catalogue.data, rows: medicines }}
          taken={lines.map((line) => line.medicineId)}
          takenWhy="Already on the order"
          onPick={addMedicine}
          missing={(text) => (
            // Not in our list: ask Inventory for it, so it can be bought in (the order waits).
            <span className="flex items-center justify-between gap-3">
              <span>"{text}" isn't in our list.</span>
              <button
                type="button"
                onClick={() => {
                  setFindMedicine(text);
                  setAskingMedicine(true);
                }}
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
              >
                Ask Inventory for it
              </button>
            </span>
          )}
        />
        {askingMedicine && catalogue.data && (
          <MedicineRequestDialog
            catalogue={catalogue.data}
            start={{ id: 0, name: findMedicine.trim(), strength: null }}
            onClose={() => {
              setAskingMedicine(false);
              setFindMedicine("");
            }}
          />
        )}
        {picked && (orderType === "senior_pwd" || relief) && (
          // A senior citizen's or PWD's ID shown: 20% off and no VAT (the law), or a promo
          // without VAT when lower, never both. Management keeps what the MedRep chose. A Senior /
          // PWD order picks which (19 Nov); no other type has it.
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-semibold text-slate-900">
                Senior citizen or PWD?
              </span>
              <span className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                {(
                  [
                    { kind: null, label: "No" },
                    { kind: "senior", label: "Senior citizen" },
                    { kind: "pwd", label: "PWD" },
                  ] as const
                )
                  .filter((choice) => !(orderType === "senior_pwd" && choice.kind === null))
                  .map((choice) => {
                  const on = (relief?.kind ?? null) === choice.kind;
                  return (
                    <button
                      key={choice.label}
                      type="button"
                      disabled={management}
                      aria-pressed={on}
                      onClick={() => {
                        setRelief(
                          choice.kind
                            ? {
                                kind: choice.kind,
                                idNo: relief?.idNo ?? "",
                                name:
                                  relief?.name ??
                                  (picked.kind === "patient" ? picked.name : patientName),
                              }
                            : null,
                        );
                        // The law's price replaces any other price typed on the lines.
                        if (choice.kind)
                          setLines((all) =>
                            all.map((line) =>
                              line.free ? line : { ...line, lower: false, given: "", reason: "" },
                            ),
                          );
                      }}
                      className={`rounded-md px-3 py-1.5 disabled:cursor-not-allowed ${on ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </span>
            </div>
            {relief && (
              <div className="flex flex-wrap gap-3">
                <label className="flex min-w-40 flex-1 flex-col gap-1">
                  <span className={FIELD_LABEL}>
                    {relief.kind === "senior" ? "OSCA ID number" : "PWD ID number"}
                  </span>
                  <input
                    value={relief.idNo}
                    disabled={management}
                    onChange={(event) => setRelief({ ...relief, idNo: event.target.value })}
                    className={FIELD}
                    placeholder="As on their ID"
                  />
                </label>
                <label className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className={FIELD_LABEL}>Name on the ID</span>
                  <input
                    value={relief.name}
                    disabled={management}
                    onChange={(event) => setRelief({ ...relief, name: event.target.value })}
                    className={FIELD}
                  />
                </label>
              </div>
            )}
            {(action.at("relief.idNo") ?? action.at("relief")) && (
              <div className="text-xs text-rose-700">
                {action.at("relief.idNo") ?? action.at("relief")}
              </div>
            )}
            {relief && (
              <span className="text-[11px] text-slate-500">
                {management
                  ? "As the MedRep placed it. "
                  : ""}
                Every paid medicine at its patient price without VAT and 20% off, or its promo
                without VAT when lower (never both). Attach a photo of their ID under Papers:
                Management checks it.
              </span>
            )}
          </div>
        )}
        {action.at("items") && <div className="text-xs text-rose-700">{action.at("items")}</div>}
        {lines.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500">
            Search a medicine above to add it.
          </div>
        )}
        {lines.map((line, index) => {
          const row = byId.get(line.medicineId);
          if (!row) return null;
          // A medicine with a Buy X Take Y running: its free pieces come by themselves (below).
          if (line.free && offerTakes(line.medicineId)) return null;
          if (line.free)
            return (
              <div
                key={line.key}
                className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="mr-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Free
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {[row.name, row.strength].filter(Boolean).join(" ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-emerald-800 tabular-nums">₱0</span>
                    <button
                      type="button"
                      aria-label={`Remove the free ${row.name}`}
                      onClick={() =>
                        setLines((all) => all.filter((other) => other.key !== line.key))
                      }
                      className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={FIELD_LABEL}>Promo</span>
                    <input
                      list="promo-kinds"
                      value={line.reason}
                      onChange={(event) => change(line.key, { reason: event.target.value })}
                      className={FIELD}
                      placeholder="e.g. Buy 1 Take 1"
                    />
                  </label>
                  <label className="flex w-28 flex-col gap-1">
                    <span className={FIELD_LABEL}>Free pieces</span>
                    <input
                      inputMode="numeric"
                      value={line.qty}
                      onChange={(event) =>
                        change(line.key, {
                          qty: Math.max(0, Number(event.target.value.replace(/\D/g, "")) || 0),
                        })
                      }
                      className={`${FIELD} text-center font-semibold tabular-nums`}
                    />
                  </label>
                </div>
                {lineError(index, "qty") && (
                  <div className="text-xs text-rose-700">{lineError(index, "qty")}</div>
                )}
              </div>
            );
          const held = stockOf(row.id);
          const short = line.qty > row.free;
          const list = listOf(line);
          const each = eachOf(line);
          const below = line.lower && each < list;
          const option = pricesOf(row).find((item) => item.kind === line.priceKind);
          return (
            <div key={line.key} className={`${BOX} flex flex-col gap-3`}>
              <div className="flex justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="text-sm font-semibold tracking-tight text-slate-900">
                    {[row.name, row.strength].filter(Boolean).join(" ")}
                    {row.pack ? (
                      <span className="font-normal text-slate-500">, {row.pack.toLowerCase()}</span>
                    ) : null}
                  </div>
                  {/* VAT as Inventory keeps it, so nobody looks it up by hand (Aryan, 17 Nov). */}
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                    <span
                      className={`rounded px-1.5 py-0.5 ${row.vat === "vat12" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                    >
                      {VAT_WORDS[row.vat] ?? row.vat}
                    </span>
                    {row.rx && (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
                        Prescription
                      </span>
                    )}
                  </div>
                  {/* Sellers don't need the shelf's numbers (Aryan, 18 Nov): only when it runs out. */}
                  {short && (
                    <div className="text-[11px] font-semibold text-rose-700">
                      {row.free <= 0 ? "Out of stock" : "Not all of it is in stock"}
                      {held?.coming ? (
                        <span className="font-normal text-slate-500">
                          {" "}
                          · more arrive {dayLabel(held.coming.on)}
                        </span>
                      ) : null}
                      <span className="font-normal text-slate-500"> · Dispatch sees it</span>
                    </div>
                  )}
                  {/* What Dispatch announced about this medicine (the hub showed it on the items). */}
                  {(stock.data?.news ?? [])
                    .filter((one) => one.medicineId === row.id)
                    .map((one) => (
                      <div
                        key={one.id}
                        className="flex items-start gap-1 text-[11px] font-medium text-amber-800"
                      >
                        <Megaphone className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {NEWS_WORDS[one.kind]}
                          {one.message ? `: ${one.message}` : ""} · {one.by}
                        </span>
                      </div>
                    ))}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">
                    {peso(line.qty * each)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => setLines((all) => all.filter((other) => other.key !== line.key))}
                    className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] text-slate-500">
                  Price for one {row.unit ?? "piece"} · tap the one you are giving
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pricesOf(row).map((item) => {
                    const on = line.priceKind === item.kind;
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        aria-pressed={on}
                        onClick={() => change(line.key, { priceKind: item.kind })}
                        className={`min-h-12 rounded-[10px] px-3 py-1.5 text-left transition-colors ${on ? "border-2 border-brand bg-emerald-50" : "border border-slate-200 bg-white hover:border-slate-300"}`}
                      >
                        <span
                          className={`block text-[10px] ${on ? "font-semibold text-emerald-800" : "text-slate-500"}`}
                        >
                          {item.label}
                        </span>
                        <span className="block text-[13px] font-semibold text-slate-900 tabular-nums">
                          {peso(item.amount)}
                        </span>
                      </button>
                    );
                  })}
                  {pricesOf(row).length === 0 && (
                    <span className="text-xs text-rose-700">
                      No price set for this medicine yet. Ask Management.
                    </span>
                  )}
                </div>
                {lineError(index, "priceKind") && (
                  <div className="text-xs text-rose-700">{lineError(index, "priceKind")}</div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[13px]">
                  {peso(each)} <span className="text-slate-500">each</span>
                  {inPacks(line.qty, row.packSize) && (
                    <span className="ml-2 text-[11px] text-slate-500">
                      {inPacks(line.qty, row.packSize)}
                    </span>
                  )}
                </div>
                <div className="flex items-center rounded-[10px] border border-slate-200 bg-white">
                  <button
                    type="button"
                    aria-label={`One less ${row.name}`}
                    onClick={() => change(line.key, { qty: Math.max(1, line.qty - 1) })}
                    className="grid size-11 place-items-center text-slate-600 hover:bg-slate-50"
                  >
                    <Minus className="size-4" />
                  </button>
                  <input
                    aria-label={`How many ${row.unit ?? "pieces"} of ${row.name}`}
                    inputMode="numeric"
                    value={line.qty}
                    onChange={(event) =>
                      change(line.key, {
                        qty: Math.max(0, Number(event.target.value.replace(/\D/g, "")) || 0),
                      })
                    }
                    className="w-16 border-0 bg-transparent text-center text-sm font-semibold text-slate-900 tabular-nums focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`One more ${row.name}`}
                    onClick={() => change(line.key, { qty: line.qty + 1 })}
                    className="grid size-11 place-items-center text-slate-600 hover:bg-slate-50"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
              {lineError(index, "qty") && (
                <div className="text-xs text-rose-700">{lineError(index, "qty")}</div>
              )}

              {!withRelief && line.lower ? (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-900">
                      {orderType === "po" ? "Their PO's price against " : "Giving another price than "}
                      {option ? `the ${option.label.toLowerCase()} price` : "these"}
                    </span>
                    <button
                      type="button"
                      onClick={() => change(line.key, { lower: false, given: "", reason: "" })}
                      className="text-[11px] font-medium text-amber-800 hover:underline"
                    >
                      Use the price
                    </button>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-amber-900">
                      {orderType === "po" ? "Their PO price (₱ each)" : "You gave it at (₱ each)"}
                    </span>
                    <input
                      inputMode="decimal"
                      value={line.given}
                      onChange={(event) => change(line.key, { given: event.target.value })}
                      className={FIELD}
                    />
                  </label>
                  {lineError(index, "unitPrice") && (
                    <div className="text-xs text-rose-700">{lineError(index, "unitPrice")}</div>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-amber-900">Why</span>
                    <input
                      value={line.reason}
                      onChange={(event) => change(line.key, { reason: event.target.value })}
                      className={FIELD}
                      placeholder="e.g. Hospital asked to match their last order"
                    />
                  </label>
                  {lineError(index, "reason") && (
                    <div className="text-xs text-rose-700">{lineError(index, "reason")}</div>
                  )}
                  {below && (
                    <div className="text-xs text-amber-900">
                      {peso(list - each)} below the {option?.label.toLowerCase()} price (
                      {((100 * (list - each)) / list).toFixed(1)}%). Management decides.
                    </div>
                  )}
                  {line.lower && each > list && (
                    <div className="text-xs text-amber-900">
                      {peso(each - list)} above the {option?.label.toLowerCase()} price. Management
                      sees it.
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {withRelief ? (
                    <span className="self-start text-xs font-medium text-sky-800">
                      {relief?.kind === "pwd" ? "PWD" : "Senior citizen"} price {peso(each)}{" "}
                      (patient price {peso(reliefBase(line))}, no VAT, 20% off)
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        change(line.key, {
                          lower: true,
                          given: String(list / 100),
                          // A PO's price is mapped against ours (Aryan, 19 Nov); Management decides.
                          ...(orderType === "po" ? { reason: "As on their PO" } : {}),
                        })
                      }
                      className="self-start text-xs font-medium text-emerald-700 hover:underline"
                    >
                      {orderType === "po" ? "Their PO has another price" : "Give another price"}
                    </button>
                  )}
                  {!offerTakes(line.medicineId) &&
                    !lines.some((other) => other.free && other.medicineId === line.medicineId) && (
                      <button
                        type="button"
                        onClick={() => addFree(line)}
                        className="self-start text-xs font-medium text-emerald-700 hover:underline"
                      >
                        + Free (a sample, a deal)
                      </button>
                    )}
                </div>
              )}
              {offerTakes(line.medicineId) && (
                // The hub's "🎁 Buy 1 Take 1 · +N free": added by the system, as the offer gives it.
                <div className="flex items-center gap-2 rounded-lg bg-good-tint px-3 py-2 text-xs font-semibold text-good">
                  <Gift className="size-4 shrink-0" aria-hidden="true" />
                  {offerTakes(line.medicineId)?.name} · +{count(offerFree(line))} free, added by itself
                  {offerFree(line) === 0
                    ? ` (from ${count(offerTakes(line.medicineId)?.buy ?? 1)} bought)`
                    : ""}
                </div>
              )}
            </div>
          );
        })}
      </Part>

      {/* 4 · Documents: proof of payment or why not, the prescription, the customer's papers */}
      <Part number={4} title="Documents" icon={Paperclip} missing={management ? undefined : missing}>
        {/* For one patient through a hospital or a doctor: a patient's type for that customer
            (19 Nov), so only the patient's name is asked. */}
        {patientOrder && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-[13px] font-semibold text-slate-900">For one patient</span>
            <input
              aria-label="The patient's name"
              value={patientName}
              onChange={(event) => setPatientName(event.target.value)}
              placeholder="The patient's name"
              className={`${FIELD} min-w-48 flex-1`}
            />
            <span className="w-full text-[11px] text-slate-500">
              Add the prescription and the patient's ID below: Management checks them.
            </span>
          </div>
        )}
        {/* No prescription yet on a prescription Division's order: why (the hub's "No prescription?
            Say why"); Management reads it with the papers. */}
        {rxDivision && !forPatient && !papers.prescription && !onFile.has("prescription") && (
          <label className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <span className="text-[13px] font-semibold text-amber-900">No prescription? Say why</span>
            <textarea
              value={noRxReason}
              onChange={(event) => setNoRxReason(event.target.value)}
              rows={2}
              className={FIELD}
              placeholder="e.g. The doctor sends it before delivery / The clinic keeps stock for its patients"
            />
          </label>
        )}
        {!morePapers && (
          <button type="button" onClick={() => setMorePapers(true)} className="self-start text-[13px] font-semibold text-emerald-700 hover:underline">
            + Another paper (their PO, licence, prescription, proof of payment…)
          </button>
        )}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm empty:hidden">
          {[...PAPERS]
            .sort((a, b) => paperRank(a.kind, forPatient) - paperRank(b.kind, forPatient))
            .filter((paper) =>
              forPatient
                ? // A hospital's or doctor's PO may come with one patient's order; the SC/PWD ID
                  // and the guarantee letter with their own types (19 Nov).
                  (!paper.business || (paper.kind === "po" && patientOrder)) &&
                  (paper.kind !== "senior_id" || orderType === "senior_pwd" || withRelief) &&
                  (paper.kind !== "gl" || orderType === "gl" || !orderType)
                : !paper.patient ||
                  paper.kind === "prescription" ||
                  // The SC/PWD ID, on any order given their price.
                  (paper.kind === "senior_id" && withRelief),
            )
            // Only the papers this order asks for, and those already attached; the others one
            // press away (Aryan, 23 Nov: a short form).
            .filter((paper) => morePapers || paperAsked(paper.kind) || Boolean(papers[paper.kind]) || onFile.has(paper.kind))
            .map((paper) => {
              const file = papers[paper.kind];
              const already = onFile.has(paper.kind);
              // Whenever a patient buys, the prescription is needed (Aryan, 17 Nov).
              // The type's own papers are asked for too (19 Nov): Management's Documents check
              // reads them; only the prescription keeps the order from going.
              const needed = paperNeeded(paper.kind);
              return (
                <div
                  key={paper.kind}
                  className="flex min-h-13 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] text-slate-900">
                      {paper.label}
                      {needed && !file && !already && (
                        <span className="ml-2 rounded bg-bad-tint px-1.5 py-0.5 text-[10px] font-semibold text-bad">
                          Needed
                        </span>
                      )}
                      {already && !file && (
                        <span className="ml-2 text-[11px] text-good">On the order already</span>
                      )}
                    </div>
                    {paper.kind === "payment_proof" && asksProof && !file && !already && (
                        <div id="no-proof" className="mt-1 flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Why there is no proof yet"
                            value={noProof}
                            onChange={(event) => {
                              setNoProof(event.target.value as NoProofReason | "");
                              setNoProofAsk(false);
                            }}
                            className={`h-8 rounded-lg border bg-white px-2 text-xs ${noProofAsk && !noProof ? "border-rose-400" : "border-slate-200"}`}
                          >
                            <option value="">No proof of payment? Say why…</option>
                            {NO_PROOF_REASONS.map((one) => (
                              <option key={one.value} value={one.value}>
                                {one.label}
                              </option>
                            ))}
                          </select>
                          {noProof && (
                            <input
                              aria-label="A word for Finance"
                              value={noProofNote}
                              maxLength={300}
                              onChange={(event) => setNoProofNote(event.target.value)}
                              placeholder={
                                noProof === "other"
                                  ? "Say what (needed)"
                                  : "A word for Finance (optional)"
                              }
                              className={`h-8 min-w-40 flex-1 rounded-lg border bg-white px-2 text-xs ${noProofAsk && noProof === "other" && !noProofNote.trim() ? "border-rose-400" : "border-slate-200"}`}
                            />
                          )}
                          {noProofAsk && (
                            <span className="w-full text-[11px] text-rose-700">
                              Add the proof, or say why it isn't here yet
                            </span>
                          )}
                        </div>
                      )}
                  </div>
                  {file ? (
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <FileCheck2 className="size-4 shrink-0 text-emerald-600" />
                      <span
                        className="max-w-40 truncate font-semibold text-emerald-700"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove the ${paper.label.toLowerCase()}`}
                        onClick={() => setPapers((all) => ({ ...all, [paper.kind]: undefined }))}
                        className="grid size-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                      <Camera className="size-4" /> Add photo
                      <input
                        type="file"
                        accept={PAPER_ACCEPT}
                        className="sr-only"
                        onChange={(event) => {
                          const chosen = event.target.files?.[0];
                          if (chosen) setPapers((all) => ({ ...all, [paper.kind]: chosen }));
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
        </div>
      </Part>

      {/* 5 · Review and place: what is missing, then the hub's Confirm window */}
      <Part number={5} title="Review and place" icon={ClipboardCheck} missing={management ? undefined : missing}>
      {lines.length > 0 && listTotal > total && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 px-4 py-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-slate-500">
              Subtotal, {lines.length} {lines.length === 1 ? "medicine" : "medicines"}
            </span>
            <span className="tabular-nums">{peso(listTotal)}</span>
          </div>
          {listTotal > total && (
            <div className="flex justify-between">
              <span className="text-slate-500">Lower price given</span>
              <span className="tabular-nums">−{peso(listTotal - total)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">VAT</span>
            <span>Included in the prices</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 font-semibold">
            <span>Total</span>
            <span className="text-base tabular-nums">{peso(total)}</span>
          </div>
        </div>
      )}

      {picked && lines.length > 0 && warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {warnings.map((warning) => (
            <div key={warning} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{warning}. Management sees this.</span>
            </div>
          ))}
        </div>
      )}

      {fixId && (
        <section className="flex flex-col gap-2 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <label htmlFor="answer" className="text-sm font-bold text-slate-900">
            {management ? "Why you changed it (the MedRep is told)" : "Your answer to Management"}
          </label>
          <textarea
            id="answer"
            required
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={
              management
                ? "Only 20 in stock; price as agreed with the hospital"
                : "What you changed, or why it is right as it is"
            }
            className={`${FIELD} min-h-20 py-2`}
            aria-invalid={Boolean(action.at("answer"))}
          />
          {action.at("answer") && (
            <span className="text-xs font-medium text-rose-700">{action.at("answer")}</span>
          )}
        </section>
      )}

      {action.problem && !action.problem.field && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
        >
          {action.problem.message}
        </div>
      )}
      {missing.length > 0 ? (
        <div className="rounded-lg border border-bad/20 bg-bad-tint px-3.5 py-2.5 text-[13px] text-bad">
          <b>Missing:</b> {missing.join(", ")}
        </div>
      ) : (
        !management && (
          <div className="flex items-center gap-2 text-[13px] text-good">
            <Check className="size-4" aria-hidden="true" /> Everything needed is filled. Place it to
            see the summary first.
          </div>
        )
      )}
      </Part>

      <div className="sticky bottom-16 z-10 -mx-4 flex items-center gap-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-2 md:mx-0 md:rounded-2xl md:border md:shadow-[0_12px_32px_-16px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-500">
            Total{lines.length > 0 ? ` · ${lines.length} ${lines.length === 1 ? "medicine" : "medicines"}` : ""}
          </span>
          <span className="text-xl font-bold tracking-tight tabular-nums">{peso(total)}</span>
        </div>
        {!management && (
          <button
            type="button"
            onClick={() => {
              const first = missing[0];
              if (first) document.getElementById(`part-${partOf(first)}`)?.scrollIntoView({ block: "start" });
            }}
            className={`hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold sm:flex ${
              missing.length ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            }`}
            title={missing.length ? `Missing: ${missing.join(", ")}` : undefined}
          >
            {missing.length ? (
              <>
                <TriangleAlert className="size-3.5" aria-hidden="true" /> {missing.length} to fill
              </>
            ) : (
              <>
                <Check className="size-3.5" aria-hidden="true" /> Ready
              </>
            )}
          </button>
        )}
        <button
          type="submit"
          disabled={action.busy || missing.length > 0}
          title={missing.length ? `Missing: ${missing.join(", ")}` : undefined}
          className="h-12 flex-1 rounded-2xl bg-brand text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {action.busy
            ? fixId
              ? "Saving…"
              : "Placing…"
            : management
              ? "Save the changes"
              : fixId
                ? "Send to Management"
                : papPatient
                  ? "Start a PAP case"
                  : handsToPap
                    ? "Hand to PAP"
                    : "Place order"}
        </button>
      </div>

      {confirming && (
        // The hub's Confirm window: what goes, before it goes. A medicine short on the shelf asks
        // "why are you proceeding?" (Management and Dispatch read the answer).
        <Dialog
          title={fixId ? "Send it to Management again?" : "Place this order?"}
          sub={picked?.name}
          onClose={() => setConfirming(false)}
          busy={action.busy}
        >
          <div className="flex flex-col gap-3 text-[13px]">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              {(
                [
                  ["Customer", picked ? `${picked.name}${kindLabel ? ` · ${kindLabel}` : ""}` : ""],
                  ["Division", [pickedDivision, pickedSubDivision].filter(Boolean).join(" · ")],
                  ["Pays", paymentTerm || terms],
                  ["Source", source],
                  ["Date needed", expectedOn ? dayLabel(expectedOn) : ""],
                  ["Deliver to", address],
                  ["Invoicing from", COMPANIES[invoiceFrom].name],
                  [
                    "Documents",
                    [
                      ...Object.entries(papers)
                        .filter(([, file]) => file)
                        .map(([kind]) => PAPERS.find((paper) => paper.kind === kind)?.label ?? kind),
                      ...(proofMissing && noProof && !papers.payment_proof
                        ? [`no proof: ${NO_PROOF_REASONS.find((one) => one.value === noProof)?.label}`]
                        : []),
                    ].join(", ") || "None",
                  ],
                ] as const
              ).map(([label, value]) => (
                <Fragment key={label}>
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="text-ink">{value || "—"}</dd>
                </Fragment>
              ))}
            </dl>
            <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
              {lines.filter((line) => !(line.free && offerTakes(line.medicineId))).map((line) => {
                const row = byId.get(line.medicineId);
                return (
                  <li key={line.key} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                    <span className="min-w-0 truncate">
                      {[row?.name, row?.strength].filter(Boolean).join(" ")} × {count(line.qty)}
                      {line.free ? " (free)" : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">{peso(line.qty * eachOf(line))}</span>
                    {offerFree(line) > 0 && (
                      <span className="basis-full text-xs text-good">
                        + {count(offerFree(line))} free ({offerTakes(line.medicineId)?.name})
                      </span>
                    )}
                  </li>
                );
              })}
              <li className="flex justify-between px-3 py-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{peso(total)}</span>
              </li>
            </ul>
            {shortLines.length > 0 && (
              <label className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <span className="font-semibold text-amber-900">
                  Short on the shelf:{" "}
                  {shortLines
                    .map((line) => [byId.get(line.medicineId)?.name, byId.get(line.medicineId)?.strength].filter(Boolean).join(" "))
                    .join(", ")}
                  . Why are you proceeding?
                </span>
                <textarea
                  rows={2}
                  value={stockReason}
                  onChange={(event) => setStockReason(event.target.value)}
                  className={`${FIELD} h-auto py-2`}
                  placeholder="e.g. The hospital waits for the next delivery"
                  autoFocus
                />
                <span className="text-[11px] text-amber-800">Management and Dispatch read it.</span>
              </label>
            )}
            <div className="text-ink-2">
              Management checks it first, then Finance and Dispatch. You are told at each step.
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={action.busy}
                className="h-10 rounded-lg px-4 text-sm font-semibold text-ink-2 hover:bg-slate-100"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => void place()}
                disabled={action.busy || (shortLines.length > 0 && !stockReason.trim())}
                className="h-10 rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {action.busy ? "Placing…" : fixId ? "Send to Management" : "Confirm and place"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

    </form>
      {/* Outside the order's own form: a form inside a form sent the page away when "Add doctor"
          was pressed, and the customer was never saved (found walking TeleSales, 23 Nov). */}
      {adding && customers.data && (
        <CustomerDialog
          can={customers.data.can}
          kinds={customers.data.kinds}
          // A new customer starts as the Division's usual buyer (a hospital for HOS, a drugstore for B2B).
          kind={(divisionKinds?.[0] as CustomerKind | undefined) ?? undefined}
          onClose={() => setAdding(false)}
          onSaved={(id) => setCustomerId(id)}
          onPick={(id) => setCustomerId(id)}
        />
      )}
    </>
  );
}

/** A seller's guarantee-letter patient goes to PAP: who, which agency, what they need. PAP sends
 *  the three quotations and gets the letter; the order it places counts for the seller. */
function HandToPapDialog({
  name: firstName,
  phone: firstPhone,
  city,
  address,
  onClose,
  onDone,
}: {
  name: string;
  phone: string;
  city: string;
  address: string;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const action = useAction();
  const [name, setName] = useState(firstName);
  const [phone, setPhone] = useState(firstPhone);
  const [agency, setAgency] = useState("");
  const [request, setRequest] = useState("");
  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
  const label = "mb-1 block text-xs font-semibold text-slate-600";
  return (
    <Dialog title="Hand the patient to PAP" sub="PAP gets the quotations and the guarantee letter. The sale stays yours." onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <label>
          <span className={label}>Patient *</span>
          <input className={field} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span className={label}>Phone</span>
          <input className={field} value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" />
        </label>
        <label>
          <span className={label}>Agency that gives the letter *</span>
          <select className={field} value={agency} onChange={(event) => setAgency(event.target.value)}>
            <option value="">Pick one</option>
            {AGENCIES.map((one) => (
              <option key={one.key} value={one.key}>
                {one.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>Medicines and how many</span>
          <textarea className={field} rows={3} value={request} onChange={(event) => setRequest(event.target.value)} />
        </label>
        {action.problem && <p className="text-sm text-rose-700">{action.problem.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={action.busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button
            type="button"
            disabled={action.busy || !name.trim() || !agency}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>("/api/leads/hand-to-pap", {
                  body: { name: name.trim(), phone: phone.trim() || null, agency, request: request.trim() || null, city: city || null, address: address || null },
                });
                onDone(made.id);
              })
            }
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {action.busy ? "Handing over…" : "Hand to PAP"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
