// One customer (a hospital, a doctor, a buyer or a patient), laid out as the old CRM's case page:
// the head card with who they are, who looks after them up the line and how they buy, a glance
// at their buying inside it, then their parts on the left (orders, medicines, money, enquiries,
// doctors, details, activity) with the open one on the right. Everything comes from one read.

import type {
  CustomerCredit,
  CustomerFiles,
  CustomerPage,
  CustomerPaperKind,
  CustomerPrices,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  Banknote,
  Check,
  ClipboardList,
  FileText,
  Inbox,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Pill as PillIcon,
  Plus,
  ShoppingBag,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { CustomerDialog } from "../customers/dialog";
import { PricesGiven } from "../customers/prices";
import { PAPER_ACCEPT } from "../photo";
import {
  type BadgeTone,
  CodeChip,
  ContactLine,
  Crumbs,
  Glance,
  HeadBox,
  HeadButton,
  HeadLine,
  KindBadge,
  Nothing,
  PlacePill,
  RecordHead,
  SectionPanel,
  SideCard,
  SideRows,
  StatePill,
} from "../record";
import {
  Button,
  count,
  Dialog,
  dayLabel,
  PageState,
  Problem,
  peso,
  timeLabel,
  useAction,
} from "../ui";

const KIND_TONE: Record<string, BadgeTone> = {
  hospital: "teal",
  doctor: "violet",
  patient: "sky",
  pharmacy: "amber",
  distributor: "amber",
  clinic: "emerald",
};
const LIST_OF: Record<string, [string, string]> = {
  hospital: ["Hospitals", "/hospitals"],
  doctor: ["Doctors", "/doctors"],
  patient: ["Patients", "/patients"],
};

const day = (iso: string) => dayLabel(iso.slice(0, 10));

/** Who may place an order (the API's ORDER_PLACE_ROLES). */
const PLACERS = ["medrep", "team_lead", "manager", "management", "online", "admin"];

export function Customer() {
  const me = useMe().data;
  const id = Number(useParams().id);
  const queries = useQueryClient();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const query = useQuery({
    queryKey: ["customers", "one", id, "page"],
    queryFn: () => api<CustomerPage>(`/api/customers/${id}/page`),
  });
  // Their orders before this CRM (Zoho), shared with "Prices given" below: an old customer's
  // tiles say what they bought there too, not "none yet".
  const before = useQuery({
    queryKey: ["customers", "prices", id],
    queryFn: () => api<CustomerPrices>(`/api/customers/${id}/prices`),
  }).data?.past;

  const data = query.data;
  if (!data) return <PageState query={query} what="this customer" />;
  const { customer, can, totals } = data;
  const kind = data.kinds.find((entry) => entry.key === customer.kind);
  const [listLabel, listTo] = LIST_OF[customer.kind] ?? ["Customers", "/customers"];
  const patient = customer.kind === "patient";

  async function review() {
    const done = await action.run(async () => {
      await api(`/api/customers/${customer.id}/review`, { method: "POST" });
    });
    if (done) await queries.invalidateQueries({ queryKey: ["customers"] });
  }

  const pays =
    customer.paymentTerms === "days"
      ? `${customer.paymentDays} days`
      : customer.paymentTerms === "cod"
        ? "On delivery"
        : "In advance";
  const creditLeft = customer.creditLimit ? Math.max(0, customer.creditLimit - totals.owed) : null;

  const missing = !customer.phone || !customer.email || !(customer.address || customer.city);

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Crumbs list={listLabel} to={listTo} />
        {PLACERS.includes(me?.role ?? "") && !me?.viewedBy && (
          <Link
            to={`/orders/new?customer=${customer.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
          >
            <Plus className="size-4" /> New order for them
          </Link>
        )}
      </div>

      <RecordHead
        name={customer.name}
        chips={
          <>
            <CodeChip>{customer.code}</CodeChip>
            <KindBadge tone={KIND_TONE[customer.kind] ?? "slate"}>
              {kind?.label ?? customer.kind}
            </KindBadge>
            {(customer.channel || customer.area) && (
              <PlacePill title="The area and channel it belongs to">
                {[customer.channel, customer.area].filter(Boolean).join(" · ")}
              </PlacePill>
            )}
            {customer.review === "to_review" ? (
              <StatePill tone="warn">Not checked yet</StatePill>
            ) : (
              !patient && <StatePill tone="good">Checked</StatePill>
            )}
            {customer.licenceState === "expired" && (
              <StatePill tone="bad">Licence expired</StatePill>
            )}
            {customer.licenceState === "soon" && (
              <StatePill tone="warn">Licence expires soon</StatePill>
            )}
            {can.add && (
              <HeadButton icon={ClipboardList} onClick={() => setEditing(true)} missing={missing}>
                Edit details
              </HeadButton>
            )}
          </>
        }
        lines={
          <>
            <HeadLine>
              <span className="shrink-0 text-slate-400">
                {totals.firstOrderAt
                  ? `Customer since ${day(totals.firstOrderAt)}`
                  : `Added ${day(customer.addedAt)}`}
              </span>
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                <UserRound className="size-3.5 text-slate-400" />
                <span className="text-slate-400">Looked after by</span>
                {data.line.length > 0 ? (
                  data.line.map((person, index) => (
                    <span key={person.name} className="inline-flex items-center gap-1.5">
                      {index > 0 && <span className="text-slate-300">›</span>}
                      <span className="font-medium text-slate-700">{person.name}</span>
                      {person.title && <span className="text-slate-400">({person.title})</span>}
                    </span>
                  ))
                ) : (
                  <span className="font-medium text-slate-700">Nobody yet</span>
                )}
              </span>
            </HeadLine>
            <ContactLine>
              {customer.phone && (
                <a
                  href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1 font-medium text-slate-800 hover:text-emerald-700"
                >
                  <Phone className="size-3.5 text-slate-400" />
                  {customer.phone}
                </a>
              )}
              {customer.email ? (
                <a
                  href={`mailto:${customer.email}`}
                  className="inline-flex min-w-0 items-center gap-1 hover:text-emerald-700"
                >
                  <Mail className="size-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{customer.email}</span>
                </a>
              ) : (
                can.add && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1 font-medium text-emerald-800 hover:underline"
                  >
                    <Mail className="size-3.5 shrink-0 text-slate-400" />
                    Add email
                  </button>
                )
              )}
              {(customer.address || customer.city) && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="size-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">
                    {[customer.address, customer.city].filter(Boolean).join(", ")}
                  </span>
                </span>
              )}
              {customer.kind === "doctor" && customer.specialty && (
                <span className="text-slate-500">{customer.specialty}</span>
              )}
              {customer.worksAt && customer.worksAtId && (
                <Link
                  to={`/customers/${customer.worksAtId}`}
                  className="font-medium text-emerald-800 hover:underline"
                >
                  Works at {customer.worksAt}
                </Link>
              )}
            </ContactLine>
          </>
        }
        right={
          <HeadBox
            cells={
              patient
                ? [
                    {
                      label: "Points",
                      value: data.points ? data.points.balance.toLocaleString("en-PH") : "—",
                    },
                    {
                      label: "Owed",
                      value: peso(totals.owed),
                      tone: totals.owed > 0 ? "bad" : undefined,
                    },
                    { label: "Paid", value: peso(totals.paid), tone: "good" },
                  ]
                : [
                    { label: "Pays", value: pays },
                    {
                      label: "Credit limit",
                      value: customer.creditLimit ? peso(customer.creditLimit) : "None",
                    },
                    {
                      label: "Credit left",
                      value: creditLeft === null ? "—" : peso(creditLeft),
                      tone: creditLeft !== null && creditLeft <= 0 ? "bad" : undefined,
                    },
                  ]
            }
            note={
              customer.review === "to_review" && can.manage ? (
                <Button
                  small
                  variant="primary"
                  onClick={review}
                  disabled={action.busy}
                  className="h-6 px-2 text-[11px]"
                >
                  <Check className="size-3.5" /> Mark checked
                </Button>
              ) : customer.licenceNo ? (
                <span className="truncate">
                  {customer.kind === "doctor" ? "PRC" : "LTO"} {customer.licenceNo}
                  {customer.licenceExpires
                    ? ` · valid until ${dayLabel(customer.licenceExpires)}`
                    : ""}
                </span>
              ) : (
                <span className="truncate text-slate-400">Customer no. {customer.code}</span>
              )
            }
          />
        }
      >
        <Glance
          title={patient ? "Their medicines and money" : "Their buying"}
          tiles={[
            {
              label: "Orders",
              value: count(totals.orders),
              sub: before?.orders
                ? `+ ${count(before.orders)} earlier${before.lastOn ? `, last ${day(before.lastOn)}` : ""}`
                : totals.lastOrderAt
                  ? `last ${day(totals.lastOrderAt)}`
                  : "none yet",
            },
            {
              label: "Bought",
              value: peso(totals.bought),
              sub: before?.bought ? `+ ${peso(before.bought)} earlier` : "all orders",
            },
            { label: "Paid", value: peso(totals.paid), tone: "good" },
            {
              label: "Owed now",
              value: peso(totals.owed),
              tone: totals.owed > 0 ? "warn" : undefined,
            },
            {
              label: "Overdue",
              value: peso(totals.overdue),
              tone: totals.overdue > 0 ? "bad" : undefined,
            },
            {
              label: "Medicines",
              value: count(data.medicines.length),
              sub: data.medicines[0] ? `latest ${data.medicines[0].name}` : undefined,
            },
          ]}
        />
      </RecordHead>
      <Problem message={action.problem?.message} />

      {/* Everything on one page, as the medicine page: their buying on the left, money, details
          and what happened on the right. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_34rem] flex-col gap-4">
          <Orders data={data} />
          <Medicines data={data} />
          <PricesGiven customerId={customer.id} />
          <Money data={data} />
          {data.cases && (patient || data.cases.length > 0) && <Cases data={data} />}
        </div>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-4">
          <SideCard title="Money">
            <SideRows
              rows={[
                ["Bought", peso(totals.bought)],
                ["Paid", peso(totals.paid), "good"],
                ["Overdue", peso(totals.overdue), totals.overdue > 0 ? "bad" : undefined],
                ["Owed now", peso(totals.owed), "strong"],
                ...(customer.creditLimit
                  ? ([
                      [
                        "Credit left",
                        peso(creditLeft ?? 0),
                        (creditLeft ?? 0) <= 0 ? "bad" : undefined,
                      ],
                    ] as [ReactNode, ReactNode, "bad" | undefined][])
                  : []),
              ]}
            />
            <Link
              to={`/customers/${customer.id}/statement`}
              className="mt-2 block w-full rounded-lg border border-slate-200 px-3 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Statement of account
            </Link>
            {can.credit && (
              <button
                type="button"
                onClick={() => setTermsOpen(true)}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Change terms or credit limit
              </button>
            )}
          </SideCard>
          {me && ["finance", "admin", "ceo", "management"].includes(me.role) && (
            <CreditCard customerId={customer.id} />
          )}
          <Details data={data} />
          {["hospital", "distributor", "drugstore"].includes(customer.kind) && (
            <LicencePapers data={data} />
          )}
          {customer.kind === "hospital" && <Doctors data={data} />}
          <FilesPanel customerId={customer.id} />
          <Link to={`/complaints?report=1&customer=${customer.id}`} className="text-sm font-semibold text-brand hover:underline">
            Report a complaint or side-effect for {customer.name}
          </Link>
          <Activity data={data} />
        </div>
      </div>

      {termsOpen && (
        <TermsDialog
          id={customer.id}
          name={customer.name}
          terms={customer.paymentTerms}
          days={customer.paymentDays}
          limit={customer.creditLimit}
          onClose={() => setTermsOpen(false)}
        />
      )}
      {editing && (
        <CustomerDialog
          can={can}
          kinds={data.kinds}
          detail={data}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

const PILL = "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold";
const statusTone = (status: string) =>
  status === "completed"
    ? "bg-emerald-50 text-emerald-700"
    : status === "cancelled"
      ? "bg-slate-100 text-slate-500"
      : status === "on_hold" || status === "exception"
        ? "bg-rose-50 text-rose-700"
        : "bg-sky-50 text-sky-700";
const invoiceTone = (tone: string) =>
  tone === "bad"
    ? "bg-rose-50 text-rose-700"
    : tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-600";

function Orders({ data }: { data: CustomerPage }) {
  return (
    <SectionPanel icon={ShoppingBag} title={`Orders · ${count(data.totals.orders)}`} flush>
      {data.orders.length === 0 ? (
        <div className="p-4 sm:p-5">
          <Nothing>No orders yet.</Nothing>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.orders.map((order) => (
            <li key={order.id}>
              <Link
                to={order.leadId ? `/leads/${order.leadId}` : `/orders/${order.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 sm:px-5"
              >
                <div className="w-28 shrink-0">
                  <div className="text-sm font-semibold text-slate-900">{order.code}</div>
                  <div className="text-[11px] text-slate-500">{day(order.at)}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-700">{order.medicines ?? "—"}</div>
                  <div className="text-[11px] text-slate-500">
                    MedRep {order.medrep}
                    {order.raisedBy !== order.medrep ? ` · placed by ${order.raisedBy}` : ""}
                  </div>
                </div>
                <span className="w-24 shrink-0 text-right text-sm font-semibold text-slate-900 tabular-nums">
                  {peso(order.total)}
                </span>
                <span className={`${PILL} ${statusTone(order.status)}`}>{order.statusLabel}</span>
                {order.invoice && (
                  <span className={`${PILL} ${invoiceTone(order.invoice.state.tone)}`}>
                    {order.invoice.state.word}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

function Medicines({ data }: { data: CustomerPage }) {
  return (
    <SectionPanel
      icon={PillIcon}
      title={`Medicines bought · ${count(data.medicines.length)}`}
      flush
    >
      {data.medicines.length === 0 ? (
        <div className="p-4 sm:p-5">
          <Nothing>Nothing bought yet.</Nothing>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2.5 sm:px-5">Medicine</th>
                <th className="px-3 py-2.5 text-right">Orders</th>
                <th className="px-3 py-2.5 text-right">Pieces</th>
                <th className="px-3 py-2.5 text-right">Last price</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 sm:px-5">Last bought</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.medicines.map((medicine) => (
                <tr key={medicine.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 sm:px-5">
                    <Link
                      to={`/medicines/${medicine.id}`}
                      className="font-semibold text-slate-900 hover:text-emerald-700"
                    >
                      {medicine.name}
                    </Link>
                    {medicine.strength && (
                      <span className="text-slate-500"> {medicine.strength}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{count(medicine.times)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {count(medicine.qty)}
                    {medicine.freeQty ? (
                      <span className="text-[11px] text-emerald-700">
                        {" "}
                        ({count(medicine.freeQty)} free)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {medicine.lastPrice !== null ? peso(medicine.lastPrice) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {peso(medicine.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 sm:px-5">{day(medicine.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionPanel>
  );
}

function Money({ data }: { data: CustomerPage }) {
  return (
    <>
      <SectionPanel icon={FileText} title={`Invoices · ${count(data.invoices.length)}`} flush>
        {data.invoices.length === 0 ? (
          <div className="p-4 sm:p-5">
            <Nothing>No invoices yet.</Nothing>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  to={`/invoices/${invoice.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="w-32 shrink-0">
                    <div className="text-sm font-semibold text-slate-900">{invoice.code}</div>
                    <div className="text-[11px] text-slate-500">
                      {dayLabel(invoice.issuedOn)} · {invoice.orderCode}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 text-xs text-slate-500">
                    Due {dayLabel(invoice.dueOn)}
                  </div>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-700">
                    {peso(invoice.total)}
                  </span>
                  <span
                    className={`w-24 text-right text-sm font-semibold tabular-nums ${invoice.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}
                  >
                    {invoice.balance > 0 ? peso(invoice.balance) : "Paid"}
                  </span>
                  <span className={`${PILL} ${invoiceTone(invoice.state.tone)}`}>
                    {invoice.state.word}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>
      <SectionPanel
        icon={Banknote}
        title={`Payments received · ${count(data.payments.length)}`}
        flush
      >
        {data.payments.length === 0 ? (
          <div className="p-4 sm:p-5">
            <Nothing>No payments yet.</Nothing>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5"
              >
                <span className="w-28 shrink-0 text-slate-500">{dayLabel(payment.paidOn)}</span>
                <span className="min-w-0 flex-1 text-slate-700">
                  {payment.methodLabel}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                  <span className="text-xs text-slate-400"> · by {payment.by}</span>
                </span>
                <Link
                  to={`/invoices/${payment.invoiceId}`}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  {payment.invoiceCode}
                </Link>
                <span className="w-24 text-right font-semibold text-emerald-700 tabular-nums">
                  {peso(payment.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>
    </>
  );
}

function Cases({ data }: { data: CustomerPage }) {
  const cases = data.cases ?? [];
  return (
    <SectionPanel icon={Inbox} title={`Enquiries · ${count(cases.length)}`} flush>
      {cases.length === 0 ? (
        <div className="p-4 sm:p-5">
          <Nothing>No enquiries on their number.</Nothing>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {cases.map((item) => (
            <li key={item.id}>
              <Link
                to={`/leads/${item.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 sm:px-5"
              >
                <div className="w-28 shrink-0">
                  <div className="text-sm font-semibold text-slate-900">{item.code}</div>
                  <div className="text-[11px] text-slate-500">{day(item.at)}</div>
                </div>
                <div className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {item.request ?? "—"}
                </div>
                {item.owner && <span className="text-xs text-slate-500">{item.owner}</span>}
                {item.orderCode && (
                  <span className={`${PILL} bg-sky-50 text-sky-700`}>{item.orderCode}</span>
                )}
                <span
                  className={`${PILL} ${item.state === "lost" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
                >
                  {item.state === "lost" ? "Lost" : "Open"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

function Doctors({ data }: { data: CustomerPage }) {
  return (
    <SectionPanel icon={Stethoscope} title={`Doctors here · ${count(data.doctors.length)}`} flush>
      {data.doctors.length === 0 ? (
        <div className="p-4 sm:p-5">
          <Nothing>No doctors linked to this hospital yet.</Nothing>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.doctors.map((doctor) => (
            <li key={doctor.id}>
              <Link
                to={`/customers/${doctor.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 sm:px-5"
              >
                <span className="font-semibold text-slate-900">{doctor.name}</span>
                {doctor.specialty && <span className="text-slate-500">{doctor.specialty}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

const PAPER_NAMES: { kind: CustomerPaperKind; label: string }[] = [
  { kind: "bir_2303", label: "BIR 2303" },
  { kind: "lto_permit", label: "LTO permit" },
  { kind: "business_permit", label: "Business permit" },
];

/** A licensed customer's papers (the hub's three) and what of its list is still missing:
 *  Management checks the customer with it; anyone who looks after it can add a paper. */
function LicencePapers({ data }: { data: CustomerPage }) {
  const queries = useQueryClient();
  const action = useAction();
  async function add(kind: CustomerPaperKind, file: File) {
    await action.run(async () => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      await api(`/api/customers/${data.customer.id}/papers`, { body: form });
    });
    await queries.invalidateQueries({ queryKey: ["customers"] });
  }
  return (
    <SectionPanel icon={Paperclip} title="Licence and papers">
      {data.missing.length > 0 ? (
        <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Missing:</b> {data.missing.join(", ")}
        </div>
      ) : (
        <div className="mb-2 text-xs text-good">Licence and papers complete.</div>
      )}
      <ul className="flex flex-col">
        {PAPER_NAMES.map((paper) => {
          const kept = data.papers.filter((one) => one.kind === paper.kind);
          const latest = kept.at(-1);
          return (
            <li
              key={paper.kind}
              className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block text-slate-900">{paper.label}</span>
                {latest && (
                  <a
                    href={`/api/customer-papers/${latest.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-brand hover:underline"
                  >
                    {latest.name} · {latest.by}, {timeLabel(latest.at)}
                  </a>
                )}
              </span>
              <label className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg px-2 text-xs font-semibold text-brand hover:bg-brand-tint">
                {latest ? "Add newer" : "Attach"}
                <input
                  type="file"
                  accept={PAPER_ACCEPT}
                  className="sr-only"
                  disabled={action.busy}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void add(paper.kind, chosen);
                    event.target.value = "";
                  }}
                />
              </label>
            </li>
          );
        })}
      </ul>
      <Problem message={action.problem?.message} />
    </SectionPanel>
  );
}

function Details({ data }: { data: CustomerPage }) {
  const { customer } = data;
  const rows: [string, ReactNode][] = [
    ["Customer no.", customer.code],
    ["Kind", data.kinds.find((entry) => entry.key === customer.kind)?.label ?? customer.kind],
    ["Phone", customer.phone],
    ["Email", customer.email],
    ["Address", customer.address],
    ["City", customer.city],
    [
      "Area",
      customer.area
        ? `${customer.area}${customer.channel ? ` · ${customer.channel}` : ""}`
        : "No area",
    ],
    ["MedRep", customer.medrep],
    ["Specialty", customer.specialty],
    ["Works at", customer.worksAt],
    [customer.kind === "doctor" ? "PRC licence" : "Licence to operate", customer.licenceNo],
    ["Licence owner", customer.licenceOwner],
    ["LTO type", customer.ltoType],
    ["Licence issued", customer.licenceIssued ? dayLabel(customer.licenceIssued) : null],
    ["Licence valid until", customer.licenceExpires ? dayLabel(customer.licenceExpires) : null],
    ["TIN", customer.tin],
    [
      "Pays",
      customer.paymentTerms === "days"
        ? `${customer.paymentDays} days after delivery`
        : customer.paymentTerms === "cod"
          ? "Cash on delivery"
          : "In advance",
    ],
    ["Credit limit", customer.creditLimit ? peso(customer.creditLimit) : null],
    ["Added by", `${customer.addedBy} · ${timeLabel(customer.addedAt)}`],
    ["Checked by", customer.reviewedBy],
    ["Note", customer.note],
  ];
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return (
    <SectionPanel icon={ClipboardList} title="Details">
      <dl className="flex flex-col">
        {shown.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-b-0"
          >
            <dt className="shrink-0 text-slate-500">{label}</dt>
            <dd className="min-w-0 text-right font-medium break-words text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </SectionPanel>
  );
}

function Activity({ data }: { data: CustomerPage }) {
  return (
    <SectionPanel icon={ActivityIcon} title="Activity on their orders">
      {data.events.length === 0 ? (
        <Nothing>Nothing yet.</Nothing>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.events.map((event) => (
            <li key={event.id} className="text-[13px] leading-snug">
              <div className="text-slate-700">
                <Link
                  to={`/orders/${event.orderId}`}
                  className="font-semibold text-slate-900 hover:text-emerald-700"
                >
                  {event.orderCode}
                </Link>{" "}
                {event.message}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {event.by} · {timeLabel(event.at)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionPanel>
  );
}

/** Finance or Management sets how a customer pays: in advance, on delivery, or on credit with its
 *  days, and the credit limit. New orders take these; placed orders keep theirs. */
function TermsDialog({
  id,
  name,
  terms,
  days,
  limit,
  onClose,
}: {
  id: number;
  name: string;
  terms: string;
  days: number | null;
  limit: number | null;
  onClose: () => void;
}) {
  const action = useAction();
  const queries = useQueryClient();
  const [paymentTerms, setTerms] = useState(terms || "advance");
  const [paymentDays, setDays] = useState(days ? String(days) : "30");
  const [credit, setCredit] = useState(limit ? String(limit / 100) : "");
  async function save() {
    const done = await action.run(() =>
      api(`/api/customers/${id}/credit`, {
        body: {
          paymentTerms,
          paymentDays: paymentTerms === "days" ? Number(paymentDays) || null : null,
          creditLimit: credit.trim() ? Math.round(Number(credit) * 100) : null,
        },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    }
  }
  const field =
    "h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-emerald-600 focus:outline-none";
  return (
    <Dialog
      title={`How ${name} pays`}
      sub="New orders take these; orders already placed keep their own."
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Payment terms</span>
          <select
            value={paymentTerms}
            onChange={(event) => setTerms(event.target.value)}
            className={field}
          >
            <option value="advance">Pays in advance</option>
            <option value="cod">Cash on delivery</option>
            <option value="days">On credit</option>
          </select>
        </label>
        {paymentTerms === "days" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Days to pay, from delivery</span>
            <input
              value={paymentDays}
              onChange={(event) => setDays(event.target.value)}
              inputMode="numeric"
              className={field}
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">
            Credit limit (₱, empty for none)
          </span>
          <input
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
            inputMode="decimal"
            className={field}
            placeholder="No limit"
          />
        </label>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={action.busy}>
            {action.busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The customer's credit: Zoho's open credit notes and money kept from a bill, used on an invoice
 *  by Finance (the order's Paid step). Shown only when there is some. */
function CreditCard({ customerId }: { customerId: number }) {
  const query = useQuery({
    queryKey: ["finance", "credit", customerId],
    queryFn: () => api<CustomerCredit>(`/api/customers/${customerId}/credit`),
  });
  const credit = query.data;
  if (!credit || credit.total === 0) return null;
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Credit · {peso(credit.total)}</h2>
      <p className="mt-0.5 text-[12px] text-slate-600">
        Theirs to use on an invoice (Finance, on the order's Paid step).
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-[13px]">
        {credit.sources.map((one) => (
          <li key={`${one.kind}:${one.id}`} className="flex justify-between gap-2">
            <span>
              {one.kind === "zoho" ? `Credit note ${one.number}` : `Kept from ${one.number}`}
              <span className="block text-[11px] text-slate-500">{dayLabel(one.day)}</span>
            </span>
            <b className="tabular-nums">{peso(one.left)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FILE_FROM: Record<CustomerFiles["files"][number]["source"], string> = {
  customer: "Customer's papers",
  order: "Order",
  case: "Online case",
  sample: "Samples given",
};
/** Every file about the customer in one list (ERP phase 4): their papers, their orders' papers,
 *  their cases' files, the doctor's acknowledgements of samples; each opens in a new tab. */
function FilesPanel({ customerId }: { customerId: number }) {
  const query = useQuery({
    queryKey: ["customers", "files", customerId],
    queryFn: () => api<CustomerFiles>(`/api/customers/${customerId}/files`),
  });
  const files = query.data?.files ?? [];
  return (
    <SectionPanel icon={Paperclip} title={`Files${files.length ? ` (${files.length})` : ""}`}>
      {!files.length && <p className="text-sm text-slate-500">{query.isPending ? "Reading…" : "No file yet."}</p>}
      <ul className="divide-y divide-slate-100">
        {files.slice(0, 50).map((file) => (
          <li key={file.url} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
            <a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-brand hover:underline">
              {file.name}
            </a>
            <span className="text-xs text-slate-500">
              {FILE_FROM[file.source]} · {file.kind.replace(/_/g, " ")}
              {file.record && file.link && (
                <>
                  {" · "}
                  <Link to={file.link} className="hover:underline">
                    {file.record}
                  </Link>
                </>
              )}{" "}
              · {file.by} · {new Date(file.at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}
