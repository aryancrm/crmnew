// A seat's own words, by its channel: the desk's name on top ("Hospital CHC", not "MedRep") and
// what its customers are called on its pages ("My hospitals", "Hospitals to call"). Filled one
// channel at a time (docs/PLAN.md section 16); a channel not done yet keeps the plain words.

import type { Me } from "@2mg/api/types";

type Words = { desk: string; customers: string; myCustomers: string; toCall: string };

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

const TS: Record<string, string> = {
  medrep: "MD Telesales",
  team_lead: "Telesales Coach",
};

export function seatWords(me: Pick<Me, "role" | "roleLabel" | "channel"> | null | undefined): Words {
  const plain = { desk: me?.roleLabel ?? "", customers: "customers", myCustomers: "My area", toCall: "Customers to call" };
  if (!me) return plain;
  if (me.channel?.code === "HOSP" && HOSPITAL[me.role])
    return { desk: HOSPITAL[me.role] as string, customers: "hospitals", myCustomers: "My hospitals", toCall: "Hospitals to call" };
  if (me.channel?.code === "TS" && TS[me.role])
    return { desk: TS[me.role] as string, customers: "patients and doctors", myCustomers: "My patients", toCall: "Refills due" };
  if (me.channel?.code === "RX" && RX[me.role])
    return { desk: RX[me.role] as string, customers: "doctors", myCustomers: "My doctors", toCall: "Doctors to call" };
  return plain;
}
