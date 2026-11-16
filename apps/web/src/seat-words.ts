// A seat's own words, by its channel: the desk's name on top ("Hospital CHC", not "MedRep") and
// what its customers are called on its pages ("My hospitals", "Hospitals to call"). Filled one
// channel at a time (docs/PLAN.md section 16); a channel not done yet keeps the plain words.

import type { Me } from "@2mg/api/types";

type Words = { desk: string; customers: string; myCustomers: string; toCall: string };
type Person = Pick<Me, "role" | "roleLabel" | "channel" | "title" | "business">;

const HOSPITAL: Record<string, string> = {
  medrep: "Hospital CHC",
  team_lead: "District Sales Coach",
  manager: "Business Mentor",
};

const RX: Record<string, string> = {
  medrep: "Rx CHC",
  team_lead: "District Sales Coach",
  manager: "Country Mentor",
};

/** MD Telesales Oncology and their coach (the Prescription Business). */
const TS: Record<string, string> = {
  medrep: "MD Telesales",
  // "Sales Coach (Onco-Hema)" on the chart: MD Telesales and the B2C CHCs under them.
  team_lead: "Sales Coach",
};

/** NBD or CRR inside B2B Telesales, by the seat's title as the chart names them. */
export const b2bRole = (me: Pick<Me, "role" | "title" | "channel"> | null | undefined) =>
  me?.role !== "medrep" || me.channel?.code !== "B2B"
    ? null
    : /\bNBD\b|New Business/i.test(me.title ?? "")
      ? "nbd"
      : /\bCRR\b|Retention/i.test(me.title ?? "")
        ? "crr"
        : /CLIDP/i.test(me.title ?? "")
          ? "clidp"
          : null;

const B2B: Record<string, string> = {
  team_lead: "B2B Sales Coach",
  manager: "Sales & Marketing Mentor",
};

export function seatWords(me: Person | null | undefined): Words {
  const plain = { desk: me?.roleLabel ?? "", customers: "customers", myCustomers: "My area", toCall: "Customers to call" };
  if (!me) return plain;
  // The Hospital Division's Government Account box: a government bidding coachee, not a CHC.
  if (me.channel?.code === "HOSP" && me.role === "medrep" && /bidding/i.test(me.title ?? ""))
    return { desk: "Government Account", customers: "hospitals", myCustomers: "My hospitals", toCall: "Hospitals to call" };
  if (me.channel?.code === "HOSP" && HOSPITAL[me.role])
    return { desk: HOSPITAL[me.role] as string, customers: "hospitals", myCustomers: "My hospitals", toCall: "Hospitals to call" };
  // Government Bidding (Sales and Marketing): its Admin, coachees and CHC.
  if (me.channel?.code === "BID")
    return { desk: me.role === "team_lead" ? "Government Bidding Admin" : "Government Bidding", customers: "agencies", myCustomers: "Agencies", toCall: "Agencies to call" };
  // The Online desk: the B2C CHC (the desk role, or the Online channel's MedRep).
  if (me.role === "online" || (me.role === "medrep" && me.channel?.code === "ONLINE"))
    return { desk: "B2C CHC", customers: "patients", myCustomers: "My patients", toCall: "Refills due" };
  // Telesales by their box on the chart: the Hospital Division's sell anesthesia to hospitals and
  // doctors; the Prescription Business's (oncology) work patients' refills and care groups.
  if (me.channel?.code === "TS" && me.role === "medrep" && me.business === "HOSP")
    return { desk: "MD Telesales – Anesthesia", customers: "hospitals and doctors", myCustomers: "My customers", toCall: "Customers to call" };
  if (me.channel?.code === "TS" && me.business === "RX" && TS[me.role])
    return { desk: TS[me.role] as string, customers: "patients and doctors", myCustomers: "My patients", toCall: "Refills due" };
  const b2b = b2bRole(me);
  if (b2b)
    return {
      desk: b2b === "nbd" ? "NBD · New Business" : b2b === "crr" ? "CRR · Retention & Reorder" : "CLIDP Sales Coach",
      customers: "accounts",
      myCustomers: "My accounts",
      toCall: "Accounts to call",
    };
  if (me.channel?.code === "B2B" && B2B[me.role])
    return { desk: B2B[me.role] as string, customers: "accounts", myCustomers: "Accounts", toCall: "Accounts to call" };
  if (me.channel?.code === "RX" && RX[me.role])
    return { desk: RX[me.role] as string, customers: "doctors", myCustomers: "My doctors", toCall: "Doctors to call" };
  return plain;
}
