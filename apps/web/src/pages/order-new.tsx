// A new order, as designed on the canvas (artboard "NewOrder") in the old CRM's look: who it is
// for, the medicines (search to add one; its stock by warehouse and what is coming; tap the
// price being given; a lower price says how much and why), payment and address, a note, the
// total, and what Management will see. A MedRep's order is always his own; Dispatch decides how
// it goes out.

import { DIVISIONS, PAYMENT_TERMS, SUB_DIVISIONS, subDivisionOfArea } from "@2mg/api/divisions";
import { formatPhone } from "@2mg/api/phone";
import type {
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
  FileCheck2,
  MapPin,
  Minus,
  Plus,
  Search,
  TriangleAlert,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { shortPeso } from "../ceo";
import { CustomerDialog } from "../customers/dialog";
import { NO_PROOF_REASONS } from "../finance/no-proof";
import { MedicineRequestDialog } from "../inventory/requests";
import { avatarTone, initials } from "../look";
import { OrderChecksBox } from "../orders/parts";
import { PAPER_ACCEPT, uploadPaper } from "../photo";
import { count, dayLabel, inPacks, PageState, peso, timeLabel, useAction } from "../ui";

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
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none";
const FIELD_LABEL = "text-xs font-semibold text-slate-600";

/** A step of the form, headed as the case's steps: a number tile and the step's name. */
function StepHead({
  number,
  title,
  aside,
}: {
  number: number;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700">
        {number}
      </span>
      <h2 className="min-w-0 flex-1 text-sm font-bold text-slate-900">{title}</h2>
      {aside}
    </div>
  );
}

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
};

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
  paymentTerm?: string;
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

  const [lines, setLines] = useState<Line[]>([]);
  const [findMedicine, setFindMedicine] = useState("");
  const [askingMedicine, setAskingMedicine] = useState(false);
  const [address, setAddress] = useState("");
  const [receiver, setReceiver] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const [customerPo, setCustomerPo] = useState("");
  const [note, setNote] = useState("");
  const [invoiceFrom, setInvoiceFrom] = useState<InvoiceFrom>("2mg");
  const [doctor, setDoctor] = useState<{ id: number; name: string } | null>(null);
  const [findDoctor, setFindDoctor] = useState("");
  const [papers, setPapers] = useState<Partial<Record<PaperKind, File>>>({});
  // An order through a hospital or a doctor for one patient (Aryan): its prescription and the
  // patient's ID go with it, and Management checks them as on a patient's own order.
  const [patientOrder, setPatientOrder] = useState(false);
  const [patientName, setPatientName] = useState("");
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
  const fieldRole = me ? ["medrep", "team_lead", "manager"].includes(me.role) : true;
  // The hub's Division, Sub-division and the Payment Terms agreed with the customer.
  const [division, setDivision] = useState<string | null>(null);
  const [subDivision, setSubDivision] = useState<string | null>(null);
  const [paymentTerm, setPaymentTerm] = useState("");
  // A lead ordering in a MedRep's name books it under that MedRep's channel and area.
  const forRep = forWhom.data?.can
    ? forWhom.data.medreps.find((rep) => rep.id === medrepId)
    : undefined;
  // The channel's own Division (the Admin panel sets it), the MedRep's whose order it is.
  const pickedDivision = division ?? (forRep ? forRep.division : me?.channel?.division) ?? "";
  const pickedSubDivision =
    subDivision ??
    (pickedDivision
      ? subDivisionOfArea(pickedDivision, forRep ? forRep.area : me?.area?.name)
      : "");
  const [toFinance, setToFinance] = useState(false);
  const doctors = useQuery({
    queryKey: ["customers", "doctors", findDoctor.trim()],
    queryFn: () =>
      api<CustomerList>(`/api/customers?kind=doctor&q=${encodeURIComponent(findDoctor.trim())}`),
    enabled: !doctor && findDoctor.trim().length >= 1,
  });

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
    if (draft.paymentTerm !== undefined) setPaymentTerm(draft.paymentTerm);
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
        lower: !item.free && item.unitPrice !== item.listPrice,
        given:
          !item.free && item.unitPrice !== item.listPrice ? (item.unitPrice / 100).toFixed(2) : "",
        reason: item.reason ?? "",
        free: item.free,
      })),
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
    setPatientOrder(order.patientOrder);
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
      paymentTerm,
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
  }, [picked]);

  const medicines = catalogue.data?.rows ?? [];
  const byId = useMemo(() => new Map(medicines.map((row) => [row.id, row])), [medicines]);
  const stockOf = (id: number) => stock.data?.medicines.find((row) => row.id === id);
  const pricesOf = (row: CatalogueRow) => {
    const usual = picked ? USUAL[picked.kind] : "";
    const options = [
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
        Number(b.kind === usual) - Number(a.kind === usual) ||
        Number(b.kind === "promo") - Number(a.kind === "promo"),
    );
  };
  const listOf = (line: Line) => {
    const row = byId.get(line.medicineId);
    return row ? (pricesOf(row).find((option) => option.kind === line.priceKind)?.amount ?? 0) : 0;
  };
  const eachOf = (line: Line) =>
    line.free ? 0 : line.lower && line.given.trim() ? centavos(line.given) : listOf(line);
  const change = (key: number, changes: Partial<Line>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...changes } : line)));

  const found =
    findMedicine.trim().length >= 1
      ? medicines
          .filter((row) => !lines.some((line) => line.medicineId === row.id))
          .filter((row) =>
            [row.name, row.generic, row.sku, row.code]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(findMedicine.trim().toLowerCase()),
          )
          .slice(0, 8)
      : [];
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
    if (line.lower && eachOf(line) < listOf(line))
      warnings.push(`${name} is ${peso(listOf(line) - eachOf(line))} below the price, each`);
  }
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

  const proofMissing = picked?.paymentTerms === "advance" && !papers.payment_proof;
  const forPatient = picked?.kind === "patient" || patientOrder;
  // A PAP MedRep's patient is paid by a guarantee letter: that starts as a PAP case, where the
  // quotation, the application, the letter and the claim are tracked.
  const papPatient =
    me?.role === "medrep" && me.channel?.code === "PAP" && picked?.kind === "patient";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (papPatient && !fixId) {
      navigate("/pap?new=1");
      return;
    }
    if (proofMissing && (!noProof || (noProof === "other" && !noProofNote.trim()))) {
      setNoProofAsk(true);
      document.getElementById("no-proof")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    let id = 0;
    const body: OrderInput = {
      customerId: customerId ?? 0,
      ...(forWhom.data?.can ? { medrepId } : {}),
      items: lines.map((line) => ({
        medicineId: line.medicineId,
        qty: line.qty,
        priceKind: line.priceKind,
        unitPrice: eachOf(line),
        reason: line.free ? line.reason || "Free" : line.lower ? line.reason : null,
        free: Boolean(line.free),
      })),
      deliveryAddress: address,
      receiver,
      receiverPhone,
      expectedOn: expectedOn || null,
      customerPo,
      note,
      invoiceFrom,
      doctorId: doctor?.id ?? null,
      // The field sends no choice: Management checks it and decides about Finance on approving.
      ...(fieldRole ? {} : { checks: { management: toManagement, finance: toFinance } }),
      division: pickedDivision || null,
      subDivision: pickedSubDivision || null,
      paymentTerm: paymentTerm.trim() || null,
      patientOrder: picked?.kind !== "patient" && patientOrder,
      patientName: picked?.kind !== "patient" && patientOrder ? patientName.trim() || null : null,
      noProofReason: proofMissing && noProof ? noProof : null,
      noProofNote: proofMissing && noProof ? noProofNote.trim() || null : null,
    };
    const done = await action.run(async () => {
      if (fixId) {
        await api(`/api/orders/${fixId}/${management ? "change" : "revise"}`, {
          body: { ...body, answer },
        });
        id = fixId;
      } else id = (await api<{ id: number }>("/api/orders", { body })).id;
    });
    if (!done) return;
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
      ? `${picked.paymentDays} days after the invoice`
      : picked.paymentTerms === "cod"
        ? "Cash on delivery"
        : "Pays in advance"
    : "";
  const lineError = (index: number, name: string) => action.at(`items.${index}.${name}`);

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-3xl flex-col gap-5 pb-4">
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
        <h1 className="flex-1 text-2xl font-bold tracking-tight text-ink">
          {sentBack
            ? `Fix order ${sentBack.code}`
            : changing
              ? `Change order ${changing.code}`
              : "New order"}
        </h1>
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

      {/* Who checks the order is Management's call: the field (a MedRep, a team lead) only
          places it, so only the office sees the switch. */}
      {!fieldRole && !changing && (
        <OrderChecksBox
          reasons={checkReasons}
          management={toManagement}
          onManagement={setToManagement}
          finance={toFinance}
          onFinance={setToFinance}
        />
      )}

      {me?.role === "medrep" && (
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-700 shadow-2xs">
          <MapPin className="size-4 shrink-0" />
          <span>
            <span className="font-semibold">
              {[me.name, me.channel?.code, me.area?.name].filter(Boolean).join(" · ")}
            </span>{" "}
            · your order, your area
          </span>
        </div>
      )}

      {/* 1 · Customer */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <StepHead number={1} title="Customer" />
        </div>
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
            </div>
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
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              {(findCustomer.trim()
                ? (customers.data?.rows ?? []).slice(0, 12)
                : [...(customers.data?.rows ?? [])]
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
              {customers.data && findCustomer.trim() && customers.data.rows.length === 0 && (
                <li className="px-3.5 py-3 text-xs text-slate-500">
                  No customer matches: add them as a New customer above.
                </li>
              )}
              {customers.data &&
                !findCustomer.trim() &&
                !customers.data.rows.some((row) => row.lastOrderAt) && (
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
      </section>

      {/* 2 · Division and payment terms: what the field fills in, as the hub's order form asks it.
          Management completes the rest when it checks the order. */}
      <section className="flex flex-col gap-2">
        <StepHead number={2} title="Division and payment terms" />
        <div className={`${BOX} flex flex-col gap-3`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Division</span>
              <select
                value={pickedDivision}
                onChange={(event) => {
                  setDivision(event.target.value);
                  setSubDivision("");
                }}
                className={FIELD}
              >
                <option value="">-- Not set --</option>
                {DIVISIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Sub-division</span>
              {(SUB_DIVISIONS[pickedDivision] ?? []).length > 0 ? (
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
          </div>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Payment terms agreed with the customer</span>
            <select
              value={paymentTerm}
              onChange={(event) => setPaymentTerm(event.target.value)}
              className={FIELD}
            >
              <option value="">
                {picked ? `The customer's usual: ${terms}` : "-- Not set --"}
              </option>
              {PAYMENT_TERMS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {paymentTerm &&
                !PAYMENT_TERMS.includes(paymentTerm as (typeof PAYMENT_TERMS)[number]) && (
                  <option value={paymentTerm}>{paymentTerm}</option>
                )}
            </select>
          </label>
        </div>
      </section>

      {/* 3 · Medicines */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <StepHead number={3} title="Medicines" />
          {picked && (
            <span className="text-[11px] text-slate-500">
              {catalogue.data.buyerTypes.find((type) => type.key === USUAL[picked.kind])?.label}{" "}
              prices first
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input
            aria-label="Add a medicine"
            placeholder="Search a medicine to add"
            value={findMedicine}
            onChange={(event) => setFindMedicine(event.target.value)}
            className={`${FIELD} pl-9`}
          />
          {found.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
              {found.map((row) => (
                <li key={row.id} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => addMedicine(row)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">
                        {[row.name, row.strength].filter(Boolean).join(" ")}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {[row.generic, row.pack, row.sku].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold ${row.free > 0 ? "text-emerald-700" : "text-rose-700"}`}
                    >
                      {row.free > 0
                        ? `${count(row.free)} free`
                        : row.total > 0
                          ? "All promised"
                          : "Out of stock"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {findMedicine.trim().length >= 2 && found.length === 0 && catalogue.data && (
            // Not in our list: ask Inventory for it, so it can be bought in (the order waits).
            <div className="absolute inset-x-0 top-full z-10 mt-1 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-pop">
              <span className="text-[13px] text-slate-600">
                "{findMedicine.trim()}" isn't in our list.
              </span>
              <button
                type="button"
                onClick={() => setAskingMedicine(true)}
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
              >
                Ask Inventory for it
              </button>
            </div>
          )}
        </div>
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
        {action.at("items") && <div className="text-xs text-rose-700">{action.at("items")}</div>}
        {lines.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500">
            Search a medicine above to add it.
          </div>
        )}
        {lines.map((line, index) => {
          const row = byId.get(line.medicineId);
          if (!row) return null;
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
          const places = (stock.data?.warehouses ?? [])
            .map((place) => ({
              name: place.name.replace(/ warehouse$/i, ""),
              qty: held?.stock[place.id] ?? 0,
            }))
            .filter((place) => place.qty > 0);
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
                  <div
                    className={`text-[11px] font-semibold ${short ? "text-amber-700" : "text-emerald-700"}`}
                  >
                    {short
                      ? `Free ${count(row.free)} of ${count(row.total)} on the shelf · short by ${count(line.qty - row.free)}`
                      : `Free ${count(row.free)}${row.promised ? ` (${count(row.promised)} promised)` : ""}${places.length ? ` · ${places.map((place) => `${place.name} ${count(place.qty)}`).join(", ")}` : ""}`}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {held?.coming
                      ? `${count(held.coming.qty)} more arrive ${dayLabel(held.coming.on)}`
                      : held?.nearestExpiry
                        ? `Nearest expiry ${monthYear(held.nearestExpiry)}`
                        : ""}
                  </div>
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

              {line.lower ? (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-900">
                      Giving a lower price than{" "}
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
                    <span className="text-[11px] text-amber-900">You gave it at (₱ each)</span>
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
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => change(line.key, { lower: true, given: String(list / 100) })}
                    className="self-start text-xs font-medium text-emerald-700 hover:underline"
                  >
                    Give a lower price
                  </button>
                  {!lines.some((other) => other.free && other.medicineId === line.medicineId) && (
                    <button
                      type="button"
                      onClick={() => addFree(line)}
                      className="self-start text-xs font-medium text-emerald-700 hover:underline"
                    >
                      + Free (Buy 1 Take 1)
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* 4 · Delivery and address */}
      <section className="flex flex-col gap-2">
        <StepHead number={4} title="Delivery and address" />
        <div className={`${BOX} flex flex-col gap-3`}>
          <datalist id="promo-kinds">
            {["Buy 1 Take 1", "Buy 2 Take 1", "Buy 10 Take 1", "Sample", "Promo"].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Customer needs it by</span>
            <input
              type="date"
              value={expectedOn}
              onChange={(event) => setExpectedOn(event.target.value)}
              className={FIELD}
            />
            {action.at("expectedOn") && (
              <span className="text-xs text-rose-700">{action.at("expectedOn")}</span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Deliver to</span>
            <textarea
              rows={2}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={FIELD}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Receiver</span>
              <input
                value={receiver}
                onChange={(event) => setReceiver(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Receiver's number</span>
              <input
                type="tel"
                value={receiverPhone}
                onChange={(event) => setReceiverPhone(event.target.value)}
                onBlur={(event) => setReceiverPhone(formatPhone(event.target.value) ?? "")}
                className={FIELD}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>
                {picked?.kind === "hospital"
                  ? "Hospital PO number"
                  : "Customer's PO number (if any)"}
              </span>
              <input
                value={customerPo}
                onChange={(event) => setCustomerPo(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Invoice from</span>
              <select
                value={invoiceFrom}
                onChange={(event) => setInvoiceFrom(event.target.value as InvoiceFrom)}
                className={FIELD}
              >
                <option value="2mg">2MG Inc.</option>
                <option value="getmeds">GetMeds Philippines Inc.</option>
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Doctor (if any)</span>
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
        </div>
      </section>

      {/* 4 · Papers */}
      <section className="flex flex-col gap-2">
        <StepHead number={5} title="Papers" />
        {picked && picked.kind !== "patient" && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-[13px] font-semibold text-slate-900">
              Is this order for one patient?
            </span>
            <span className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
              {[
                { on: false, label: "No" },
                { on: true, label: "Yes, a patient" },
              ].map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  aria-pressed={patientOrder === choice.on}
                  onClick={() => setPatientOrder(choice.on)}
                  className={`rounded-md px-3 py-1.5 ${patientOrder === choice.on ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
                >
                  {choice.label}
                </button>
              ))}
            </span>
            {patientOrder && (
              <input
                aria-label="The patient's name"
                value={patientName}
                onChange={(event) => setPatientName(event.target.value)}
                placeholder="The patient's name"
                className={`${FIELD} min-w-48 flex-1`}
              />
            )}
            {patientOrder && (
              <span className="w-full text-[11px] text-slate-500">
                Add the prescription and the patient's ID below: Management checks them.
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
          {[...PAPERS]
            .sort((a, b) => paperRank(a.kind, forPatient) - paperRank(b.kind, forPatient))
            .filter((paper) =>
              forPatient
                ? !paper.business || paper.kind === "po"
                : !paper.patient || paper.kind === "prescription",
            )
            .map((paper) => {
              const file = papers[paper.kind];
              const notNeeded =
                paper.kind === "payment_proof" && picked && picked.paymentTerms !== "advance"
                  ? picked.paymentTerms === "cod"
                    ? "Not needed · pays on delivery"
                    : `Not needed · pays in ${picked.paymentDays} days`
                  : null;
              return (
                <div
                  key={paper.kind}
                  className="flex min-h-13 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] text-slate-900">{paper.label}</div>
                    {paper.kind === "payment_proof" &&
                      picked?.paymentTerms === "advance" &&
                      !file && (
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
                            <option value="">No slip yet? Say why…</option>
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
                  ) : notNeeded ? (
                    <span className="text-xs text-slate-500">{notNeeded}</span>
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
      </section>

      {/* 4 · Note */}
      <section className="flex flex-col gap-2">
        <label htmlFor="order-note" className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700">
            6
          </span>
          <span className="text-sm font-bold text-slate-900">Note for Management</span>
        </label>
        <textarea
          id="order-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={FIELD}
          placeholder="Anything they should know"
        />
      </section>

      {lines.length > 0 && (
        <div className={`${BOX} flex flex-col gap-1.5 text-[13px]`}>
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

      {picked && lines.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <div className="font-semibold">
            Your part ends here. Management, Finance and Dispatch do the rest.
          </div>
          {warnings.length > 0 ? (
            warnings.map((warning) => (
              <div key={warning} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{warning}. Management sees this.</span>
              </div>
            ))
          ) : (
            <div className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0" />
              <span>Nothing for Management to question.</span>
            </div>
          )}
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

      <div className="sticky bottom-16 z-10 -mx-4 flex items-center gap-4 border-t border-slate-200 bg-white px-4 py-3 md:bottom-0 md:mx-0 md:rounded-2xl md:border md:shadow-sm">
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-500">Total</span>
          <span className="text-xl font-bold tracking-tight tabular-nums">{peso(total)}</span>
        </div>
        <button
          type="submit"
          disabled={action.busy}
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
                : "Place order"}
        </button>
      </div>

      {adding && customers.data && (
        <CustomerDialog
          can={customers.data.can}
          kinds={customers.data.kinds}
          onClose={() => setAdding(false)}
          onSaved={(id) => setCustomerId(id)}
          onPick={(id) => setCustomerId(id)}
        />
      )}
    </form>
  );
}
