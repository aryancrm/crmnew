// Which box of the chart a person works in, beyond their channel: the same channel can sit in two
// businesses with different work. Telesales (TS) inside the Prescription Business are MD Telesales
// Oncology (care groups, patients' refills, the sales target of the Rx business); telesales inside
// the Hospital Division are MD Telesales Anesthesia (hospitals and doctors, by phone).

import type { Me } from "../types";

type Person = Pick<Me, "role" | "channel" | "business">;

/** MD Telesales Oncology: telesales of the Prescription Business. */
export const rxTelesales = (me: Person) => me.role === "medrep" && me.channel?.code === "TS" && me.business === "RX";

/** MD Telesales Anesthesia: telesales of the Hospital Division. */
export const hospitalTelesales = (me: Person) => me.role === "medrep" && me.channel?.code === "TS" && me.business === "HOSP";
