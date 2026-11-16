// The company as the CRM is built to it, read box by box from "ORGANIZATIONAL CHART 2026 GPI 2MG"
// (HR, 10 Oct 2026): who heads each box, who is under whom, each seat's work, the desk it gets in
// the CRM and how far that desk is built. Filled one business at a time (docs/PLAN.md section 16),
// so Aryan can lay it beside the chart and correct a box or a seat's work.

export type Status = "built" | "partly" | "not yet";

export type ChartSeat = {
  title: string;
  /** The people on the chart in this seat ("Vacant" for an empty one). */
  people: string[];
  /** Their work, in a few lines. */
  work: string[];
  /** Their desk in the CRM, and what it shows. */
  desk: string | null;
  screens: string[];
  status: Status;
  /** A head or coach of the box (the box's people report to them). */
  lead?: boolean;
};

export type ChartBox = {
  name: string;
  /** Read from the chart and checked seat by seat on this day; empty: not checked yet. */
  checked: string | null;
  note?: string;
  seats: ChartSeat[];
  boxes?: ChartBox[];
};

const HOSPITAL_CHC_WORK = [
  "Visits their hospitals (pharmacy, procurement, wards, OR) and gets their purchase orders",
  "Collects: no invoice past 60 days, a visit at 75, the coach at 90",
  "Calls hospitals due to reorder; declares the day at the 7 PM huddle",
];
const HOSPITAL_CHC_SCREENS = ["Today's pulse", "Go here first", "Collections", "Hospitals to call", "Visits", "Tonight's huddle", "My score"];
const chcSeat = (people: string[]): ChartSeat => ({
  title: "CHC (Customer Happiness Coachee)",
  people,
  work: HOSPITAL_CHC_WORK,
  desk: "Hospital CHC",
  screens: HOSPITAL_CHC_SCREENS,
  status: "built",
});
const dsc = (person: string): ChartSeat => ({
  title: "District Sales Coach",
  people: [person],
  work: ["Coaches the district's CHCs", "Reads the 7 PM huddle; goes with a CHC after three days without an invoice", "Runs the 15th rescue"],
  desk: "District Sales Coach",
  screens: ["Needs you today", "District now", "Team huddle", "15th rescue", "Collections", "Hospitals to call", "Scorecards"],
  status: "built",
  lead: true,
});

export const COMPANY_CHART: ChartBox = {
  name: "2MG Inc. / GetMeds",
  checked: null,
  seats: [
    {
      title: "Founder / Mentor",
      people: ["Mr. Naresh Bishnoi"],
      work: ["Leads the company; every business reports to him"],
      desk: "CEO",
      screens: ["Company home (built before this chart); the Founder's own roll-up comes last"],
      status: "partly",
      lead: true,
    },
  ],
  boxes: [
    {
      name: "Hospital Division",
      checked: "17 Nov 2026",
      seats: [
        {
          title: "Business Mentor",
          people: ["Ms. Vanessa Escalderon"],
          work: ["Owns the division's number; sets each CHC's target", "Runs the District Sales Coaches", "Decides recovery for teams and people behind"],
          desk: "Business Mentor",
          screens: ["Division vs target, team by team", "People at risk", "Money owed by age", "Score questions", "Scorecards", "Targets"],
          status: "built",
          lead: true,
        },
      ],
      boxes: [
        { name: "NCR 1", checked: "17 Nov 2026", seats: [dsc("Mr. Daniel Cruz"), chcSeat(["Mr. Ryan Aninon (Pasay, Manila)", "Mr. Luis Jasper Palingping (Las Piñas, Taguig)", "Ms. Ana Mae Otucan (Parañaque)", "Mr. Patrick Adion (Palawan)"])] },
        {
          name: "NCR 2",
          checked: "17 Nov 2026",
          seats: [dsc("Mr. Jim Lord Palomares"), chcSeat(["Ms. Princess Cuerdo (Quezon City)", "Ms. Den Jane Suarez (Camanava, Bulacan)", "Mr. Jacob Cruz (Marikina, Pasig)", "Mr. Jomari Esguerra (no territory yet)"])],
        },
        {
          name: "North & Central Luzon",
          checked: "17 Nov 2026",
          seats: [dsc("Mr. Julius S. Abucay"), chcSeat(["Ms. Nicole Anne Castillo (Tuguegarao, Isabela)", "Mr. Paolo Paradero (Cabanatuan, Nueva Ecija, Tarlac)", "Ms. Gabrielle Agripa (Baguio, Ilocos, La Union)", "Vacant (Pampanga, Bataan, Zambales)"])],
        },
        {
          name: "South Luzon",
          checked: "17 Nov 2026",
          seats: [dsc("Mr. Kindred Malauan"), chcSeat(["Ms. Lalien G. Nunez (Bicol)", "Ms. Clarisse Deocareza (Laguna, Batangas)", "Mr. Glenn Bernabe (Cavite, Laguna)", "Mr. John Michael Orig (Quezon Province, Mindoro)"])],
        },
        {
          name: "Visayas",
          checked: "17 Nov 2026",
          note: "No District Sales Coach on the chart: its CHCs report to the Business Mentor.",
          seats: [chcSeat(["Ms. Andrealyn Bermido (Cebu South, Dumaguete)", "Mr. Kristofferson Conde (Cebu North, Bohol)", "Ms. Jessa Mae Teruel (Iloilo, Bacolod, Roxas)"])],
        },
        {
          name: "Mindanao",
          checked: "17 Nov 2026",
          seats: [
            dsc("Mr. Saurav Kumar"),
            chcSeat(["Ms. Harley Queen Orani (Gen San, South Cotabato)", "Ms. Rubelyn Ramos (Davao North)", "Ms. Melanie Diaz (Cagayan de Oro, Butuan, Iligan)", "Mr. Welmar Pancho (Davao South)", "Ms. Maycarl Degamo (Zamboanga, Pagadian, Dipolog)"]),
          ],
        },
        {
          name: "Government Account",
          checked: "17 Nov 2026",
          seats: [
            {
              title: "Government Bidding Coachee",
              people: ["Mr. Reynan Cuenca"],
              work: ["Government hospitals' purchases by bidding and small-value procurement", "Quotes a posting within 24 hours"],
              desk: "Government Account",
              screens: ["Today's pulse", "Collections", "Hospitals to call (the tender desk comes with Government Bidding)"],
              status: "partly",
            },
          ],
        },
        {
          name: "MD Telesales Anesthesia",
          checked: "17 Nov 2026",
          note: "No coach on the chart: they report to the Business Mentor.",
          seats: [
            {
              title: "Customer Happiness Coachee (anesthesia telesales)",
              people: ["Ms. Micah Jimena", "Ms. Aila Zaragoza", "Ms. Sheena Correa", "Ms. Paula Pentallana", "Ms. Mary Rose Goron"],
              work: ["Sells anesthesia medicines to hospitals and doctors by phone", "Calls customers due to reorder; collects"],
              desk: "MD Telesales – Anesthesia",
              screens: ["Today's pulse", "Go here first", "Customers to call", "Collections", "My score (Hospital CHC card)"],
              status: "built",
            },
          ],
        },
        {
          name: "Patient Assistance Program Department",
          checked: "17 Nov 2026",
          seats: [
            {
              title: "Patient Assistance Program Officer",
              people: ["Ms. Fhaye Norella"],
              work: ["Patients' government assistance (DSWD, PCSO, OVP): guarantee letters, claims"],
              desk: "PAP desk (built before this chart)",
              screens: ["PAP cases"],
              status: "partly",
            },
          ],
        },
      ],
    },
    {
      name: "Prescription Business",
      checked: "17 Nov 2026",
      seats: [
        {
          title: "PX Country Mentor",
          people: ["Mr. Javed Shaikh"],
          work: ["Heads the Rx business: the field CHCs (no sales target) and MD Telesales (the target)"],
          desk: "Country Mentor",
          screens: ["Field team", "Patient Care Groups", "B2C desk now", "People at risk", "Money owed", "Scorecards", "Targets"],
          status: "built",
          lead: true,
        },
        {
          title: "Sales Admin",
          people: ["Ms. Kate Cagoyong (Employee Happiness Coachee)"],
          work: ["Turns order forms into dispatched orders: Finance's approval, the invoice, the pharmacy, dispatch"],
          desk: null,
          screens: ["Not a CRM seat yet: the order line's Management step does this work"],
          status: "not yet",
        },
      ],
      boxes: [
        {
          name: "Onco-Hema Division",
          checked: "17 Nov 2026",
          note: "Uro & Onco Care and Blood & Bone Care work the same way: one team in the CRM (Aryan, 16 Nov). No coach for the field CHCs: they report to the Country Mentor.",
          seats: [
            {
              title: "Rx CHC (Uro & Onco Care: NCR 1, NCR 2, North & Central Luzon, South Luzon, Visayas, Mindanao)",
              people: ["Ms. Angelica Mae Saludes", "Ms. Eloisa Villanda", "Mr. Noel Valencia", "Mr. Gienel Carlos", "Mr. Kevin Sean Apid", "Ms. Allysa Mae Madera", "Ms. Antonette Lawas", "Ms. Jice Joyce Fajardo", "Ms. Meryanie Arcangel"],
              work: ["Builds doctors (no sales target): tiers, visits, the route", "Enrols doctors' Patient Care Groups (patients' consent)", "PAP for their patients"],
              desk: "Rx CHC",
              screens: ["My doctors", "Today's route", "Care groups", "Calls", "My score (Rx card)"],
              status: "built",
            },
            {
              title: "Rx CHC (Blood & Bone Care)",
              people: ["Ms. Merry Joyce Sebastian", "Mr. Marwin Dy"],
              work: ["As the Uro & Onco Care CHCs"],
              desk: "Rx CHC",
              screens: ["As above"],
              status: "built",
            },
          ],
          boxes: [
            {
              name: "MD Telesales Oncology",
              checked: "17 Nov 2026",
              seats: [
                {
                  title: "Sales Coach (Onco-Hema)",
                  people: ["Ms. Honey Cordero"],
                  work: ["Coaches MD Telesales and the B2C CHCs; holds the team's number", "Watches the care groups' 15 minutes and the B2C replies"],
                  desk: "Sales Coach",
                  screens: ["Patient Care Groups", "New groups waiting", "B2C desk now", "Each person against target", "Refills due"],
                  status: "built",
                  lead: true,
                },
                {
                  title: "Sales Admin",
                  people: ["Ms. Sheila Mae Bazar"],
                  work: ["Order processing for the telesales team"],
                  desk: null,
                  screens: ["Not a CRM seat yet"],
                  status: "not yet",
                },
                {
                  title: "Customer Happiness Coachee (MD Telesales – Oncology)",
                  people: ["Ms. Mitzi Francisco", "Mr. Emmanuel Greg Escalona", "Ms. Ailyn Mancilla", "Ms. Khalygen Boayes"],
                  work: ["Answers each new care group within 15 minutes", "Turns groups into orders; works patients' refills", "Holds the Rx sales target"],
                  desk: "MD Telesales",
                  screens: ["Pulse", "New groups waiting", "Refills due", "My orders", "My score"],
                  status: "built",
                },
              ],
              boxes: [
                {
                  name: "B2C Sales Coaching Department",
                  checked: "17 Nov 2026",
                  seats: [
                    {
                      title: "Customer Happiness Coachee (B2C)",
                      people: ["Ms. Mary Jane Viñas", "Ms. Rachelle Upao"],
                      work: ["Answers every enquiry within 15 minutes", "Works the refill-due list before noon; day-3 check-ins", "At least one invoice by 2:30 PM"],
                      desk: "B2C CHC",
                      screens: ["Morning pulse", "Waiting for a reply", "Refills due", "Leads & enquiries", "Inbox", "My score (B2C card)"],
                      status: "built",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "Sales and Marketing",
      checked: "17 Nov 2026",
      seats: [
        {
          title: "Sales and Marketing Mentor",
          people: ["Mr. Subir Dey"],
          work: ["Heads CLIDP, Government Bidding and B2B Telesales"],
          desk: "Sales & Marketing Mentor",
          screens: ["New business per NBD", "Accounts per CRR", "Hand-overs", "CLIDP coaches", "Government Bidding", "People at risk", "Money owed", "Scorecards"],
          status: "built",
          lead: true,
        },
      ],
      boxes: [
        {
          name: "CLIDP",
          checked: "17 Nov 2026",
          note: "CLIDP: the FDA's Certificate of Listing of Identical Drug Product (a distributor lists our medicine under its own brand). Both seats sell; nobody is under them.",
          seats: [
            {
              title: "Sales Coach (CLIDP)",
              people: ["Ms. Ma. Anicia D. Maglatang", "Ms. Nicka Angelene Masusi"],
              work: ["Sells in bulk to distributors that list our medicines under their own brand", "Watches each listing's validity; collects big balances", "Calls accounts due to reorder"],
              desk: "CLIDP Sales Coach",
              screens: ["Volume vs target", "Accounts to call (bulk reorders)", "Money owed, biggest first", "Listings ending", "Listings"],
              status: "built",
            },
          ],
        },
        {
          name: "Government Bidding",
          checked: "17 Nov 2026",
          note: "One line on the chart, the Admin at its top. Tenders go Found on PhilGEPS → Preparing → Price approved → Submitted → Won / Lost → Contract → Delivered → Accepted (IAR) → Billed → Paid.",
          seats: [
            {
              title: "Government Bidding Admin",
              people: ["Mr. Jimmy Boy Saturinas"],
              work: ["Approves each bid price", "Keeps the company's eligibility papers valid", "Watches deadlines, awards, acceptance and payment"],
              desk: "Government Bidding Admin",
              screens: ["Deadlines this week", "Bid prices to approve", "Awaiting award", "Awards to deliver / accept / bill / collect", "Company papers ending", "Tenders", "Documents"],
              status: "built",
              lead: true,
            },
            {
              title: "Government Bidding Coachee",
              people: ["Ms. Angelica Gollena", "Ms. Hazel Marie Balano"],
              work: ["Records tenders from PhilGEPS; prepares the envelope and the bid price", "Submits; follows the award, delivery, acceptance and billing"],
              desk: "Government Bidding",
              screens: ["As the Admin's, without approving prices", "Tenders", "Documents"],
              status: "built",
            },
            {
              title: "Customer Happiness Coachee (Government Bidding)",
              people: ["Mr. Arron Tongcua"],
              work: ["Follows government buyers; records and works tenders with the coachees"],
              desk: "Government Bidding",
              screens: ["Tenders", "Documents"],
              status: "built",
            },
            {
              title: "Sales Admin",
              people: ["Ms. Aljean Carno"],
              work: ["Order processing for the awards"],
              desk: null,
              screens: ["Not a CRM seat yet"],
              status: "not yet",
            },
          ],
        },
        {
          name: "B2B Telesales",
          checked: "17 Nov 2026",
          seats: [
            {
              title: "B2B Sales Coach",
              people: ["Ms. Jessa Domino"],
              work: ["Coaches NBD and CRR; hands accounts from NBD to CRR"],
              desk: "B2B Sales Coach",
              screens: ["New business per NBD", "Accounts per CRR", "Hand-overs waiting"],
              status: "built",
              lead: true,
            },
            {
              title: "B2B District Sales Coach – Mindanao",
              people: ["Ms. Claire Gallana"],
              work: ["As the B2B Sales Coach, for Mindanao"],
              desk: "B2B Sales Coach",
              screens: ["As above"],
              status: "built",
              lead: true,
            },
          ],
          boxes: [
            {
              name: "Client Retention & Reorder (CRR)",
              checked: "17 Nov 2026",
              seats: [
                {
                  title: "Customer Happiness Coachee (CRR)",
                  people: ["Ms. Fritzie Mier"],
                  work: ["Keeps handed-over accounts buying: due, late, buying less, stopped (win back)"],
                  desk: "CRR · Retention & Reorder",
                  screens: ["Retention this month", "Late: call today", "Due this week", "Buying less", "Stopped", "Accounts"],
                  status: "built",
                },
              ],
            },
            {
              name: "New Business Development (NBD)",
              checked: "17 Nov 2026",
              seats: [
                {
                  title: "Customer Happiness Coachee (NBD)",
                  people: ["Ms. Floremel Medina", "Ms. Lonie Ann Neri", "Ms. Winbelle Faith Gomez", "Mr. Benjie Dan Lacebal"],
                  work: ["Finds new drugstores, distributors and clinics; collects their papers; gets the first order", "Hands the account to CRR at its 3rd order or day 90"],
                  desk: "NBD · New Business",
                  screens: ["Calls today", "Papers missing", "First orders and conversion", "Ready to hand to CRR", "Prospects"],
                  status: "built",
                },
              ],
            },
          ],
        },
      ],
    },
    { name: "Modern Trade", checked: null, note: "Not read box by box yet.", seats: [] },
    { name: "Digital Marketing Coaching Department", checked: null, note: "Not read box by box yet.", seats: [] },
    { name: "IT Division", checked: null, note: "Not read box by box yet.", seats: [] },
    { name: "In-licensing & Regulatory Department", checked: null, note: "Not read box by box yet.", seats: [] },
    { name: "HR Department", checked: null, note: "Not read box by box yet.", seats: [] },
    { name: "Supply Chain, Operations & Finance Department", checked: null, note: "Not read box by box yet.", seats: [] },
  ],
};
