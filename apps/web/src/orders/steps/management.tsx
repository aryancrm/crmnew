// Management's step on an order's page (orders/order.tsx): its checks one at a time (RX and
// documents, medicines and price, stock and warehouse, customer and licence, approve), what each
// found, and Approve, Send back, Reject; the warehouse it ships from; the order's details.

import { DIVISIONS, PAYMENT_TERMS, SUB_DIVISIONS, termsOfLabel } from "@2mg/api/divisions";
import type { OrderAction, OrderDetail } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, PencilLine, TriangleAlert, Undo2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { CustomerStory } from "../../customers/prices";
import { ApproveDialog } from "../approve-dialog";
import { checksOf } from "../checks";
import { LinesEditor } from "../lines-editor";
import { useOrderAction } from "../parts";
import { manilaToday } from "../../team/range";
import { Button, count, dayLabel, INPUT, Problem, useAction } from "../../ui";
import { Fact, NextButton, short, StepPanel } from "./frame";
import { Lines } from "./lines";
import { Documents, PaperChips } from "./papers";

// ---------------------------------------------------------------- Management's checks

/** What Management goes through on an order, one step each (Aryan): each opens the part to look
 *  at, and the last approves it. */
export const CHECKS = [
  { key: "papers", label: "RX & documents" },
  { key: "price", label: "Medicines & price" },
  { key: "stock", label: "Stock & warehouse" },
  { key: "customer", label: "Customer & licence" },
  { key: "approve", label: "Approve" },
] as const;
/** A hospital's (or any business's) order: its documents, no prescription to check. */
export const checkLabel = (key: CheckKey, data: OrderDetail) =>
  key === "papers" && data.order.customerKind !== "patient" && !data.order.patientOrder
    ? "Documents"
    : (CHECKS.find((item) => item.key === key)?.label ?? key);
export type CheckKey = (typeof CHECKS)[number]["key"];

/** How each check stands on this order: fine, or what needs a look. */
export function checkStates(data: OrderDetail): Record<CheckKey, { ok: boolean; note: string }> {
  const list = checksOf({
    findings: data.findings,
    papers: data.papers.map((paper) => paper.kind),
    customerKind: data.order.customerKind,
    patientOrder: data.order.patientOrder,
    items: data.items,
    manual: true,
    papersCheckedAt: data.order.papersCheckedAt,
    papersCheckedBy: data.order.papersCheckedBy,
  });
  const of = (key: string) => list.find((one) => one.key === key);
  const state = (keys: string[], fine: string) => {
    const warn = keys.map(of).find((one) => one?.tone === "warn");
    return warn ? { ok: false, note: warn.label } : { ok: true, note: fine };
  };
  return {
    price: state(["price", "note"], of("price")?.label ?? "Price OK"),
    stock: state(["stock"], "In stock"),
    customer: state(["customer"], "Customer OK"),
    papers: (() => {
      // The papers this buyer is expected to send, read from what is on file.
      const missing = data.paperList.filter(
        (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
      );
      if (missing.length)
        return { ok: false, note: `No ${missing.map((row) => row.label).join(", ")}` };
      // On file but not read by a person yet: to check, never fine by itself (Aryan, 19 Nov).
      const paper = of("paper");
      if (paper?.tone === "warn") return { ok: false, note: paper.label };
      return { ok: true, note: paper?.label ?? (data.papers.length ? "Papers checked" : "No papers to read") };
    })(),
    approve: { ok: false, note: "Your step" },
  };
}

/** What the MedRep sent, in one line, with the form to complete it folded until it is wanted. */
function DetailsLine({ data }: { data: OrderDetail }) {
  const { order } = data;
  const [open, setOpen] = useState(false);
  const facts = [
    order.division ? [order.division, order.subDivision].filter(Boolean).join(" · ") : null,
    order.paymentTerm,
    order.deliveryAddress,
    order.expectedOn ? `wanted ${dayLabel(order.expectedOn)}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 text-slate-700">
          <span className="font-semibold text-slate-600">Details</span>{" "}
          {facts.length ? facts.join(" · ") : "Division, payment terms and delivery not filled yet"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 font-semibold text-emerald-700 hover:underline"
        >
          {open ? "Close" : "Edit details"}
        </button>
      </div>
      {open && <CompleteDetails data={data} />}
    </div>
  );
}

/** Where the order ships from, as Management picks it: each warehouse with whether it can fill
 *  every line, else what it is short of (as the hub's approve-and-check-stock did). */
function ShipsFrom({
  fill,
  value,
  onChange,
}: {
  fill: NonNullable<OrderDetail["warehouseFill"]>;
  value: string;
  onChange: (value: string) => void;
}) {
  const picked = value || String(fill.find((place) => place.isDefault)?.id ?? fill[0]?.id ?? "");
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[12px] font-semibold text-slate-600">Ships from</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {fill.map((place) => {
          const chosen = String(place.id) === picked;
          const fills = place.short.length === 0;
          return (
            <label
              key={place.id}
              className={`flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] ${
                chosen
                  ? "border-emerald-400 bg-emerald-50/60 ring-1 ring-emerald-300"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="ships-from"
                checked={chosen}
                onChange={() => onChange(place.isDefault ? "" : String(place.id))}
                className="mt-0.5 accent-emerald-600"
              />
              <span className="min-w-0">
                <span className="font-semibold text-slate-900">
                  {place.name}
                  {place.isDefault && (
                    <span className="ml-1.5 text-[11px] font-medium text-slate-500">main</span>
                  )}
                </span>
                <span className={`block text-xs ${fills ? "text-emerald-700" : "text-amber-800"}`}>
                  {fills
                    ? "Can fill every line"
                    : place.short
                        .map(
                          (one) =>
                            `${one.medicine}: needs ${count(one.need)}, has ${count(one.have)}`,
                        )
                        .join(" · ")}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The buyer's licence (a hospital's or drugstore's LTO, a doctor's PRC), its expiry and TIN, with
 *  what is missing in amber and a way to fill it on the customer. A patient needs none. */
function LicenceFacts({ order }: { order: OrderDetail["order"] }) {
  if (order.customerKind === "patient") return null;
  const name = order.customerKind === "doctor" ? "PRC licence" : "LTO number";
  const today = manilaToday();
  const expired = Boolean(order.licenceExpires && order.licenceExpires < today);
  // A hospital, distributor or drugstore: the hub's whole list (licence and the three papers).
  const missing = ["hospital", "distributor", "drugstore"].includes(order.customerKind)
    ? order.customerMissing
    : [
        order.licenceNo ? null : name,
        order.customerKind !== "doctor" && !order.licenceExpires ? "licence expiry" : null,
        order.tin ? null : "TIN",
      ].filter(Boolean);
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[13px] ${
        expired || missing.length
          ? "border-transparent bg-slate-50 text-slate-800"
          : "border-slate-200 text-slate-700"
      }`}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <span className="text-slate-500">{name}:</span> <b>{order.licenceNo ?? "—"}</b>
        </span>
        {order.customerKind !== "doctor" && (
          <span>
            <span className="text-slate-500">Expires:</span>{" "}
            <b className={expired ? "text-rose-700" : ""}>
              {order.licenceExpires ? dayLabel(order.licenceExpires) : "—"}
              {expired ? " (expired)" : ""}
            </b>
          </span>
        )}
        <span>
          <span className="text-slate-500">TIN:</span> <b>{order.tin ?? "—"}</b>
        </span>
      </div>
      {missing.length > 0 && (
        <Link
          to={`/customers/${order.customerId}`}
          className="text-xs font-semibold text-amber-700 underline"
        >
          Missing {missing.join(", ")}: fill it on the customer
        </Link>
      )}
    </div>
  );
}

export function ManagementStep({
  data,
  act,
  onAsk,
  next,
  check,
  onCheck,
  states,
  autoApprove = false,
}: {
  data: OrderDetail;
  act: ReturnType<typeof useOrderAction>;
  onAsk: (action: OrderAction) => void;
  next: () => void;
  /** The check being gone through (Management, while it waits); none = everything at once. */
  check?: CheckKey;
  onCheck?: (key: CheckKey) => void;
  states?: Record<CheckKey, { ok: boolean; note: string }>;
  /** Opened from a card's Approve: the approve window opens at once. */
  autoApprove?: boolean;
}) {
  const { order, can } = data;
  const shows = (key: CheckKey) => !check || check === key;
  const at = check ? CHECKS.findIndex((item) => item.key === check) : -1;
  const after = at >= 0 ? CHECKS[at + 1] : undefined;
  const findingsOf = (kinds: string[]) =>
    data.findings.filter((finding) => !check || kinds.includes(finding.kind));
  const shownFindings = !check
    ? data.findings
    : check === "price"
      ? findingsOf(["price", "note"])
      : check === "stock"
        ? findingsOf(["stock"])
        : check === "customer"
          ? findingsOf(["customer", "licence", "owes", "credit"])
          : check === "papers"
            ? findingsOf(["rx"])
            : data.findings;
  // Where it ships from: the default warehouse, unless only another can fill every line.
  const [warehouse, setWarehouse] = useState(() => {
    const fill = data.warehouseFill ?? [];
    const main = fill.find((place) => place.isDefault);
    const fills = fill.find((place) => place.short.length === 0);
    return main && main.short.length > 0 && fills ? String(fills.id) : "";
  });
  // Management decides here whether Finance checks the order too.
  const [approving, setApproving] = useState(autoApprove && data.can.approve);
  const [editing, setEditing] = useState(false);
  const waiting = order.status === "pending_approval";
  // Management completes what the MedRep sent before approving it.
  const completes = can.approve || (can.resume && order.heldRole === "management");
  return (
    <StepPanel
      number={check ? at + 1 : 2}
      title={check ? checkLabel(check, data) : "Management check"}
      footer={
        order.approvedAt ? (
          <NextButton label="Next: Finance check" onClick={next} />
        ) : check && after && onCheck ? (
          <NextButton label={`Next: ${after.label}`} onClick={() => onCheck(after.key)} />
        ) : undefined
      }
    >
      {check && check !== "approve" && states ? (
        <Fact shape={states[check].ok ? "done" : "now"}>
          <b>{states[check].note}</b>
        </Fact>
      ) : order.approvedAt ? (
        order.approvedBy ? (
          <Fact shape="done" note={short(order.approvedAt)}>
            <b>Approved</b> by {order.approvedBy}
            {order.warehouse ? ` · ships from ${order.warehouse}` : ""}
          </Fact>
        ) : (
          <Fact shape="skipped" note="no discount, no credit">
            <b>Not needed</b> · it went straight on
          </Fact>
        )
      ) : waiting ? (
        <Fact shape="now">
          <b>
            Waiting for {order.approverName ? `${order.approverName} (PAP head)` : "Management"}
          </b>
        </Fact>
      ) : order.status === "draft" ? (
        <Fact shape="stopped">
          <b>Sent back</b> · {order.flagReason ?? "fix it and place it again"}
        </Fact>
      ) : null}
      {shownFindings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-800">
          {shownFindings.map((finding) => (
            <li key={finding.text} className="flex gap-2">
              <TriangleAlert
                size={15}
                className="mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>{finding.text}</span>
            </li>
          ))}
        </ul>
      )}
      {editing && check === "price" ? (
        <LinesEditor data={data} onDone={() => setEditing(false)} />
      ) : (
        (shows("price") || shows("stock")) && (
          <>
            {/* An Online order's prices are the case's quotation: one click to it as the agent made it. */}
            {order.via && order.leadId && check === "price" && (
              <div className="rounded-xl bg-violet-50 px-3 py-2 text-[13px] text-violet-900">
                Priced as quoted on the Online case {order.via.code} ({order.via.source}).{" "}
                <Link to={`/leads/${order.leadId}?step=quote`} className="font-semibold underline">
                  Open the quotation
                </Link>
              </div>
            )}
            <Lines data={data} compare />
            {can.approve && check === "price" && (
              <div>
                <Button small onClick={() => setEditing(true)}>
                  <PencilLine size={14} aria-hidden="true" /> Edit medicines · add, free, price
                </Button>
              </div>
            )}
          </>
        )
      )}
      {/* What Management checks besides the price: the buyer's licence and the papers. */}
      {shows("customer") && <CustomerStory orderId={order.id} name={order.customer} />}
      {shows("customer") && <LicenceFacts order={order} />}
      {check === "papers" ? (
        <Documents data={data} />
      ) : (
        !check && <PaperChips data={data} kinds={["po", "prescription", "gl", "payment_proof"]} />
      )}
      {(shows("customer") || check === "approve") && completes && <DetailsLine data={data} />}
      {(shows("stock") || check === "approve") &&
        can.approve &&
        data.warehouseFill &&
        data.warehouseFill.length > 0 && (
          <ShipsFrom fill={data.warehouseFill} value={warehouse} onChange={setWarehouse} />
        )}
      {check === "approve" && states && (
        <ul className="flex flex-col gap-1 text-[13px]">
          {CHECKS.filter((item) => item.key !== "approve").map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onCheck?.(item.key)}
                className="flex items-center gap-2 text-left hover:underline"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${states[item.key].ok ? "bg-emerald-500" : "bg-amber-400"}`}
                  aria-hidden="true"
                />
                <span className="font-semibold text-slate-800">{item.label}</span>
                <span className="text-slate-500">· {states[item.key].note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {can.approve && shows("approve") && (
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="primary" disabled={act.busy} onClick={() => setApproving(true)}>
            <CircleCheck size={16} aria-hidden="true" /> Approve
          </Button>
          {can.send_back && (
            <Button disabled={act.busy} onClick={() => onAsk("send_back")}>
              <Undo2 size={16} aria-hidden="true" /> Send back
            </Button>
          )}
          {can.reject && (
            <Button variant="danger" disabled={act.busy} onClick={() => onAsk("reject")}>
              <CircleX size={16} aria-hidden="true" /> Reject
            </Button>
          )}
        </div>
      )}
      {approving && (
        <ApproveDialog
          data={data}
          initial={warehouse}
          busy={act.busy}
          problem={act.problem?.message ?? null}
          onClose={() => setApproving(false)}
          onApprove={async (choice) => {
            if (await act.act(order.id, "approve", choice)) setApproving(false);
          }}
        />
      )}
    </StepPanel>
  );
}

/** What a Payment Term means for the money: paid first, on delivery, or credit for some days. */
function termWords(label: string): string {
  const { terms, days } = termsOfLabel(label);
  return terms === "advance"
    ? "Paid before it goes out"
    : terms === "cod"
      ? "Cash on delivery"
      : `Credit: paid ${days} days after delivery`;
}

/** What the MedRep sent, for Management to complete before approving: the Division and
 *  Sub-division, the Payment Terms, who receives it and where, the day, the PO, the company that
 *  bills it and the remarks. */
function CompleteDetails({ data }: { data: OrderDetail }) {
  const { order } = data;
  const queries = useQueryClient();
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState({
    division: order.division ?? "",
    subDivision: order.subDivision ?? "",
    paymentTerm: order.paymentTerm ?? "",
    receiver: order.receiver ?? "",
    receiverPhone: order.receiverPhone ?? "",
    deliveryAddress: order.deliveryAddress ?? "",
    expectedOn: order.expectedOn ?? "",
    customerPo: order.customerPo ?? "",
    invoiceFrom: order.invoiceFrom as string,
    note: order.note ?? "",
  });
  const set = (key: keyof typeof value, to: string) => {
    setSaved(false);
    setValue({ ...value, [key]: to });
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await action.run(async () => api(`/api/orders/${order.id}/details`, { body: value }))) {
      setSaved(true);
      await queries.invalidateQueries({ queryKey: ["orders"] });
    }
  }
  const input = (
    key: keyof typeof value,
    label: string,
    more: { list?: string; type?: string; wide?: boolean; placeholder?: string } = {},
  ) => (
    <label className={`flex flex-col gap-1 ${more.wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] font-semibold text-slate-600">{label}</span>
      <input
        type={more.type ?? "text"}
        list={more.list}
        value={value[key]}
        placeholder={more.placeholder}
        onChange={(event) => set(key, event.target.value)}
        className={INPUT}
      />
      {action.at(key) && <span className="text-xs text-rose-700">{action.at(key)}</span>}
    </label>
  );
  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
    >
      <div className="text-[13px] font-semibold text-ink">Complete the order</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-slate-600">Division</span>
          <select
            value={value.division}
            onChange={(event) =>
              setValue({ ...value, division: event.target.value, subDivision: "" })
            }
            className={INPUT}
          >
            <option value="">-- Not set --</option>
            {DIVISIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {(SUB_DIVISIONS[value.division] ?? []).length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-slate-600">Sub-division</span>
            <select
              value={value.subDivision}
              onChange={(event) => set("subDivision", event.target.value)}
              className={INPUT}
            >
              <option value="">-- Not set --</option>
              {[
                ...(value.subDivision &&
                !(SUB_DIVISIONS[value.division] ?? []).includes(value.subDivision)
                  ? [value.subDivision]
                  : []),
                ...(SUB_DIVISIONS[value.division] ?? []),
              ].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          input("subDivision", "Sub-division", { placeholder: "The area within the Division" })
        )}
        <p className="-mt-1 text-[11px] text-slate-500 sm:col-span-2">
          Division: the selling team the order counts for (HOS hospitals; B&amp;B, STC, URO the Rx
          field teams; B2B distributors; BID government tenders; MD Telesales the doctors'
          patients). Sub-division: the area within it.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-slate-600">Payment terms</span>
          <select
            value={value.paymentTerm}
            onChange={(event) => set("paymentTerm", event.target.value)}
            className={INPUT}
          >
            <option value="">-- Not set --</option>
            {[
              ...(value.paymentTerm && !PAYMENT_TERMS.includes(value.paymentTerm as never)
                ? [value.paymentTerm]
                : []),
              ...PAYMENT_TERMS,
            ].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {value.paymentTerm && (
            <span className="text-[11px] text-slate-500">{termWords(value.paymentTerm)}</span>
          )}
          {action.at("paymentTerm") && (
            <span className="text-xs text-rose-700">{action.at("paymentTerm")}</span>
          )}
        </label>
        {input("expectedOn", "Expected shipment date", { type: "date" })}
        {input("receiver", "Receiver")}
        {input("receiverPhone", "Receiver's contact")}
        {input("deliveryAddress", "Delivery address", { wide: true })}
        {input("customerPo", "Customer's PO")}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-slate-600">Invoicing from</span>
          <select
            value={value.invoiceFrom}
            onChange={(event) => set("invoiceFrom", event.target.value)}
            className={INPUT}
          >
            <option value="2mg">2MG Inc.</option>
            <option value="getmeds">GetMeds Philippines Inc.</option>
          </select>
        </label>
        {input("note", "Customer remarks", { wide: true })}
      </div>
      <Problem message={action.general(Object.keys(value))} />
      <div className="flex items-center gap-3">
        <Button type="submit" small disabled={action.busy}>
          {action.busy ? "Saving…" : "Save the details"}
        </Button>
        {saved && <span className="text-[13px] font-medium text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}
