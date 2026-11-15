// One enquiry's case, as the old CRM's case page: who is asking at the top (phone, email,
// address, how they pay, who works it), the branching journey chart, then the steps on the left
// (Rx & documents, Enquiry & quotation with the GL application and letter, Order & delivery,
// Payment & follow-up), the step being worked in the middle, and the money and the activity
// under the steps. The step open is in the address (?step=).

import type {
  Catalogue,
  CatalogueRow,
  LeadCase,
  LeadInput,
  LeadPaper,
  QuoteLine,
  Vat,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  CircleCheck,
  ClipboardList,
  ExternalLink,
  FileCheck2,
  FileText,
  Gift,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Truck,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import { RecordPaymentDialog } from "../finance/parts";
import { avatarTone, initials } from "../look";
import { CustomerOrdersBar, RoadPicker, useCaseDetails } from "../online/case-head";
import { ChatPanel } from "../online/chat";
import { LeadJourney } from "../online/journey";
import { AGENCIES, LeadForm, RELATIONS, uploadLeadFile } from "../online/parts";
import { WebsiteOrderCard } from "../online/website";
import { OrderChecksBox } from "../orders/parts";
import { SendToCustomer } from "../orders/send-update";
import { PAPER_ACCEPT } from "../photo";
import {
  Button,
  count,
  Dialog,
  dayLabel,
  Field,
  INPUT,
  PageState,
  Pill,
  Problem,
  peso,
  timeLabel,
  useAction,
} from "../ui";

type StepKey = "docs" | "quote" | "apply" | "letter" | "order" | "pay";

/** The step a case opens on, from where it stands. */
function openingStep(step: string, gl: boolean): StepKey {
  if (["new", "rx_wait", "rx_check", "papers"].includes(step)) return "docs";
  if (step === "rx_ok" || step === "quoted") return "quote";
  if (gl && step === "apply") return "apply";
  if (gl && (step === "waiting" || step === "verify")) return "letter";
  if (step === "ready" || step === "ordered") return "order";
  return "pay";
}

const SENT_VIA = [
  { key: "messenger", label: "Messenger" },
  { key: "viber", label: "Viber" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "sms", label: "SMS" },
  { key: "email", label: "Email" },
  { key: "printed", label: "Printed" },
];
const VIA_LABEL: Record<string, string> = Object.fromEntries(
  SENT_VIA.map((item) => [item.key, item.label]),
);

/** A senior's or PWD's price of a piece: VAT out of a 12% medicine, then 20% off (the law). */
const reliefPrice = (price: number, vat: Vat) =>
  Math.round((vat === "vat12" ? price / 1.12 : price) * 0.8);

/** The same sums the API makes, for the lines being typed. */
function totalsOf(lines: { qty: number; unitPrice: number; vat: Vat }[], road: string) {
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
  if (road !== "senior" && road !== "pwd") return { subtotal, relief: null, total: subtotal };
  const net = lines.reduce(
    (sum, line) =>
      sum + line.qty * (line.vat === "vat12" ? Math.round(line.unitPrice / 1.12) : line.unitPrice),
    0,
  );
  const total = lines.reduce(
    (sum, line) => sum + line.qty * reliefPrice(line.unitPrice, line.vat),
    0,
  );
  return { subtotal, relief: { vatRemoved: subtotal - net, discount: net - total }, total };
}

/** Writes on the case: busy, the refusal, and the case read again after. */
function useCaseWrite(id: number) {
  const queries = useQueryClient();
  const action = useAction();
  async function send(path: string, body: unknown = {}): Promise<boolean> {
    const done = await action.run(async () => {
      await api(path, { body });
    });
    if (done) await queries.invalidateQueries({ queryKey: ["leads"] });
    return done;
  }
  async function refresh() {
    await queries.invalidateQueries({ queryKey: ["leads"] });
  }
  return { ...action, send, refresh, id };
}

export function LeadPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["leads", "case", id],
    queryFn: () => api<LeadCase>(`/api/leads/${id}`),
  });
  // Case details is open (on its email field from "Add email").
  const [editing, setEditing] = useState<null | "all" | "email">(null);
  const [closing, setClosing] = useState(false);
  // The conversation opens on purpose, as a panel down the right (the whole screen on a phone).
  const [chatOpen, setChatOpen] = useState(false);
  const write = useCaseWrite(id);
  const data = query.data;
  const details = useCaseDetails(data);
  if (!data) return <PageState query={query} what="the case" />;

  const { lead } = data;
  const gl = lead.road === "gl";
  const lost = lead.state === "lost";
  const step = (params.get("step") as StepKey | null) ?? openingStep(data.step.value, gl);
  const open = (key: StepKey) => {
    const next = new URLSearchParams(params);
    next.set("step", key);
    setParams(next, { replace: true });
  };
  const intake = data.papers.filter((paper) => paper.needed && paper.kind !== "gl_letter");
  const quoteSaved = data.quote.lines.length > 0 && !data.quote.stale;
  const orderLive = data.order && data.order.status !== "cancelled" ? data.order : null;
  const done: Record<StepKey, boolean> = {
    docs: intake.length > 0 ? intake.every((paper) => paper.files.length > 0) : quoteSaved,
    quote: quoteSaved,
    apply: Boolean(lead.glAppliedOn),
    letter: Boolean(lead.glVerifiedAt),
    order: orderLive?.status === "completed",
    pay: data.step.value === "done",
  };
  const rail: { key: StepKey; number: string; label: string; sub?: boolean }[] = [
    { key: "docs", number: "1", label: "Rx & documents" },
    { key: "quote", number: "2", label: "Enquiry & quotation" },
    ...(gl
      ? [
          { key: "apply" as const, number: "2.1", label: "Agency application", sub: true },
          { key: "letter" as const, number: "2.2", label: "Guarantee letter", sub: true },
        ]
      : []),
    { key: "order", number: "3", label: "Order & delivery" },
    { key: "pay", number: "4", label: gl ? "Claim & payment" : "Payment & follow-up" },
  ];
  const roadLock = orderLive ? "Locked: the order is placed with this road." : null;
  const files = data.journey.approved.map((kind) => ({
    id: kind,
    name: kind,
    kind,
    status: "approved",
  }));

  const STEP_ICONS: Record<StepKey, typeof FileCheck2> = {
    docs: FileCheck2,
    quote: Calculator,
    apply: FileCheck2,
    letter: FileCheck2,
    order: Truck,
    pay: CircleCheck,
  };
  const mainRail = rail.filter((item) => !item.sub);
  const subsOf = (key: StepKey) => (gl && key === "quote" ? rail.filter((item) => item.sub) : []);
  const caseType =
    lead.caseType === "website_order"
      ? { label: "Website order", style: "border-teal-200 bg-teal-50 text-teal-800" }
      : { label: "Enquiry", style: "border-sky-200 bg-sky-50 text-sky-800" };
  const detailsMissing = !lead.phone || !(lead.city || lead.address);
  const intakeAt = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(lead.firstContactAt));
  const channel = [lead.sourceLabel, lead.chatAccount].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4">
      <nav aria-label="Where you are" className="flex items-center gap-1.5 text-xs text-slate-500">
        <Link
          to="/leads"
          className="inline-flex items-center gap-1 font-medium hover:text-slate-800"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <Link to="/leads" className="hover:text-slate-800">
          Leads &amp; enquiries
        </Link>
        <span aria-hidden="true" className="text-slate-300">
          ›
        </span>
        <span className="font-medium text-slate-700">Details</span>
      </nav>

      {/* 1. The case's head: who it is, the payment road, and the patient's road under it. */}
      <header
        className={`rounded-2xl border p-4.5 shadow-2xs ${lost ? "border-rose-200 bg-rose-50/60" : "border-slate-200/90 bg-white"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold shadow-2xs ${avatarTone(lead.name)}`}
            >
              {initials(lead.name)}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1
                  title={lead.name}
                  className="max-w-[240px] truncate text-lg font-bold tracking-tight text-slate-900 sm:max-w-md md:text-xl"
                >
                  {lead.name}
                </h1>
                <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700">
                  {lead.code}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${caseType.style}`}
                >
                  {caseType.label}
                </span>
                {channel && (
                  <span
                    title={`Came in through ${channel}`}
                    className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium tracking-wide text-slate-600 uppercase"
                  >
                    {channel}
                  </span>
                )}
                {lost ? (
                  <span className="inline-flex shrink-0 items-center rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                    Lost
                  </span>
                ) : (
                  <span
                    className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                      data.step.value === "done"
                        ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                        : "bg-white text-slate-600 ring-slate-200"
                    }`}
                  >
                    {data.step.label}
                  </span>
                )}
                {data.can.work && (
                  <button
                    type="button"
                    onClick={() => setEditing("all")}
                    aria-haspopup="dialog"
                    title="Who, the patient, phone, address and how they pay, in one place"
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 transition ${
                      detailsMissing
                        ? "bg-amber-50 text-amber-900 ring-amber-300 hover:bg-amber-100"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <ClipboardList className="size-3.5" />
                    Case details
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="shrink-0 text-slate-400">Intake {intakeAt}</span>
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-slate-400" />
                  <span className="text-slate-400">Owner</span>
                  {data.can.work && data.agents.length > 0 ? (
                    <select
                      aria-label="Case owner"
                      value={lead.assignedTo ?? ""}
                      disabled={details.busy}
                      onChange={(event) =>
                        void details.save({
                          assignedTo: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                      className="h-7 min-h-0 max-w-44 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 disabled:opacity-60"
                    >
                      <option value="">Unassigned</option>
                      {data.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-medium text-slate-700">
                      {lead.assignedName ?? "Unassigned"}
                    </span>
                  )}
                </span>
                {details.error && (
                  <span role="alert" className="text-[11px] font-medium text-rose-600">
                    {details.error}
                  </span>
                )}
              </div>
              {lead.patientName && lead.patientName !== lead.name && (
                <p className="mt-1 truncate text-xs text-slate-600">
                  Patient <span className="font-semibold text-slate-800">{lead.patientName}</span>
                  {lead.relation && lead.relation !== "self" && (
                    <span className="text-slate-400">
                      {" "}
                      · {lead.name} is their{" "}
                      {(
                        RELATIONS.find((item) => item.key === lead.relation)?.label ?? lead.relation
                      ).toLowerCase()}
                    </span>
                  )}
                </p>
              )}
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-1 font-medium text-slate-800 hover:text-emerald-700"
                  >
                    <Phone className="size-3.5 text-slate-400" />
                    {lead.phone}
                  </a>
                )}
                {lead.email ? (
                  <a
                    href={`mailto:${lead.email}`}
                    className="inline-flex min-w-0 items-center gap-1 hover:text-emerald-700"
                  >
                    <Mail className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{lead.email}</span>
                  </a>
                ) : (
                  data.can.work && (
                    <button
                      type="button"
                      onClick={() => setEditing("email")}
                      className="inline-flex items-center gap-1 font-medium text-emerald-800 hover:underline"
                    >
                      <Mail className="size-3.5 shrink-0 text-slate-400" />
                      Add email
                    </button>
                  )
                )}
                {(lead.address || lead.city) && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <MapPin className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">
                      {[lead.address, lead.city].filter(Boolean).join(", ")}
                    </span>
                  </span>
                )}
                {data.can.work && (
                  <button
                    type="button"
                    onClick={() => setEditing("all")}
                    aria-haspopup="dialog"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    <Pencil className="size-3" />
                    {lead.phone || lead.city ? "Edit details" : "Add phone & city"}
                  </button>
                )}
              </div>
              {!lost && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-slate-700">
                  <ArrowRight className="mt-px size-3.5 shrink-0 text-emerald-600" />
                  {data.next}
                </p>
              )}
            </div>
          </div>

          {/* The payment road: always shown; locked (greyed) once the order is placed. */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 sm:w-auto">
            <RoadPicker data={data} locked={roadLock} canChange={data.can.work} />
          </div>
        </div>
        {lost && lead.lostReason && (
          <div className="mt-3 text-xs font-medium text-rose-700">Lost: {lead.lostReason}</div>
        )}
        <Problem message={write.problem?.message} />
        <LeadJourney
          lead={data.journey.lead}
          rx={data.journey.rx}
          gl={data.journey.gl}
          order={data.journey.order}
          files={files}
          channelLabel={lead.sourceLabel}
          onOpenDocuments={() => open("docs")}
          onOpenQuotation={() => open("quote")}
          onOpenAgency={() => open(lead.glAppliedOn ? "letter" : "apply")}
          onOpenDelivery={() => open("order")}
          onOpenClaim={() => open("pay")}
          actions={
            lead.chatChannel ? (
              <button
                type="button"
                aria-expanded={chatOpen}
                onClick={() => setChatOpen((value) => !value)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-2xs transition ${
                  chatOpen
                    ? "bg-sky-700 text-white hover:bg-sky-800"
                    : "border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                }`}
              >
                {lead.chatChannel === "messenger" ? (
                  <MessageCircle className="size-3.5 shrink-0" />
                ) : (
                  <Mail className="size-3.5 shrink-0" />
                )}
                <span>
                  {chatOpen
                    ? "Close chat"
                    : lead.chatChannel === "messenger"
                      ? "Messenger"
                      : "Email"}
                </span>
                {lead.awaitingReply && !chatOpen && (
                  <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-rose-500 ring-2 ring-white">
                    <span className="sr-only">Waiting for a reply</span>
                  </span>
                )}
              </button>
            ) : null
          }
        />
      </header>

      {data.web && <WebsiteOrderCard web={data.web} canWork={data.can.work || lost} />}

      {/* 2. The customer, by their number: their orders on one line, their points beside it. */}
      <CustomerOrdersBar
        data={data}
        aside={
          data.points.program.enabled && (
            <span
              title={data.points.why ?? "1 point = ₱1 off a regular sale"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-900"
            >
              <Gift className="size-3.5" />
              Points{" "}
              <b className="text-sm tabular-nums">{data.points.balance.toLocaleString("en-PH")}</b>
              <span className="text-amber-700">= {peso(data.points.balance * 100)} off</span>
            </span>
          )
        }
      />

      {/* 3. The case in two columns: the steps and the money on the left, the step on the right. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="space-y-3 xl:sticky xl:top-[4.5rem]">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-sm">
            <nav aria-label="Case steps">
              <p className="px-2.5 pt-1 pb-2 text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">
                Steps
              </p>
              {mainRail.map((item, index) => {
                const Icon = STEP_ICONS[item.key];
                const selected = item.key === step;
                const subs = subsOf(item.key);
                return (
                  <div key={item.key} className="relative">
                    {index < mainRail.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={`absolute top-11 bottom-0 left-[22px] w-px ${done[item.key] ? "bg-emerald-300" : "bg-slate-200"}`}
                      />
                    )}
                    <button
                      type="button"
                      aria-current={selected ? "step" : undefined}
                      onClick={() => open(item.key)}
                      className={`group relative flex w-full items-start gap-3 rounded-xl border px-2.5 py-2.5 text-left transition ${
                        selected
                          ? "border-emerald-200 bg-emerald-50/70"
                          : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                          done[item.key]
                            ? "border-emerald-700 bg-emerald-700 text-white"
                            : selected
                              ? "border-emerald-700 bg-white text-emerald-800 ring-4 ring-emerald-100"
                              : "border-slate-300 bg-white text-slate-500"
                        }`}
                      >
                        {done[item.key] ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Icon className="size-3.5" />
                        )}
                      </span>
                      <span
                        className={`min-w-0 flex-1 pt-1 text-sm leading-snug font-semibold ${selected ? "text-emerald-950" : "text-slate-800"}`}
                      >
                        {item.label}
                      </span>
                      {selected && (
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-600" />
                      )}
                    </button>
                    {/* GL road: the agency's sub-steps, each a page of its own. */}
                    {subs.length > 0 && (
                      <div className="ml-[22px] space-y-0.5 border-l border-violet-200 py-1 pl-4">
                        {subs.map((sub) => (
                          <button
                            key={sub.key}
                            type="button"
                            onClick={() => open(sub.key)}
                            aria-current={step === sub.key ? "page" : undefined}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition hover:bg-violet-50 ${
                              step === sub.key ? "bg-violet-50 ring-1 ring-violet-200" : ""
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`grid h-5 min-w-7 shrink-0 place-items-center rounded-full border px-1 text-[10px] font-bold ${
                                done[sub.key]
                                  ? "border-violet-600 bg-violet-600 text-white"
                                  : "border-violet-300 bg-white text-violet-700"
                              }`}
                            >
                              {done[sub.key] ? <Check className="size-2.5" /> : sub.number}
                            </span>
                            <span className={done[sub.key] ? "text-violet-900" : "text-slate-600"}>
                              {sub.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
            {/* The case's own actions, under its steps. */}
            {((data.can.work && !orderLive) || lost) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 px-1 pt-2.5">
                <span className="mr-auto text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                  Case actions
                </span>
                {data.can.work && !orderLive && (
                  <Button small variant="danger" onClick={() => setClosing(true)}>
                    Close as lost
                  </Button>
                )}
                {lost && (
                  <Button
                    small
                    variant="primary"
                    disabled={write.busy}
                    onClick={() => write.send(`/api/leads/${id}/reopen`)}
                  >
                    Reopen
                  </Button>
                )}
              </div>
            )}
          </div>
          <MoneyCard data={data} />
          <Activity data={data} />
        </aside>

        <section className="min-w-0 space-y-4">
          {step === "docs" && <DocumentsStep data={data} onNext={() => open("quote")} />}
          {step === "quote" && (
            <QuotationStep data={data} onNext={() => open(gl ? "apply" : "order")} />
          )}
          {step === "apply" && gl && (
            <GlStep data={data} part="apply" onNext={() => open("letter")} />
          )}
          {step === "letter" && gl && (
            <GlStep data={data} part="letter" onNext={() => open("order")} />
          )}
          {step === "order" && <OrderStep data={data} onNext={() => open("pay")} />}
          {step === "pay" && <PayStep data={data} onBack={() => open("order")} />}
        </section>
      </div>

      {editing && (
        <EditDialog
          data={data}
          lockRoad={roadLock}
          focus={editing === "email" ? "email" : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {closing && <LostDialog id={id} onClose={() => setClosing(false)} />}
      {chatOpen && lead.chatChannel && (
        <ChatDrawer
          leadId={id}
          name={lead.name}
          unread={lead.awaitingReply}
          canWork={data.can.work || lost}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- frames

/** One step of the case in the right-hand column, as the old CRM draws it: an icon tile (or the
 *  GL sub-step's number) and the step's name on a pale band, its work, then its way on. */
const PANEL_ICONS: Record<string, typeof FileCheck2> = {
  "1": FileCheck2,
  "2": Calculator,
  "3": Truck,
  "4": CircleCheck,
};

function StepPanel({
  number,
  title,
  children,
  footer,
}: {
  number: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const Icon = PANEL_ICONS[number];
  const sub = number.includes(".");
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${
            sub ? "bg-violet-50 text-violet-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {Icon ? <Icon className="size-4" /> : number}
        </span>
        <h3 className="min-w-0 text-sm font-bold text-slate-900">{title}</h3>
      </header>
      <div className="space-y-4 p-4 sm:p-5">
        {children}
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
            {footer}
          </div>
        )}
      </div>
    </section>
  );
}

function NextButton({
  label,
  onClick,
  disabled,
  why,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  why?: string | null;
}) {
  return (
    <>
      {disabled && why && <span className="text-xs text-slate-500">{why}</span>}
      <Button variant="primary" small onClick={onClick} disabled={disabled}>
        {label} <ArrowRight className="size-4" />
      </Button>
    </>
  );
}

// ---------------------------------------------------------------- papers

function PaperRow({
  data,
  kind,
  label,
  needed,
  files,
}: {
  data: LeadCase;
  kind: string;
  label: string;
  needed: boolean;
  files: LeadPaper[];
}) {
  const write = useCaseWrite(data.lead.id);
  const [uploading, setUploading] = useState(0);
  const locked = Boolean(data.order && data.order.status !== "cancelled");
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const chosen = [...list];
    await write.run(async () => {
      for (const [index, file] of chosen.entries()) {
        setUploading(index + 1);
        await uploadLeadFile(data.lead.id, kind, file);
      }
    });
    setUploading(0);
    await write.refresh();
  }
  const onFile = files.length > 0;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-800">{label}</span>
          {onFile ? (
            <Pill tone="good">On file</Pill>
          ) : needed ? (
            <Pill tone="warn">Missing</Pill>
          ) : (
            <Pill>Not needed on this road</Pill>
          )}
        </div>
        {data.can.work && (
          <label
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover ${uploading ? "pointer-events-none opacity-60" : ""}`}
          >
            <Upload className="size-3.5" />
            {uploading ? `Uploading ${uploading}…` : onFile ? "Add another" : "Upload"}
            <input
              type="file"
              accept={PAPER_ACCEPT}
              multiple
              className="sr-only"
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2.5">
              <a
                href={`/api/lead-files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
              >
                {file.mime.startsWith("image/") ? (
                  <img
                    src={`/api/lead-files/${file.id}`}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <FileText className="size-4 text-slate-400" />
                )}
              </a>
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/lead-files/${file.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[13px] font-medium text-slate-800 hover:text-emerald-700"
                  title={file.name}
                >
                  {file.name}
                </a>
                <div className="text-[11px] text-slate-500">
                  {file.by} · {timeLabel(file.at)}
                </div>
              </div>
              {data.can.work && !locked && (
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={write.busy}
                  onClick={() => write.send(`/api/lead-files/${file.id}/remove`)}
                  className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Problem message={write.problem?.message} />
    </div>
  );
}

function DocumentsStep({ data, onNext }: { data: LeadCase; onNext: () => void }) {
  const [more, setMore] = useState(false);
  const intake = data.papers.filter((paper) => paper.needed && paper.kind !== "gl_letter");
  const extra = data.papers.filter(
    (paper) => !paper.needed && paper.kind !== "gl_letter" && paper.files.length > 0,
  );
  const rest = data.papers.filter(
    (paper) => !paper.needed && paper.kind !== "gl_letter" && paper.files.length === 0,
  );
  return (
    <StepPanel
      number="1"
      title="Rx & documents"
      footer={<NextButton label="Next: Enquiry & quotation" onClick={onNext} />}
    >
      <div className="flex flex-col gap-2.5">
        {intake.length === 0 && (
          <div className="text-[13px] text-slate-500">
            This road needs no paper before the quotation.
          </div>
        )}
        {intake.map((paper) => (
          <PaperRow
            key={paper.kind}
            data={data}
            kind={paper.kind}
            label={paper.label}
            needed
            files={paper.files}
          />
        ))}
        {extra.map((paper) => (
          <PaperRow
            key={paper.kind}
            data={data}
            kind={paper.kind}
            label={paper.label}
            needed={false}
            files={paper.files}
          />
        ))}
        {data.unsorted.length > 0 && <ChatPhotos data={data} />}
        {data.can.work && rest.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setMore((value) => !value)}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              {more ? "Hide other papers" : "File another paper"}
            </button>
            {more && (
              <div className="mt-2 flex flex-col gap-2.5">
                {rest.map((paper) => (
                  <PaperRow
                    key={paper.kind}
                    data={data}
                    kind={paper.kind}
                    label={paper.label}
                    needed={false}
                    files={[]}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </StepPanel>
  );
}

/** The customer's points on the order: 1 point = ₱1, off the medicines. */
function UsePoints({ data }: { data: LeadCase }) {
  const write = useCaseWrite(data.lead.id);
  const { points } = data;
  const [value, setValue] = useState(points.toUse ? String(points.toUse) : "");
  const most = Math.min(points.balance, Math.floor(data.quote.total / 100));
  if (!points.program.enabled && points.balance <= 0) return null;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px]">
          <span className="font-semibold text-ink">
            Points: {points.balance.toLocaleString("en-PH")}
          </span>
          <span className="text-slate-600">
            {" "}
            · ₱{points.balance.toLocaleString("en-PH")} to use
          </span>
        </div>
        {points.accountId && (
          <Link
            to={`/points/${points.accountId}`}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            History
          </Link>
        )}
      </div>
      {points.why ? (
        <div className="mt-1 text-[12px] text-slate-600">{points.why}</div>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Use on this order" error={write.at("points")}>
            {(field) => (
              <input
                {...field}
                className={`${INPUT} w-28`}
                inputMode="numeric"
                placeholder="0"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
          <Button small onClick={() => setValue(String(most))}>
            All {most.toLocaleString("en-PH")}
          </Button>
          <Button
            small
            variant="primary"
            disabled={write.busy || Number(value || 0) === points.toUse}
            onClick={() =>
              write.send(`/api/leads/${data.lead.id}/points`, {
                points: Math.round(Number(value || 0)),
              })
            }
          >
            Save
          </Button>
          {points.toUse > 0 && (
            <Button
              small
              disabled={write.busy}
              onClick={() =>
                write
                  .send(`/api/leads/${data.lead.id}/points`, { points: 0 })
                  .then(() => setValue(""))
              }
            >
              Take off
            </Button>
          )}
        </div>
      )}
      <Problem message={write.general(["points"])} />
    </div>
  );
}

/** Photos and files that came in the chat: each filed as the paper it is, in one click. */
function ChatPhotos({ data }: { data: LeadCase }) {
  const write = useCaseWrite(data.lead.id);
  const kinds = data.papers.filter(
    (paper) => paper.kind !== "gl_letter" || data.lead.road === "gl",
  );
  const needed = kinds.filter((paper) => paper.needed && paper.files.length === 0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3">
      <div className="mb-2 text-[13px] font-semibold text-slate-800">
        From the chat, not filed yet
      </div>
      <ul className="flex flex-col gap-2">
        {data.unsorted.map((file) => (
          <li key={file.id} className="flex flex-wrap items-center gap-2.5">
            <a
              href={`/api/lead-files/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              {file.mime.startsWith("image/") ? (
                <img
                  src={`/api/lead-files/${file.id}`}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <FileText className="size-4 text-slate-400" />
              )}
            </a>
            <div className="min-w-0 flex-1 text-[11px] text-slate-500">{timeLabel(file.at)}</div>
            {data.can.work && (
              <div className="flex flex-wrap items-center gap-1.5">
                {needed.slice(0, 3).map((paper) => (
                  <Button
                    key={paper.kind}
                    small
                    disabled={write.busy}
                    onClick={() =>
                      write.send(`/api/lead-files/${file.id}/kind`, { kind: paper.kind })
                    }
                  >
                    {paper.label}
                  </Button>
                ))}
                <select
                  aria-label="File as another paper"
                  className="h-8 rounded-[10px] border border-line bg-white px-2 text-[13px]"
                  value={picked[file.id] ?? ""}
                  onChange={(event) => {
                    const kind = event.target.value;
                    setPicked((current) => ({ ...current, [file.id]: kind }));
                    if (kind) void write.send(`/api/lead-files/${file.id}/kind`, { kind });
                  }}
                >
                  <option value="">File as…</option>
                  {[
                    ...kinds.map((paper) => ({ kind: paper.kind, label: paper.label })),
                    { kind: "other", label: "Other paper" },
                  ].map((paper) => (
                    <option key={paper.kind} value={paper.kind}>
                      {paper.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Problem message={write.problem?.message} />
    </div>
  );
}

/** The conversation as a panel down the right; Esc or X closes it. */
function ChatDrawer({
  leadId,
  name,
  unread,
  canWork,
  onClose,
}: {
  leadId: number;
  name: string;
  unread: boolean;
  canWork: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !(event.target instanceof HTMLTextAreaElement && event.target.value)
      )
        onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <aside
      aria-label={`Conversation with ${name}`}
      className="fixed inset-0 z-40 flex flex-col bg-white shadow-pop sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] sm:border-l sm:border-slate-200"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="truncate text-sm font-semibold text-ink">{name}</div>
        <button
          type="button"
          aria-label="Close the conversation"
          onClick={onClose}
          className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <X className="size-4" />
        </button>
      </div>
      <ChatPanel leadId={leadId} unread={unread} canWork={canWork} className="min-h-0 flex-1" />
    </aside>
  );
}

// ---------------------------------------------------------------- quotation

/** The quotation out to the customer: the PDF, its link, and sending it on their channel. */
function QuotationOut({ data }: { data: LeadCase }) {
  const write = useCaseWrite(data.lead.id);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function makeLink(): Promise<string | null> {
    let made: string | null = null;
    await write.run(async () => {
      const answer = await api<{ path: string }>(`/api/leads/${data.lead.id}/quotation-link`, {
        body: {},
      });
      made = `${window.location.origin}${answer.path}`;
    });
    if (made) setLink(made);
    return made;
  }
  async function copy() {
    const made = link ?? (await makeLink());
    if (!made) return;
    await navigator.clipboard?.writeText(made).catch(() => {});
    setCopied(true);
  }
  async function send(via: "messenger" | "email") {
    const made = via === "messenger" ? (link ?? (await makeLink())) : null;
    if (via === "messenger" && !made) return;
    await write.send(`/api/leads/${data.lead.id}/quotation-send`, { via, link: made });
  }
  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-600">
        The quotation for the customer
      </div>
      <div className="flex flex-wrap gap-1.5">
        <a
          href={`/api/leads/${data.lead.id}/quotation.pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover"
        >
          <FileText className="size-3.5" /> Open the PDF
        </a>
        {data.can.work && (
          <>
            <Button small disabled={write.busy} onClick={copy}>
              {copied ? "Link copied" : "Copy its link"}
            </Button>
            {data.lead.chatChannel === "messenger" && (
              <Button
                small
                variant="primary"
                disabled={write.busy}
                onClick={() => send("messenger")}
              >
                Send on Messenger
              </Button>
            )}
            {(data.lead.chatChannel === "email" || (!data.lead.chatChannel && data.lead.email)) && (
              <Button small variant="primary" disabled={write.busy} onClick={() => send("email")}>
                Email the PDF
              </Button>
            )}
          </>
        )}
      </div>
      {link && (
        <div className="mt-2 break-all text-[11px] text-slate-500">
          {link} · open for 30 days, as it is now
        </div>
      )}
      <div className="mt-2">
        <Problem message={write.problem?.message} />
      </div>
    </div>
  );
}

type Draft = {
  medicineId: number;
  medicine: string;
  packSize: number;
  listPrice: number;
  price: string;
  qty: string;
  reason: string;
  vat: Vat;
  stock: number | null;
};

const toDraft = (line: QuoteLine): Draft => ({
  medicineId: line.medicineId,
  medicine: line.medicine,
  packSize: line.packSize,
  listPrice: line.listPrice,
  price: (line.unitPrice / 100).toFixed(2),
  qty: String(line.qty),
  reason: line.reason ?? "",
  vat: line.vat,
  stock: null,
});
const centavos = (text: string) => Math.round(Number(text.replace(/,/g, "")) * 100);

function QuotationStep({ data, onNext }: { data: LeadCase; onNext: () => void }) {
  const { lead } = data;
  const editable = data.can.work && !(data.order && data.order.status !== "cancelled");
  const [lines, setLines] = useState<Draft[]>(() => data.quote.lines.map(toDraft));
  const [dirty, setDirty] = useState(false);
  const write = useCaseWrite(lead.id);
  const catalogue = useQuery({
    queryKey: ["inventory", "medicines"],
    queryFn: () => api<Catalogue>("/api/inventory/medicines"),
    enabled: editable,
    staleTime: 120_000,
  });
  const stockOf = useMemo(
    () => new Map((catalogue.data?.rows ?? []).map((row) => [row.id, row.total])),
    [catalogue.data],
  );
  const change = (index: number, changes: Partial<Draft>) => {
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, ...changes } : line)),
    );
    setDirty(true);
  };
  const typed = lines.map((line) => ({
    qty: Math.max(0, Math.floor(Number(line.qty) || 0)),
    unitPrice: Number.isFinite(centavos(line.price)) ? centavos(line.price) : 0,
    vat: line.vat,
  }));
  const totals = totalsOf(typed, lead.road);
  const quoted = data.quote.lines.length > 0 && !data.quote.stale && !dirty;

  function add(row: CatalogueRow) {
    const price = row.prices.patient;
    if (price === undefined) return;
    if (lines.some((line) => line.medicineId === row.id)) return;
    setLines((current) => [
      ...current,
      {
        medicineId: row.id,
        medicine: [row.name, row.strength].filter(Boolean).join(" "),
        packSize: row.packSize,
        listPrice: price,
        price: (price / 100).toFixed(2),
        qty: String(row.packSize || 1),
        reason: "",
        vat: (row.vat ?? "exempt") as Vat,
        stock: row.total,
      },
    ]);
    setDirty(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const done = await write.send(`/api/leads/${lead.id}/quote`, {
      lines: lines.map((line, index) => ({
        medicineId: line.medicineId,
        qty: typed[index]?.qty ?? 0,
        unitPrice: typed[index]?.unitPrice ?? null,
        reason: line.reason.trim() || null,
      })),
    });
    if (done) setDirty(false);
  }

  const nextLabel = lead.road === "gl" ? "Next: 2.1 Agency application" : "Next: Order & delivery";
  return (
    <form onSubmit={save}>
      <StepPanel
        number="2"
        title="Enquiry & quotation"
        footer={
          <>
            {editable && (
              <Button
                type="submit"
                variant={quoted ? "plain" : "primary"}
                small
                disabled={write.busy || lines.length === 0 || (!dirty && quoted)}
              >
                {write.busy ? "Saving…" : quoted ? "Saved" : "Save quotation"}
              </Button>
            )}
            <NextButton
              label={nextLabel}
              onClick={onNext}
              disabled={!quoted}
              why={dirty ? "Save the quotation first." : null}
            />
          </>
        }
      >
        {lead.request && (
          <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            <span className="font-semibold">Asked for:</span> {lead.request}
          </div>
        )}
        {data.quote.stale && !dirty && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Saved for another road. Check the prices and save it again for this one.
          </div>
        )}

        {lines.length > 0 ? (
          <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
            {lines.map((line, index) => {
              const price = typed[index]?.unitPrice ?? 0;
              const below = price < line.listPrice;
              const stock = line.stock ?? stockOf.get(line.medicineId) ?? null;
              const qty = typed[index]?.qty ?? 0;
              return (
                <div key={line.medicineId} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-slate-800">
                        {line.medicine}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Patient price {peso(line.listPrice)} a piece
                        {line.packSize > 1 ? ` · ${line.packSize} in a pack` : ""}
                        {stock !== null && (
                          <span
                            className={`ml-2 font-semibold ${stock === 0 ? "text-rose-700" : stock < qty ? "text-amber-700" : "text-emerald-700"}`}
                          >
                            {stock === 0
                              ? "Out of stock"
                              : stock < qty
                                ? `Only ${count(stock)} in stock`
                                : `In stock ${count(stock)}`}
                          </span>
                        )}
                      </div>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        aria-label={`Take ${line.medicine} off`}
                        onClick={() => {
                          setLines((current) => current.filter((_, at) => at !== index));
                          setDirty(true);
                        }}
                        className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-[6rem_8rem_minmax(0,1fr)] items-end gap-2">
                    <Field label="Pieces" error={write.at(`lines.${index}.qty`)}>
                      {(field) => (
                        <input
                          {...field}
                          className={INPUT}
                          inputMode="numeric"
                          disabled={!editable}
                          value={line.qty}
                          onChange={(event) => change(index, { qty: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="Price a piece (₱)" error={write.at(`lines.${index}.unitPrice`)}>
                      {(field) => (
                        <input
                          {...field}
                          className={INPUT}
                          inputMode="decimal"
                          disabled={!editable}
                          value={line.price}
                          onChange={(event) => change(index, { price: event.target.value })}
                        />
                      )}
                    </Field>
                    <div className="pb-2 text-right text-[13px] font-semibold text-slate-800 tabular-nums">
                      {peso(qty * price)}
                    </div>
                  </div>
                  {below && (
                    <Field
                      label="Why below the patient price"
                      error={write.at(`lines.${index}.reason`)}
                    >
                      {(field) => (
                        <input
                          {...field}
                          className={INPUT}
                          disabled={!editable}
                          value={line.reason}
                          onChange={(event) => change(index, { reason: event.target.value })}
                        />
                      )}
                    </Field>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 px-3 py-5 text-center text-[13px] text-slate-500">
            No medicine on the quotation yet.
          </div>
        )}

        {editable && (
          <MedicinePicker
            catalogue={catalogue.data}
            failed={catalogue.isError}
            onRetry={() => catalogue.refetch()}
            taken={lines.map((line) => line.medicineId)}
            onPick={add}
          />
        )}

        {lines.length > 0 && (
          <dl className="mt-4 flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-slate-600">Medicines</dt>
              <dd className="tabular-nums">{peso(totals.subtotal)}</dd>
            </div>
            {totals.relief && (
              <>
                <div className="flex justify-between">
                  <dt className="text-slate-600">VAT removed</dt>
                  <dd className="tabular-nums">−{peso(totals.relief.vatRemoved)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">
                    20% {lead.road === "pwd" ? "PWD" : "senior citizen"} discount
                  </dt>
                  <dd className="tabular-nums">−{peso(totals.relief.discount)}</dd>
                </div>
              </>
            )}
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-[15px] font-bold">
              <dt>{lead.road === "gl" ? "Quotation for the agency" : "To pay"}</dt>
              <dd className="tabular-nums">{peso(totals.total)}</dd>
            </div>
          </dl>
        )}

        {quoted && <QuotationOut data={data} />}

        {quoted && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-slate-600">
              {lead.quoteSentVia
                ? `Sent by ${VIA_LABEL[lead.quoteSentVia] ?? lead.quoteSentVia}${lead.quoteSentAt ? ` · ${timeLabel(lead.quoteSentAt)}` : ""}`
                : "Sent to the customer by"}
            </div>
            {data.can.work && (
              <div className="flex flex-wrap gap-1.5">
                {SENT_VIA.map((item) => (
                  <Button
                    key={item.key}
                    small
                    variant={lead.quoteSentVia === item.key ? "primary" : "plain"}
                    disabled={write.busy}
                    onClick={() =>
                      write.send(`/api/leads/${lead.id}/quote-sent`, { via: item.key })
                    }
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-3">
          <Problem
            message={write.general(
              lines.flatMap((_, index) => [
                `lines.${index}.qty`,
                `lines.${index}.unitPrice`,
                `lines.${index}.reason`,
              ]),
            )}
          />
        </div>
      </StepPanel>
    </form>
  );
}

function MedicinePicker({
  catalogue,
  failed,
  onRetry,
  taken,
  onPick,
}: {
  catalogue?: Catalogue;
  failed: boolean;
  onRetry: () => void;
  taken: number[];
  onPick: (row: CatalogueRow) => void;
}) {
  const [text, setText] = useState("");
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length
    ? (catalogue?.rows ?? [])
        .filter((row) =>
          words.every((word) =>
            [row.name, row.generic, row.strength, row.code, row.brand]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(word),
          ),
        )
        .slice(0, 8)
    : [];
  return (
    <div className="relative mt-3">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
      <input
        type="search"
        aria-label="Add a medicine"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={failed ? "Couldn't load the medicines" : "Add a medicine: type its name"}
        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white py-1.5 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10 focus:outline-none"
      />
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-semibold text-emerald-700 hover:underline"
        >
          Try again
        </button>
      )}
      {found.length > 0 && (
        <ul className="absolute right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-pop">
          {found.map((row) => {
            const price = row.prices.patient;
            const on = taken.includes(row.id);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={price === undefined || on}
                  onClick={() => {
                    onPick(row);
                    setText("");
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-emerald-50 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-slate-800">
                      {[row.name, row.strength].filter(Boolean).join(" ")}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {[row.generic, row.form, row.pack].filter(Boolean).join(" · ")}
                      {row.rx ? " · Rx" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px]">
                    <span className="block font-semibold text-slate-800">
                      {price === undefined ? "No patient price" : `${peso(price)} a piece`}
                    </span>
                    <span className={row.total > 0 ? "text-emerald-700" : "text-rose-700"}>
                      {on
                        ? "On the quotation"
                        : row.total > 0
                          ? `In stock ${count(row.total)}`
                          : "Out of stock"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- guarantee letter

function GlStep({
  data,
  part,
  onNext,
}: {
  data: LeadCase;
  part: "apply" | "letter";
  onNext: () => void;
}) {
  const { lead } = data;
  const editable = data.can.work && !(data.order && data.order.status !== "cancelled");
  const write = useCaseWrite(lead.id);
  const [appliedOn, setAppliedOn] = useState(lead.glAppliedOn ?? "");
  const [letterNo, setLetterNo] = useState(lead.glLetterNo ?? "");
  const [amount, setAmount] = useState(lead.glAmount ? (lead.glAmount / 100).toFixed(2) : "");
  const [letterOn, setLetterOn] = useState(lead.glLetterOn ?? "");
  const agency = AGENCIES.find((item) => item.key === lead.agency);
  const letter = data.papers.find((paper) => paper.kind === "gl_letter");
  const quoted = data.quote.lines.length > 0 && !data.quote.stale;

  async function save(verify: boolean) {
    await write.send(`/api/leads/${lead.id}/gl`, {
      appliedOn: appliedOn || null,
      letterNo: letterNo.trim() || null,
      amount: amount.trim() ? centavos(amount) : null,
      letterOn: letterOn || null,
      verify,
    });
  }
  const verified = Boolean(lead.glVerifiedAt);
  const fields = ["appliedOn", "letterNo", "amount", "letterOn", "verify"];

  if (part === "apply")
    return (
      <StepPanel
        number="2.1"
        title={`${agency?.short ?? "Agency"} application`}
        footer={
          <NextButton
            label="Next: 2.2 Guarantee letter"
            onClick={onNext}
            disabled={!lead.glAppliedOn}
          />
        }
      >
        {!quoted && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Save the quotation first: the patient applies with it.
          </div>
        )}
        <div className="grid gap-3 sm:max-w-xs">
          <Field label="Applied on" error={write.at("appliedOn")}>
            {(field) => (
              <input
                {...field}
                type="date"
                className={INPUT}
                disabled={!editable}
                value={appliedOn}
                onChange={(event) => setAppliedOn(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="mt-3">
          <Problem message={write.general(fields)} />
        </div>
        {editable && (
          <div className="mt-3">
            <Button
              small
              variant="primary"
              disabled={write.busy || !appliedOn || appliedOn === (lead.glAppliedOn ?? "")}
              onClick={() => save(verified)}
            >
              {write.busy
                ? "Saving…"
                : lead.glAppliedOn
                  ? "Save the day"
                  : "Record the application"}
            </Button>
          </div>
        )}
      </StepPanel>
    );

  return (
    <StepPanel
      number="2.2"
      title="Guarantee letter"
      footer={<NextButton label="Next: Order & delivery" onClick={onNext} disabled={!verified} />}
    >
      {!lead.glAppliedOn && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Record the application first (2.1).
        </div>
      )}
      {letter && (
        <PaperRow
          data={data}
          kind="gl_letter"
          label="Photo of the letter"
          needed
          files={letter.files}
        />
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Letter number" error={write.at("letterNo")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              disabled={!editable}
              value={letterNo}
              onChange={(event) => setLetterNo(event.target.value)}
            />
          )}
        </Field>
        <Field label="Amount granted (₱)" error={write.at("amount")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="decimal"
              disabled={!editable}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
        <Field label="Letter dated" error={write.at("letterOn")}>
          {(field) => (
            <input
              {...field}
              type="date"
              className={INPUT}
              disabled={!editable}
              value={letterOn}
              onChange={(event) => setLetterOn(event.target.value)}
            />
          )}
        </Field>
      </div>
      {data.quote.lines.length > 0 && amount.trim() && centavos(amount) < data.quote.total && (
        <div className="mt-2 text-[13px] text-amber-800">
          The letter grants less than the quotation ({peso(data.quote.total)}).
        </div>
      )}
      {verified && (
        <div className="mt-3 text-[13px] font-medium text-emerald-700">
          Verified {timeLabel(lead.glVerifiedAt as string)}
        </div>
      )}
      <div className="mt-3">
        <Problem message={write.at("verify") ?? write.general(fields)} />
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button small disabled={write.busy} onClick={() => save(verified)}>
            Save
          </Button>
          {!verified ? (
            <Button small variant="primary" disabled={write.busy} onClick={() => save(true)}>
              Mark the letter verified
            </Button>
          ) : (
            <Button small variant="danger" disabled={write.busy} onClick={() => save(false)}>
              Not verified
            </Button>
          )}
        </div>
      )}
    </StepPanel>
  );
}

// ---------------------------------------------------------------- order, payment

/** One line of the order's trail on the case: done, the step waiting now, or one still to come. */
function TrailRow({
  state,
  title,
  note,
}: {
  state: "done" | "now" | "later" | "stopped";
  title: ReactNode;
  note?: ReactNode;
}) {
  const tone =
    state === "done"
      ? "border-green-200 bg-green-50"
      : state === "now"
        ? "border-amber-300 bg-amber-50"
        : state === "stopped"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white text-slate-500";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-[13px] ${tone}`}
    >
      <span
        aria-hidden="true"
        className={`font-bold ${state === "done" ? "text-emerald-700" : state === "now" ? "text-amber-700" : state === "stopped" ? "text-rose-700" : "text-slate-300"}`}
      >
        {state === "done" ? "✓" : state === "stopped" ? "!" : "●"}
      </span>
      <span className="min-w-0 flex-1">{title}</span>
      {note && (
        <span className={`text-right ${state === "now" ? "text-amber-800" : "text-slate-500"}`}>
          {note}
        </span>
      )}
    </div>
  );
}

const shortTime = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));

/** Where the case's order stands, in a few words for the step's heading. */
function orderWord(order: NonNullable<LeadCase["order"]>): string {
  if (order.status === "completed")
    return order.trail.invoice && order.trail.invoice.balance === 0
      ? "Delivered and paid"
      : "Delivered";
  if (order.status === "shipped") return "On the way";
  if (order.status === "packing") return "Packed";
  if (order.status === "pending_approval") return "Waiting for Management";
  if (order.status === "on_hold" || order.status === "exception") return "On hold";
  if (order.status === "draft") return "Sent back";
  return "With Dispatch";
}

/** The order on the case, from its placing to its handover: Management's check (when one was
 *  needed), Dispatch's packing and road, then the agent hands it over. */
function PlacedOrder({
  data,
  order,
  onNext,
}: {
  data: LeadCase;
  order: NonNullable<LeadCase["order"]>;
  onNext: () => void;
}) {
  const write = useCaseWrite(data.lead.id);
  const [ask, setAsk] = useState<DispatchAsk>(null);
  const gl = data.lead.road === "gl";
  const { trail } = order;
  const check = trail.check;
  const pays =
    order.terms === "cod"
      ? "Cash on delivery"
      : order.terms === "advance"
        ? "Paid in advance"
        : "Billed to the agency";
  const delivered = order.status === "completed";
  const stopped = check.state === "held" || check.state === "sent_back";
  const paidAhead =
    order.terms === "advance" && trail.invoice !== null && trail.invoice.balance > 0;
  return (
    <StepPanel
      number="3"
      title={`Order ${order.code} · ${peso(order.total)} · ${orderWord(order)}`}
      footer={
        <>
          <Link
            to={`/orders/${order.id}`}
            className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-emerald-700"
          >
            Open the order <ExternalLink className="size-3.5" />
          </Link>
          <SendToCustomer orderId={order.id} small up />
          {(delivered || paidAhead) && (
            <NextButton label={gl ? "Next: Claim & payment" : "Next: Payment"} onClick={onNext} />
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {check.state === "none" ? (
          <TrailRow
            state="done"
            title={
              <>
                <b>Management check</b> · not needed
              </>
            }
            note="no discount, no credit"
          />
        ) : check.state === "approved" ? (
          <TrailRow
            state="done"
            title={
              <>
                <b>Management check</b> · approved by {check.by}
              </>
            }
            note={check.at ? shortTime(check.at) : undefined}
          />
        ) : check.state === "waiting" ? (
          <TrailRow
            state="now"
            title={
              <>
                <b>Management check</b> · waiting
                {check.reasons.map((reason) => (
                  <span key={reason} className="block text-[12px] text-amber-800">
                    {reason}
                  </span>
                ))}
              </>
            }
          />
        ) : (
          <TrailRow
            state="stopped"
            title={
              <>
                <b>
                  {check.state === "held" ? "On hold by Management" : "Sent back by Management"}
                </b>
                {check.reasons[0] ? ` · ${check.reasons[0]}` : ""}
              </>
            }
          />
        )}
        {trail.packed ? (
          <TrailRow
            state="done"
            title={
              <>
                <b>Packed</b> · {trail.packed.by ?? "Dispatch"} (Dispatch),{" "}
                {shortTime(trail.packed.at)}
              </>
            }
            note={[
              trail.packed.warehouse,
              ...trail.packed.batches.map((batch) => batch.split(" · ")[1] ?? batch),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ) : (
          <TrailRow
            state={check.state === "waiting" || stopped ? "later" : "now"}
            title={
              <>
                <b>Packing</b> · Dispatch packs it
              </>
            }
          />
        )}
        {trail.shipped && (
          <TrailRow
            state="done"
            title={
              <>
                <b>Shipped</b> · {trail.shipped.how}
              </>
            }
            note={`${trail.shipped.by ?? "Dispatch"}, ${shortTime(trail.shipped.at)}`}
          />
        )}
        {trail.delivered ? (
          <TrailRow
            state="done"
            title={
              <>
                <b>Delivered</b> · received by {trail.delivered.receivedBy ?? "the customer"}
              </>
            }
            note={`${dayLabel(trail.delivered.on)}${trail.delivered.by ? ` · marked by ${trail.delivered.by}` : ""}`}
          />
        ) : (
          <TrailRow
            state={data.can.deliver ? "now" : "later"}
            title={
              <>
                <b>Delivery</b> · {data.can.deliver ? "your step" : "after Dispatch ships it"}
              </>
            }
            note={trail.shipped?.how}
          />
        )}
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-3 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-[12px] font-semibold text-slate-600">Receiver</dt>
          <dd>
            {trail.receiver ?? "—"}
            {trail.receiverPhone ? ` · ${trail.receiverPhone}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold text-slate-600">How it pays</dt>
          <dd>
            {pays}
            {trail.pointsUsed > 0 ? ` · ${count(trail.pointsUsed)} points used` : ""}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[12px] font-semibold text-slate-600">Address</dt>
          <dd>{trail.address ?? "—"}</dd>
        </div>
      </dl>

      {data.can.deliver && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button
            variant="primary"
            onClick={() => setAsk({ what: "deliver", orderId: order.id, code: order.code })}
          >
            {order.status === "packing" ? "Picked up by the customer" : "Mark as delivered"}
          </Button>
          <span className="text-[13px] text-slate-500">
            Who received it, the day, and the signed receipt's photo.
          </span>
        </div>
      )}
      {paidAhead && data.can.pay && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-[13px]">
          <span className="font-medium text-amber-800">
            Paid in advance: record the money received.
          </span>
          <Button small onClick={onNext}>
            Go to payment
          </Button>
        </div>
      )}
      <Problem message={write.problem?.message} />
      <DispatchDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
          void write.refresh();
        }}
      />
    </StepPanel>
  );
}

function OrderStep({ data, onNext }: { data: LeadCase; onNext: () => void }) {
  const write = useCaseWrite(data.lead.id);
  // A website order comes with how the customer chose to pay.
  const [pay, setPay] = useState<"cod" | "advance" | null>(
    data.web?.paymentMethod ? (data.web.paymentMethod === "cod" ? "cod" : "advance") : null,
  );
  const fee = data.web?.money.deliveryFee ?? 0;
  const order = data.order && data.order.status !== "cancelled" ? data.order : null;
  const gl = data.lead.road === "gl";
  // The switch at the top: a price below the list sends it to Management whatever the agent
  // picks; otherwise it goes straight to Dispatch unless the agent asks Management to look.
  const [toManagement, setToManagement] = useState(false);
  const reasons = data.quote.lines
    .filter((line) => line.unitPrice < line.listPrice)
    .map(
      (line) =>
        `${line.medicine} below its price (${peso(line.unitPrice)}, list ${peso(line.listPrice)})`,
    );
  if (order) return <PlacedOrder data={data} order={order} onNext={onNext} />;
  return (
    <StepPanel number="3" title="Order & delivery">
      {
        <div className="flex flex-col gap-3">
          {data.can.work && data.can.placeOrder && (
            <OrderChecksBox
              reasons={reasons}
              management={toManagement}
              onManagement={setToManagement}
            />
          )}
          {data.quote.lines.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px]">
              {data.quote.lines.map((line) => (
                <li key={line.medicineId} className="flex justify-between gap-3">
                  <span className="truncate">
                    {line.medicine} × {count(line.qty)}
                  </span>
                  <span className="tabular-nums">{peso(line.qty * line.unitPrice)}</span>
                </li>
              ))}
              {data.quote.relief && (
                <li className="flex justify-between gap-3 text-slate-600">
                  <span>No VAT and 20% off</span>
                  <span className="tabular-nums">
                    −{peso(data.quote.relief.vatRemoved + data.quote.relief.discount)}
                  </span>
                </li>
              )}
              {fee > 0 && (
                <li className="flex justify-between gap-3 text-slate-600">
                  <span>Delivery fee (the website's)</span>
                  <span className="tabular-nums">{peso(fee)}</span>
                </li>
              )}
              {data.points.toUse > 0 && !gl && (
                <li className="flex justify-between gap-3 text-emerald-700">
                  <span>{data.points.toUse.toLocaleString("en-PH")} points</span>
                  <span className="tabular-nums">−{peso(data.points.toUse * 100)}</span>
                </li>
              )}
              <li className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 font-bold">
                <span>{gl ? "Billed to the agency" : "To pay"}</span>
                <span className="tabular-nums">
                  {peso(data.quote.total + fee - (gl ? 0 : data.points.toUse * 100))}
                </span>
              </li>
            </ul>
          )}
          {data.can.work && !gl && <UsePoints data={data} />}
          {data.order?.status === "cancelled" && (
            <div className="text-[13px] text-rose-700">
              Order {data.order.code} was cancelled. A new one can be placed.
            </div>
          )}
          {!data.can.placeOrder && data.can.placeWhy && (
            <div className="text-[13px] text-slate-600">{data.can.placeWhy}</div>
          )}
          {data.can.work && data.can.placeOrder && !gl && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-600">How they pay</div>
              <div className="grid max-w-md grid-cols-2 gap-2">
                {(
                  [
                    ["cod", "Cash on delivery"],
                    ["advance", "Paid in advance"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center justify-center rounded-[10px] border px-3 py-2 text-sm font-semibold ${pay === key ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-line text-slate-600 hover:bg-hover"}`}
                  >
                    <input
                      type="radio"
                      name="pay"
                      className="sr-only"
                      checked={pay === key}
                      onChange={() => setPay(key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {write.at("pay") && (
                <div className="mt-1 text-[13px] text-bad">{write.at("pay")}</div>
              )}
            </div>
          )}
          <Problem message={write.general(["pay"])} />
          {data.can.work && (
            <div>
              <Button
                variant="primary"
                disabled={!data.can.placeOrder || write.busy || (!gl && !pay)}
                onClick={() =>
                  write.send(
                    `/api/leads/${data.lead.id}/order`,
                    gl ? { toManagement } : { pay, toManagement },
                  )
                }
              >
                {write.busy ? "Placing…" : "Place the order"}
              </Button>
            </div>
          )}
        </div>
      }
    </StepPanel>
  );
}

function PayStep({ data, onBack }: { data: LeadCase; onBack: () => void }) {
  const write = useCaseWrite(data.lead.id);
  const [paying, setPaying] = useState(false);
  const gl = data.lead.road === "gl";
  const order = data.order && data.order.status !== "cancelled" ? data.order : null;
  const title = gl ? "Claim & payment" : "Payment & follow-up";
  const invoice = order?.trail.invoice ?? null;
  // Cash on delivery and the agency's claim come after the handover; paid in advance, at once.
  const before = !order || !invoice || (order.terms !== "advance" && order.status !== "completed");
  if (before)
    return (
      <StepPanel number="4" title={title}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-slate-600">
          <span>
            {order ? "Payment comes after the delivery." : "Payment comes after the order."}
          </span>
          <Button small onClick={onBack}>
            {order ? "Go to delivery" : "Go to the order"}
          </Button>
        </div>
      </StepPanel>
    );
  const payments = order.trail.payments;
  return (
    <StepPanel number="4" title={title}>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-slate-500">Invoice</dt>
            <dd className="font-semibold">{invoice.code}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-slate-500">Total</dt>
            <dd className="font-semibold tabular-nums">{peso(invoice.total)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-slate-500">Received</dt>
            <dd className="font-semibold tabular-nums">{peso(invoice.paid)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-slate-500">Still owed</dt>
            <dd
              className={`font-semibold tabular-nums ${invoice.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}
            >
              {invoice.balance > 0 ? peso(invoice.balance) : "Paid in full"}
            </dd>
          </div>
        </dl>
        {payments.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-[13px]">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span>
                  <b className="tabular-nums">{peso(payment.amount)}</b> · {payment.methodLabel}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </span>
                <span className="text-[12px] text-slate-500">
                  {dayLabel(payment.paidOn)} · {payment.by}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="text-[13px] text-slate-700">{data.next}</div>
        <div className="flex flex-wrap items-center gap-2">
          {data.can.pay && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              Record payment received
            </Button>
          )}
          <SendToCustomer orderId={order.id} up />
        </div>
      </div>
      {paying && (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          code={invoice.code}
          balance={invoice.balance}
          orderId={order.id}
          proofs={[]}
          onClose={() => {
            setPaying(false);
            void write.refresh();
          }}
        />
      )}
    </StepPanel>
  );
}

// ---------------------------------------------------------------- side

function MoneyCard({ data }: { data: LeadCase }) {
  const order = data.order && data.order.status !== "cancelled" ? data.order : null;
  if (!order && data.quote.lines.length === 0) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <h2 className="border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
        Money
      </h2>
      <dl className="flex flex-col gap-1.5 text-sm">
        {data.quote.lines.map((line) => (
          <div key={line.medicineId} className="flex justify-between gap-3">
            <dt className="truncate text-slate-600">
              {line.medicine} × {count(line.qty)}
            </dt>
            <dd className="tabular-nums">{peso(line.qty * line.unitPrice)}</dd>
          </div>
        ))}
        {data.quote.relief && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600">No VAT and 20% off</dt>
            <dd className="tabular-nums">
              −{peso(data.quote.relief.vatRemoved + data.quote.relief.discount)}
            </dd>
          </div>
        )}
        {(data.web?.money.deliveryFee ?? 0) > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600">Delivery fee</dt>
            <dd className="tabular-nums">{peso(data.web?.money.deliveryFee ?? 0)}</dd>
          </div>
        )}
        <div className="mt-1 flex justify-between gap-3 border-t border-slate-100 pt-1.5 font-semibold">
          <dt>{order ? "Order total" : "Quotation"}</dt>
          <dd className="tabular-nums">
            {peso(order ? order.total : data.quote.total + (data.web?.money.deliveryFee ?? 0))}
          </dd>
        </div>
        {data.lead.road === "regular" && data.points.toUse > 0 && (
          <div className="flex justify-between gap-3 text-emerald-700">
            <dt>{data.points.toUse.toLocaleString("en-PH")} points</dt>
            <dd className="tabular-nums">−{peso(data.points.toUse * 100)}</dd>
          </div>
        )}
        {data.lead.road === "gl" && data.lead.glAmount !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600">Letter grants</dt>
            <dd className="tabular-nums">{peso(data.lead.glAmount)}</dd>
          </div>
        )}
        {order?.invoice && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600">Still due</dt>
            <dd
              className={`tabular-nums ${order.invoice.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}
            >
              {peso(order.invoice.balance)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function Activity({ data }: { data: LeadCase }) {
  const write = useCaseWrite(data.lead.id);
  const [text, setText] = useState("");
  const [all, setAll] = useState(false);
  const shown = all ? data.events : data.events.slice(0, 8);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (await write.send(`/api/leads/${data.lead.id}/note`, { message: text.trim() })) setText("");
  }
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <h2 className="border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
        Activity
      </h2>
      {data.can.work && (
        <form onSubmit={add} className="mb-3 flex gap-2">
          <input
            aria-label="Add a note"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Add a note…"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <Button
            type="submit"
            small
            disabled={write.busy || !text.trim()}
            aria-label="Add the note"
          >
            <Plus className="size-4" />
          </Button>
        </form>
      )}
      <Problem message={write.problem?.message} />
      <ol className="flex flex-col gap-2.5">
        {shown.map((event) => (
          <li key={event.id} className="text-[12px] leading-snug">
            <div
              className={
                event.kind === "note"
                  ? "rounded-lg bg-amber-50 px-2 py-1.5 text-slate-800"
                  : "text-slate-700"
              }
            >
              {event.message}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {event.by} · {timeLabel(event.at)}
            </div>
          </li>
        ))}
      </ol>
      {data.events.length > 8 && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="mt-2 text-xs font-semibold text-emerald-700 hover:underline"
        >
          {all ? "Show less" : `Show all ${data.events.length}`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- dialogs

const FIELDS = [
  "source",
  "name",
  "relation",
  "patientName",
  "phone",
  "email",
  "city",
  "address",
  "road",
  "agency",
  "request",
  "assignedTo",
];

function EditDialog({
  data,
  lockRoad,
  focus,
  onClose,
}: {
  data: LeadCase;
  lockRoad: string | null;
  focus?: "email";
  onClose: () => void;
}) {
  const write = useCaseWrite(data.lead.id);
  const { lead } = data;
  const start: LeadInput = {
    source: lead.source,
    name: lead.name,
    relation: lead.relation,
    patientName: lead.patientName,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    address: lead.address,
    road: lead.road,
    agency: lead.agency,
    request: lead.request,
    assignedTo: lead.assignedTo,
  };
  async function save(input: LeadInput) {
    if (await write.send(`/api/leads/${lead.id}`, input)) onClose();
  }
  return (
    <Dialog
      title="Case details"
      sub="Everything needed to start this case, in one place. Save, and the case's steps follow."
      onClose={onClose}
      busy={write.busy}
    >
      <LeadForm
        focus={focus}
        start={start}
        agents={data.agents}
        busy={write.busy}
        at={write.at}
        onSubmit={save}
        submitLabel="Save and start"
        onClose={onClose}
        problem={write.general(FIELDS)}
        lockRoad={lockRoad}
      />
    </Dialog>
  );
}

function LostDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const write = useCaseWrite(id);
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await write.send(`/api/leads/${id}/lost`, { reason: reason.trim() || null })) onClose();
  }
  return (
    <Dialog title="Close as lost" onClose={onClose} busy={write.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Why it is lost" error={write.at("reason")}>
          {(field) => (
            <textarea
              {...field}
              className={`${INPUT} min-h-20`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <Problem message={write.general(["reason"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={write.busy}>
            Keep it open
          </Button>
          <Button type="submit" variant="danger" disabled={write.busy}>
            {write.busy ? "Closing…" : "Close as lost"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
