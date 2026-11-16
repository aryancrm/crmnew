// The selling side of the 2026 org chart (HR, 10 Oct 2026; docs/company-map.html), as units and
// seats for the CRM. Seats come in empty: HR puts each person in their seat. A selling seat gets
// its own area, so the customers it looks after can be put under it; a hospital territory's
// area lists its cities. The support departments are set up from the Admin panel.

import type { Role } from "../people/roles";
import type { OrgUnitKind } from "../types";

export type ChartSeat = {
  title: string;
  module: Role;
  lead?: boolean;
  /** How many such seats. */
  n?: number;
  /** The seat's own area: its name (numbered when n > 1) and, for a territory, its cities. */
  area?: string;
  cities?: string[];
};
export type ChartUnit = {
  name: string;
  kind: OrgUnitKind;
  /** The channel its orders and areas belong to (a code: HOSP, RX…). */
  channel: string | null;
  seats: ChartSeat[];
  units?: ChartUnit[];
};

const chc = (places: string, cities?: string[]): ChartSeat => ({
  title: `CHC – ${places}`,
  module: "medrep",
  area: places,
  cities: cities ?? places.split(/,\s*/),
});

export const CHART_2026: ChartUnit[] = [
  {
    name: "Hospital Division",
    kind: "business",
    channel: "HOSP",
    seats: [{ title: "Business Mentor", module: "manager", lead: true }],
    units: [
      {
        name: "NCR 1", kind: "team", channel: "HOSP",
        seats: [{ title: "District Sales Coach – NCR 1", module: "team_lead", lead: true }, chc("Pasay, Manila"), chc("Las Piñas, Taguig"), chc("Parañaque"), chc("Palawan")],
      },
      {
        name: "NCR 2", kind: "team", channel: "HOSP",
        seats: [{ title: "District Sales Coach – NCR 2", module: "team_lead", lead: true }, chc("Quezon City"), chc("Camanava, Bulacan", ["Caloocan", "Malabon", "Navotas", "Valenzuela", "Bulacan"]), chc("Marikina, Pasig"),
          // On the chart without a territory yet (Jomari Esguerra).
          { title: "Customer Happiness Coachee – NCR 2", module: "medrep" }],
      },
      {
        name: "North & Central Luzon", kind: "team", channel: "HOSP",
        seats: [
          { title: "District Sales Coach – North & Central Luzon", module: "team_lead", lead: true },
          chc("Tuguegarao, Isabela"), chc("Cabanatuan, Nueva Ecija, Tarlac"), chc("Baguio, Ilocos, La Union"), chc("Pampanga, Bataan, Zambales"),
        ],
      },
      {
        name: "South Luzon", kind: "team", channel: "HOSP",
        // Laguna is in two territories on the chart; a city belongs to one area, so it stays with the first.
        seats: [{ title: "District Sales Coach – South Luzon", module: "team_lead", lead: true }, chc("Bicol"), chc("Laguna, Batangas"), chc("Cavite, Laguna", ["Cavite"]), chc("Quezon Province, Mindoro")],
      },
      {
        // No coach on the chart: its CHCs report to the Business Mentor.
        name: "Visayas", kind: "team", channel: "HOSP",
        seats: [chc("Cebu South, Dumaguete"), chc("Cebu North, Bohol"), chc("Iloilo, Bacolod, Roxas")],
      },
      {
        name: "Mindanao", kind: "team", channel: "HOSP",
        seats: [
          { title: "District Sales Coach – Mindanao", module: "team_lead", lead: true },
          chc("Gen San, South Cotabato", ["General Santos", "South Cotabato"]), chc("Davao North"), chc("Cagayan de Oro, Butuan, Iligan"), chc("Davao South"), chc("Zamboanga, Pagadian, Dipolog"),
        ],
      },
      { name: "Government Account", kind: "team", channel: "HOSP", seats: [{ title: "Government Bidding Coachee", module: "medrep", area: "Government Account" }] },
      { name: "MD Telesales Anesthesia", kind: "team", channel: "TS", seats: [{ title: "MD Telesales – Anesthesia", module: "medrep", n: 5, area: "Telesales Anesthesia" }] },
      { name: "Patient Assistance Program", kind: "team", channel: "PAP", seats: [{ title: "Patient Assistance Program Officer", module: "medrep", area: "Patient Assistance" }] },
    ],
  },
  {
    name: "Prescription Business",
    kind: "business",
    channel: "RX",
    seats: [{ title: "PX Country Mentor", module: "manager", lead: true }],
    units: [
      {
        // Uro & Onco Care and Blood & Bone Care work the same way: one team (Aryan, 16 Nov).
        name: "Onco-Hema Division", kind: "line", channel: "RX",
        seats: [
          { title: "Rx CHC – NCR 1", module: "medrep", area: "Rx NCR 1", cities: [] },
          { title: "Rx CHC – NCR 2", module: "medrep", n: 2, area: "Rx NCR 2", cities: [] },
          { title: "Rx CHC – North & Central Luzon", module: "medrep", area: "Rx North & Central Luzon", cities: [] },
          { title: "Rx CHC – South Luzon", module: "medrep", n: 2, area: "Rx South Luzon", cities: [] },
          { title: "Rx CHC – Cebu", module: "medrep", n: 2, area: "Rx Cebu", cities: [] },
          { title: "Rx CHC – Davao", module: "medrep", area: "Rx Davao", cities: [] },
          { title: "Rx CHC – Blood & Bone", module: "medrep", n: 2, area: "Rx Blood & Bone", cities: [] },
        ],
        // On the chart MD Telesales Oncology hangs inside the Onco-Hema Division, beside Uro & Onco
        // Care and Blood & Bone Care; the B2C Sales Coaching Department hangs under it.
        units: [
          {
            name: "MD Telesales Oncology", kind: "line", channel: "TS",
            seats: [{ title: "Sales Coach – MD Telesales", module: "team_lead", lead: true }, { title: "MD Telesales – Oncology", module: "medrep", n: 4, area: "Telesales Oncology" }],
            units: [{ name: "B2C Sales Coaching", kind: "team", channel: "ONLINE", seats: [{ title: "B2C CHC", module: "online", n: 2 }] }],
          },
        ],
      },
    ],
  },
  {
    name: "Sales and Marketing",
    kind: "business",
    channel: "B2B",
    seats: [{ title: "Sales and Marketing Mentor", module: "manager", lead: true }],
    units: [
      { name: "CLIDP", kind: "line", channel: "B2B", seats: [{ title: "CLIDP Sales Coach", module: "medrep", n: 2, area: "CLIDP" }] },
      {
        name: "Government Bidding", kind: "line", channel: "BID",
        seats: [
          { title: "Government Bidding Admin", module: "team_lead", lead: true },
          { title: "Government Bidding Coachee", module: "medrep", n: 2, area: "Bidding" },
          { title: "Bidding CHC", module: "medrep", area: "Bidding CHC" },
        ],
      },
      {
        name: "B2B Telesales", kind: "line", channel: "B2B",
        seats: [{ title: "B2B Sales Coach", module: "team_lead", lead: true }, { title: "B2B District Sales Coach – Mindanao", module: "team_lead" }],
        units: [
          { name: "Client Retention & Reorder", kind: "team", channel: "B2B", seats: [{ title: "CRR", module: "medrep", area: "B2B CRR" }] },
          { name: "New Business Development", kind: "team", channel: "B2B", seats: [{ title: "NBD", module: "medrep", n: 4, area: "B2B NBD" }] },
        ],
      },
    ],
  },
  { name: "Modern Trade", kind: "business", channel: "MT", seats: [{ title: "Chief Operating Officer – Modern Trade", module: "manager", lead: true }] },
];
