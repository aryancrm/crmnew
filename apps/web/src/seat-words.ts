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

/** The channel a person's pages name (Aryan, 22 Nov: one list of channels, the target sheet's):
 *  the sheet's channel of each of their seats (CLIDP, MD Telesales, RX Business…), the main seat's
 *  first; PAP keeps PAP (on no row of the sheet); with no seat, their first channel's code. Which
 *  screens they get is still decided by the seat, never by this word. */
export const shownChannel = (me: Pick<Me, "channel" | "divisions"> | null | undefined): string | null =>
  !me ? null : me.channel?.code === "PAP" ? "PAP" : me.divisions?.length ? me.divisions.join(" · ") : (me.channel?.code ?? null);

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
  // The office staff (Digital Marketing, IT): their desk is their job title on the chart.
  if (me.role === "staff") return { ...plain, desk: me.title ?? me.roleLabel };
  // In-licensing & Regulatory: the seat's team.
  if (me.role === "regulatory") return { ...plain, desk: /in-?licens/i.test(me.title ?? "") ? "In-licensing" : "Regulatory Affairs" };
  // The Hospital Division's Government Account box: a government bidding coachee, not a CHC.
  if (me.channel?.code === "HOSP" && me.role === "medrep" && /bidding/i.test(me.title ?? ""))
    return { desk: "Government Account", customers: "hospitals", myCustomers: "My hospitals", toCall: "Hospitals to call" };
  if (me.channel?.code === "HOSP" && HOSPITAL[me.role])
    return { desk: HOSPITAL[me.role] as string, customers: "hospitals", myCustomers: "My hospitals", toCall: "Hospitals to call" };
  // Modern Trade: the COO looks after the pharmacy chains herself.
  if (me.channel?.code === "MT")
    return { desk: "Modern Trade · COO", customers: "chains", myCustomers: "Chains", toCall: "Chains to call" };
  // Government Bidding (Sales and Marketing): its Admin, coachees and CHC.
  // The PAP officer: patients' guarantee-letter cases (19 Nov: each seat named by its own work).
  if (me.channel?.code === "PAP" && me.role === "medrep")
    return { desk: "Patient Assistance (PAP)", customers: "patients", myCustomers: "My patients", toCall: "Patients to call" };
  if (me.channel?.code === "BID")
    return { desk: me.role === "team_lead" ? "Government Bidding Admin" : "Government Bidding", customers: "agencies", myCustomers: "Agencies", toCall: "Agencies to call" };
  // The Online desk (the desk role, or the Online channel's MedRep): its people work in Online
  // (Aryan, 19 Nov: Mary Jane's top bar said "B2C CHC", her seat's old name on the chart).
  if (me.role === "online" || (me.role === "medrep" && me.channel?.code === "ONLINE"))
    return { desk: "Online desk", customers: "patients", myCustomers: "My patients", toCall: "Refills due" };
  // Telesales by their box on the chart: the Hospital Division's sell anesthesia to hospitals and
  // doctors; the Prescription Business's (oncology) work patients' refills and care groups.
  // Their coach (Hospital Division › TeleSales): the team's desk, named as the chart names it.
  if (me.channel?.code === "TS" && me.role === "team_lead" && me.business === "HOSP")
    return { desk: "Sales Coach – TeleSales", customers: "hospitals and doctors", myCustomers: "Customers", toCall: "Customers to call" };
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
