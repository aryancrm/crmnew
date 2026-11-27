// The About page (/about; on the home page until 24 Nov): what Bishnoi One is and how it works, as one
// long page: a black hole with every part of the company around one record, one order from start
// to finish, the field, the books, how it works, questions, the footer. Only words and a look.
// DETAILS (what each workspace holds) is shown in the home page's workspace showcase (home-export).

import { type CSSProperties, Fragment, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, CircleCheck, ClipboardCheck, HeartHandshake, MessageSquare, Package, Pill, ShieldCheck, ShoppingCart, Truck, Wallet, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { WORKSPACES } from "../workspaces";
import { heroLogo } from "./hero-logos";

const wrap = "mx-auto w-[min(1140px,calc(100%-32px))]";



/** One order in three phases (Aryan, 25 Nov, after a "scope of work" layout he gave): who works
 *  each phase, and what the system checks or does in it. */
const PHASES = [
  {
    title: "Order",
    who: "Steps 1 and 2",
    icon: ClipboardCheck,
    checks: [
      "Taken by a MedRep or the Online desk",
      "The patient's Rx kept with it",
      "Customer and prices checked",
      "Approved, sent back or held by Management",
    ],
  },
  {
    title: "Payment & stock",
    who: "Steps 3 and 4",
    icon: Wallet,
    checks: [
      "Payment confirmed by Finance",
      "Cash, transfer, cheque or terms",
      "Invoice made from the order",
      "The batch given by Inventory",
      "Expiry and cost kept",
    ],
  },
  {
    title: "Delivery & books",
    who: "Steps 5 and 6",
    icon: Truck,
    checks: [
      "Packed by Dispatch",
      "Shipment and courier followed",
      "Delivered to the customer's door",
      "Sale, payment and cost posted to the books",
    ],
  },
];

/** The thin lines under each phase: fixed heights (px), so they never jump between visits. */
const BARS = [
  [150, 92, 120, 40, 66, 52, 98, 96, 52, 70, 54, 46, 110],
  [118, 82, 64, 70, 52, 98, 86, 150, 78, 110, 64, 44],
  [150, 120, 106, 64, 68, 52, 70, 92, 150, 102, 128, 66, 96],
];

/** What each workspace holds, from its own menu (src/menus.ts). */
export const DETAILS: Record<string, { who: string; points: string[] }> = {
  leads: {
    who: "Team leads: the managers in the sales tracker (Honey, Jessa, Reynan, Julius, Daniel…)",
    points: ["Your team's orders, held or sent back", "Each of your people against their target", "Your team's customers and collections", "Calls and visits of your people", "Ask your head or Management for an exception"],
  },
  heads: {
    who: "Heads of the business (Vanessa, Javed, Subir, Mhalou)",
    points: ["Each of your channels and its managers against the month's target", "Every order of your people", "The sales organisation and the map of your part", "Customers, collections and what is owed", "Targets for your managers and people"],
  },
  sales: {
    who: "MedReps: the sales people",
    points: ["Today's visits, the visit plan and the calendar", "New orders and leads, taken on the spot", "Your hospitals, doctors and patients", "Collections and customers to call", "Samples, gifts and your expenses", "Your score, and your team's for leads"],
  },
  management: {
    who: "The people who approve every order",
    points: ["Orders to check: approve, send back or hold", "Orders stuck over two days", "Returns to approve", "New customers to check", "Hospitals, doctors and patients"],
  },
  finance: {
    who: "Payments, invoices and the books",
    points: ["Orders to check for payment", "Invoices, payments received and refunds owed", "What each customer owes", "Banking, expenses and journals", "Profit and loss, balance sheet, cash flow and VAT"],
  },
  inventory: {
    who: "Stock and purchasing",
    points: ["Every medicine, batch and expiry", "Adjustments and transfers between warehouses", "Batch trace for a recall", "Samples handed to reps", "Vendors, purchase orders, receives and bills"],
  },
  dispatch: {
    who: "Packing and delivery",
    points: ["Approved, paid orders to pack", "Shipments and couriers", "Each order followed to the customer"],
  },
  online: {
    who: "Messenger, the websites and patients' cases",
    points: ["One inbox for every message", "Leads and enquiries", "Patients' points", "The channels the company sells on"],
  },
  hr: {
    who: "People, attendance and payroll",
    points: ["Everyone in the company chart", "The attendance report", "Leave to approve", "Payroll and payslips"],
  },
  regulatory: {
    who: "Registrations and quality",
    points: ["The registration pipeline", "Complaints and side-effects, each to a due day", "The company's documents"],
  },
  office: {
    who: "The office team",
    points: ["Your daily work log", "Your leave and forms", "Your payslips and messages"],
  },
  ceo: {
    who: "The whole company in one view",
    points: ["What waits on you to decide", "Sales by channel, branch and person", "Scorecards, targets and speed", "The books and every report"],
  },
  books: {
    who: "Finance, the CEO and the Admin",
    points: ["Home: receivables, payables, cash flow, income and expense", "Expenses, journals, transfers and deposits", "Bank statements and reconciliation", "Credit notes, refunds and the chart of accounts", "Every report, from the general ledger to AR aging"],
  },
  admin: {
    who: "Setup, logins and the audit",
    points: ["People, seats and logins", "Company settings", "The audit: who did what, and when", "Data checks"],
  },
};

/** Same numbers every time, so the stars don't jump between visits. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seeded(1811);
const STARS = Array.from({ length: 170 }, (_, i) => ({
  x: random() * 1440,
  y: 120 + random() * 660,
  r: 0.5 + random() * 1.1,
  delay: random() * 5,
  dur: 2.2 + random() * 3.5,
  twinkle: i % 3 !== 0,
  sparkle: i % 23 === 0,
}));

/** Small stars all over the sky, most of them twinkling, a few four-pointed. */
function Stars() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
      {STARS.map((star, i) =>
        star.sparkle ? (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
            key={i}
            className="orbit-twinkle"
            style={{ animationDelay: `${star.delay}s`, animationDuration: `${star.dur + 1}s` }}
            d={`M${star.x} ${star.y - 7}l2 5 5 2-5 2-2 5-2-5-5-2 5-2z`}
            fill="#f8a46a"
          />
        ) : (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#f3b48a"
            opacity={star.twinkle ? undefined : 0.55}
            className={star.twinkle ? "star-twinkle" : undefined}
            style={star.twinkle ? { animationDelay: `${star.delay}s`, animationDuration: `${star.dur}s` } : undefined}
          />
        ),
      )}
    </svg>
  );
}

/** The workspaces counted by group, for the "Our desks" card. */
const DESK_SPLIT = [
  { label: "Selling", group: "selling" },
  { label: "Operations", group: "operations" },
  { label: "the office", group: "office" },
].map((one) => ({ ...one, count: WORKSPACES.filter((w) => w.group === one.group).length }));

/** A card's small rounded label: grey on white, see-through white on the blue and orange cards. */
function Tag({ children, dark, light }: { children: string; dark?: boolean; light?: boolean }) {
  const look = dark || light ? "bg-white/20 text-white" : "bg-[#ececec] text-[#3a3a3a]";
  return <span className={`w-fit rounded-full px-4 py-2 text-[12px] ${look}`}>{children}</span>;
}

/** The values' drawings: our own, each in the four colours (Aryan, 25 Nov). */
const BLUE = "#2563eb";
const YELLOW = "#f5b301";
const RED = "#e5383b";
const GREEN = "#22a45d";
const ICON = "h-[clamp(56px,6vw,74px)] w-[clamp(80px,8.6vw,106px)] shrink-0";

/** Transparency and Trust: a page seen through a lens, checked. */
const TrustIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <rect x="2" y="2" width="58" height="76" rx="8" fill={BLUE} />
    <rect x="12" y="16" width="34" height="6" rx="3" fill="#fff" opacity=".85" />
    <rect x="12" y="30" width="26" height="6" rx="3" fill="#fff" opacity=".6" />
    <path d="M82 66l22 16" stroke={RED} strokeWidth="10" strokeLinecap="round" />
    <circle cx="68" cy="50" r="24" fill={YELLOW} />
    <circle cx="68" cy="50" r="15" fill="#fff" />
    <path d="M61 50l5 5 9-10" fill="none" stroke={GREEN} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Ownership and Impact: a flag planted on a hill, the sun up. */
const OwnershipIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <circle cx="98" cy="18" r="14" fill={YELLOW} />
    <path d="M0 84c14-30 34-44 56-44s44 14 60 44z" fill={GREEN} />
    <rect x="52" y="4" width="5" height="40" rx="2.5" fill={BLUE} />
    <path d="M57 6h30l-8 10 8 10H57z" fill={RED} />
  </svg>
);

/** Speed and Execution: a bolt, with the air rushing past. */
const SpeedIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <circle cx="74" cy="42" r="40" fill={BLUE} />
    <path d="M80 8L56 46h18l-8 30 28-42H76z" fill={YELLOW} />
    <rect x="0" y="26" width="30" height="7" rx="3.5" fill={RED} />
    <rect x="8" y="40" width="22" height="7" rx="3.5" fill={GREEN} />
    <rect x="0" y="54" width="28" height="7" rx="3.5" fill={RED} opacity=".55" />
  </svg>
);

/** Built by Us, for Us: blocks stacked into one build. */
const BuiltIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <rect x="4" y="50" width="52" height="32" rx="5" fill={BLUE} />
    <rect x="60" y="50" width="52" height="32" rx="5" fill={GREEN} />
    <rect x="30" y="16" width="52" height="32" rx="5" fill={RED} />
    {([[14, 50], [36, 50], [70, 50], [92, 50], [40, 16], [62, 16]] as const).map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y - 7} width="12" height="8" rx="2" fill={y === 16 ? RED : x < 60 ? BLUE : GREEN} />
    ))}
    <circle cx="104" cy="14" r="10" fill={YELLOW} />
  </svg>
);

/** One Team, One Record: four people around one shared record. */
const TeamIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <path d="M60 42L24 14M60 42L96 14M60 42L24 70M60 42L96 70" stroke="#d6dae1" strokeWidth="3" />
    <circle cx="24" cy="14" r="12" fill={BLUE} />
    <circle cx="96" cy="14" r="12" fill={RED} />
    <circle cx="24" cy="70" r="12" fill={GREEN} />
    <circle cx="96" cy="70" r="12" fill={YELLOW} />
    <rect x="44" y="28" width="32" height="28" rx="6" fill="#1f2733" />
    <rect x="50" y="35" width="20" height="4" rx="2" fill="#fff" />
    <rect x="50" y="44" width="14" height="4" rx="2" fill="#fff" opacity=".6" />
  </svg>
);

/** Patients and People First: a capsule and a care cross. */
const PeopleIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <g transform="rotate(-35 40 46)">
      <rect x="6" y="30" width="68" height="32" rx="16" fill={BLUE} />
      <path d="M40 30h18a16 16 0 010 32H40z" fill={RED} />
    </g>
    <path d="M86 20h12v12h12v12H98v12H86V44H74V32h12z" fill={GREEN} />
    <path d="M106 66l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={YELLOW} />
  </svg>
);

/** Records That Add Up: a ledger page, its total underlined, checked. */
const BooksIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <path d="M8 2h60v78l-10-6-10 6-10-6-10 6-10-6-10 6z" fill={BLUE} />
    {[14, 26, 38].map((y) => (
      <g key={y}>
        <rect x="16" y={y} width="24" height="5" rx="2.5" fill="#fff" opacity=".7" />
        <rect x="46" y={y} width="14" height="5" rx="2.5" fill="#fff" opacity=".7" />
      </g>
    ))}
    <rect x="16" y="52" width="44" height="7" rx="3.5" fill={YELLOW} />
    <circle cx="94" cy="56" r="22" fill={GREEN} />
    <path d="M84 56l7 7 13-14" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="96" cy="16" r="8" fill={RED} />
  </svg>
);

/** Always Improving: steps that climb, an arrow going up. */
const GrowthIcon = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true" className={ICON}>
    <rect x="0" y="62" width="28" height="22" rx="3" fill={RED} />
    <rect x="28" y="44" width="28" height="40" rx="3" fill={YELLOW} />
    <rect x="56" y="26" width="28" height="58" rx="3" fill={GREEN} />
    <rect x="84" y="8" width="28" height="76" rx="3" fill={BLUE} />
    <path d="M8 46L42 20" stroke="#1f2733" strokeWidth="4" strokeLinecap="round" />
    <path d="M30 18h14v14" fill="none" stroke="#1f2733" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The culture and values, in the order they slide. */
const VALUES = [
  { title: "Transparency and Trust", Icon: TrustIcon },
  { title: "Ownership and Impact", Icon: OwnershipIcon },
  { title: "Speed and Execution", Icon: SpeedIcon },
  { title: "Built by Us, for Us", Icon: BuiltIcon },
  { title: "One Team, One Record", Icon: TeamIcon },
  { title: "Patients and People First", Icon: PeopleIcon },
  { title: "Records That Add Up", Icon: BooksIcon },
  { title: "Always Improving", Icon: GrowthIcon },
];

/** A phase's name, and under it who works it between two thin lines. */
function PhaseName({ title, who }: { title: string; who: string }) {
  return (
    <div className="px-6 text-center">
      <h3 className="text-[clamp(1.3rem,1.8vw,1.6rem)] font-normal tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 flex items-center justify-center gap-2 text-[13px] text-[#5d625b]">
        <span aria-hidden="true" className="h-px w-[clamp(2.5rem,6vw,5.5rem)] bg-gradient-to-l from-[#c9cec6] to-transparent" />
        {who}
        <span aria-hidden="true" className="h-px w-[clamp(2.5rem,6vw,5.5rem)] bg-gradient-to-r from-[#c9cec6] to-transparent" />
      </p>
    </div>
  );
}

/** What the app holds to, from its own rules (the API checks them, not only the screens), as the
 *  three small cards around the founder's words: their colour, where they sit on computers, and
 *  their sentence (the odd parts grey). */
const TRUST_STEPS = [
  {
    color: "#f36b21",
    place: "lg:top-[290px] lg:left-0",
    text: ["Every action checks ", "who you are and what your seat allows", "; a hidden button is never the only guard."],
  },
  {
    color: "#3fbfa0",
    place: "lg:top-[360px] lg:left-[33%]",
    text: ["Nothing with history is deleted: ", "orders, payments and stock are cancelled, reversed or archived", ", so the past adds up."],
  },
  {
    color: "#2f5bea",
    place: "lg:top-[240px] lg:left-[68%]",
    text: ["Every change is kept in the audit, ", "who did what and when", ", and built-in checks catch a gap early."],
  },
];

/** Questions people ask before they first sign in. */
const QUESTIONS = [
  {
    q: "Who is Bishnoi One for?",
    a: "Everyone at 2MG and GetMeds: MedReps and team leads in the field, the people who approve orders, finance, stock, dispatch, HR, regulatory, the office team and the management.",
  },
  {
    q: "How do I get an account?",
    a: "Your administrator adds you and gives you your login ID and a one-time password; you then choose your own password.",
  },
  {
    q: "Which workspace do I choose?",
    a: "Your own department's. Every workspace opens the same sign-in, and your login decides what you see and what you can do inside.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes. The field screens are made for the phone first, so a rep can take an order, check a hospital or log a visit between two calls.",
  },
  {
    q: "I forgot my password. What now?",
    a: "Ask your administrator for a one-time password. You sign in with it once, then choose a new password of your own.",
  },
  {
    q: "Can I sign in to another department's workspace?",
    a: "No. Your login belongs to your own department, and a sign-in to a workspace it doesn't belong to is refused.",
  },
  {
    q: "Why can't I see a button my colleague has?",
    a: "Your role decides what you can see and do. The system checks your role on every action, so a screen only offers what your seat allows.",
  },
  {
    q: "Can an order or a payment be deleted?",
    a: "No. Nothing with history is deleted: orders, payments and stock are cancelled, reversed or archived, so the past still adds up.",
  },
  {
    q: "Can I see who changed a record?",
    a: "Yes. Every change is kept in the audit with who made it and when.",
  },
  {
    q: "What are WorkDrive and Digital Marketing?",
    a: "Two systems on the way: WorkDrive for the company's shared files, Digital Marketing for campaigns, ads and social media. They are listed already and open once they are ready.",
  },
];

/** The questions as schema.org FAQPage, for search engines. */
const FAQ_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QUESTIONS.map((one) => ({
    "@type": "Question",
    name: one.q,
    acceptedAnswer: { "@type": "Answer", text: one.a },
  })),
}).replace(/</g, "\\u003c");

/** Which system the orange panel's top card shows while each question is open, in turn. */
const FAQ_SYSTEMS = ["sales", "admin", "online", "sales", "admin", "hr", "office", "management", "finance", "ceo", "dispatch"];

/** Computers: the questions pin under the navbar while the page scrolls through them, one answer
 *  open at a time; after the last one the page carries on (Aryan, 26 Nov). */
const PIN_FROM = "(min-width: 1024px)";

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(PIN_FROM).matches);
  useEffect(() => {
    const query = window.matchMedia(PIN_FROM);
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}

/** The blue panel (#1d9fda, Aryan 26 Nov) beside the questions: the order line as one record, the desks around it. */
function FaqArt({ open }: { open: number }) {
  const key = FAQ_SYSTEMS[open % FAQ_SYSTEMS.length] ?? "sales";
  const system = WORKSPACES.find((one) => one.key === key);
  const rows = [
    { code: "SO-1042", who: "Bayview Pharmacy", step: "Approved" },
    { code: "SO-1043", who: "Mercy Clinic", step: "Paid" },
    { code: "SO-1044", who: "Northside Hospital", step: "Packing" },
    { code: "SO-1045", who: "Riverside Drugstore", step: "Delivered" },
  ];
  return (
    <div aria-hidden="true" className="relative h-full min-h-[380px] overflow-hidden rounded-2xl bg-[#1d9fda]">
      {/* The system at work, changing with the open question. */}
      <div
        key={key}
        className="absolute top-[14%] left-[40%] z-20 flex w-[48%] animate-[launcher-in_380ms_cubic-bezier(.2,.8,.2,1)_both] items-center gap-3 rounded-xl bg-white p-3 shadow-[0_18px_40px_-18px_rgba(5,50,80,0.55)] motion-reduce:animate-none"
      >
        <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-[#e8f5fc]">
          <img src={heroLogo(key)} alt="" width={40} height={40} className="size-10 object-contain" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-[#1f2733]">{system?.label ?? "Bishnoi One"}</span>
          <span className="block truncate text-[12.5px] text-[#5b6472]">{system?.about ?? ""}</span>
        </span>
        <span className="absolute top-2 right-3 flex items-center gap-1 text-[10px] text-[#5b6472]">
          <span className="size-1.5 rounded-full bg-[#22c55e]" /> Active
        </span>
      </div>
      {/* The thin line from the card into the board. */}
      <span className="absolute top-[22%] left-[20%] z-10 h-[12%] w-[20%] rounded-tl-xl border-t-2 border-l-2 border-white/60" />

      {/* The board: one record every desk reads. */}
      <div className="absolute top-[33%] left-[10%] w-[95%] rounded-tl-xl bg-white/85 p-4 shadow-[0_20px_50px_-24px_rgba(5,50,80,0.5)] backdrop-blur-sm">
        <p className="text-[15px] font-semibold text-[#173a50]">Order line</p>
        <p className="mt-1 text-[11px] font-medium text-[#0b78ab]">⌄ This week</p>
        <div className="mt-2 grid grid-cols-[1fr_1.6fr_1fr] gap-px overflow-hidden rounded-md bg-[#d6ebf6] text-[10.5px]">
          {["Order", "Customer", "Step"].map((head) => (
            <span key={head} className="bg-[#eef7fc] px-2 py-1.5 text-center text-[#557789]">
              {head}
            </span>
          ))}
          {rows.map((row) => (
            <Fragment key={row.code}>
              <span className="bg-white px-2 py-1.5 text-[#5b6472]">{row.code}</span>
              <span className="truncate bg-white px-2 py-1.5 text-[#5b6472]">{row.who}</span>
              <span className="bg-[#cdeaf8] px-2 py-1.5 text-center text-[#0b5f86]">{row.step}</span>
            </Fragment>
          ))}
        </div>
      </div>

      {/* The desks along the line. */}
      <span className="absolute top-[47%] left-[4%] z-20 flex items-center gap-1.5 rounded-full bg-[#ffd400] py-1 pr-3 pl-1 text-[11px] font-medium text-[#3b2a00] shadow-md">
        <img src={heroLogo("sales")} alt="" className="size-6 rounded-full bg-white object-contain p-0.5" /> MedRep
      </span>
      <span className="absolute top-[62%] left-[5%] z-20 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] text-[#1f2733] shadow-[0_10px_24px_-12px_rgba(5,50,80,0.5)]">
        <img src={heroLogo("management")} alt="" className="size-5 object-contain" /> Order approved
        <span className="rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] text-[#15803d]">Completed</span>
      </span>
      <span className="absolute top-[72%] left-[5%] z-20 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] text-[#1f2733] shadow-[0_10px_24px_-12px_rgba(5,50,80,0.5)]">
        <img src={heroLogo("dispatch")} alt="" className="size-5 object-contain" /> Packing the order
        <span className="rounded bg-[#e0e7ff] px-1.5 py-0.5 text-[10px] text-[#4338ca]">In progress</span>
      </span>
      <span className="absolute top-[80%] left-[60%] z-20 flex items-center gap-1.5 rounded-full bg-[#ffe1ee] py-1 pr-3 pl-1 text-[11px] font-medium text-[#831843] shadow-md">
        <img src={heroLogo("finance")} alt="" className="size-6 rounded-full bg-white object-contain p-0.5" /> Finance
      </span>
      {/* The bottom fades into the orange, as the board runs on. */}
      <span className="absolute inset-x-0 bottom-0 z-10 h-[22%] bg-gradient-to-t from-[#1d9fda] to-transparent" />
    </div>
  );
}

/** The questions: grey cards, one answer open at a time, the orange panel beside them. On
 *  computers the block stays pinned while the scroll opens each question in turn. */
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();
  const wide = useWide();
  const section = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const count = QUESTIONS.length;

  // Computers: the scroll through the section picks the open question.
  useEffect(() => {
    if (!wide) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = section.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const room = rect.height - (window.innerHeight - 66);
      if (room <= 0) return;
      const progress = Math.min(Math.max((66 - rect.top) / room, 0), 0.9999);
      setOpen(Math.floor(progress * count));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [wide, count]);

  // Computers: keep the open card in sight inside the pinned list.
  useEffect(() => {
    if (!wide || open === null) return;
    const box = list.current;
    const card = box?.children[open] as HTMLElement | undefined;
    if (!box || !card) return;
    // The list is the cards' offset parent (relative), so offsetTop is already inside it. Show the
    // card just under the one before it, but never let its bottom run past the list's edge.
    const place = () => {
      const under = card.offsetTop - 96;
      const fits = card.offsetTop + card.offsetHeight + 16 - box.clientHeight;
      box.scrollTo({ top: Math.max(Math.max(under, fits), 0), behavior: "smooth" });
    };
    place();
    // Again once the answer has slid open (300 ms), when the card has its full height.
    const later = window.setTimeout(place, 320);
    return () => window.clearTimeout(later);
  }, [open, wide]);

  /** A press: on computers it scrolls the page to that question's place, so the scroll and the
   *  open card stay in step; on phones it simply opens or closes it. */
  const pick = (i: number) => {
    const box = section.current;
    if (!wide || !box) {
      setOpen(open === i ? null : i);
      return;
    }
    const top = box.getBoundingClientRect().top + window.scrollY;
    const room = box.offsetHeight - (window.innerHeight - 66);
    window.scrollTo({ top: top - 66 + ((i + 0.5) / count) * room, behavior: "smooth" });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="bg-white">
      {/* The title and Get Started scroll by as usual; only what is under them pins. */}
      <div className={`${wrap} flex flex-wrap items-end justify-between gap-6 pt-2`}>
          <h2 id={`${id}-title`} className="max-w-[420px] text-[clamp(1.6rem,2.6vw,2.1rem)] leading-[1.18] font-normal tracking-[-0.02em] text-[#16181d]">
            Before you sign in — the questions people ask, answered
          </h2>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 rounded-full bg-[#f36b21] px-6 py-3 text-[14px] font-medium text-white transition hover:bg-[#e05a12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21]"
          >
            Get Started <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
      </div>

      {/* The scroll track: the pinned block stays centred on the screen while the page scrolls
          through it, one question per step. */}
      <div
        ref={section}
        className="lg:h-[var(--faq-h)]"
        style={{ "--faq-h": `calc(100dvh - 66px + ${count * 32}vh)` } as CSSProperties}
      >
      <div className={`${wrap} pt-10 pb-16 lg:sticky lg:top-[66px] lg:flex lg:h-[calc(100dvh-66px)] lg:items-center lg:py-0`}>
        <div className="grid w-full gap-9 lg:h-[min(560px,calc(100dvh-66px-64px))] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div
            ref={list}
            className="relative grid content-start gap-3 lg:overflow-hidden lg:pb-4 lg:[mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.85),#000_10px,#000_calc(100%-16px),rgba(0,0,0,0.7))]"
          >
            {QUESTIONS.map((one, i) => {
              const shown = open === i;
              return (
                <div key={one.q} className="rounded-2xl bg-[#f4f5f7]">
                  <h3>
                    <button
                      type="button"
                      id={`${id}-q${i}`}
                      aria-expanded={shown}
                      aria-controls={`${id}-a${i}`}
                      onClick={() => pick(i)}
                      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl px-7 py-6 text-left text-[15.5px] font-medium text-[#1f2733] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21]"
                    >
                      {one.q}
                      <ChevronDown
                        className={`size-5 shrink-0 text-[#1f2733] transition-transform duration-300 ${shown ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </h3>
                  {/* The answer slides open (grid rows 0fr to 1fr). */}
                  <div
                    id={`${id}-a${i}`}
                    role="region"
                    aria-labelledby={`${id}-q${i}`}
                    className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  >
                    <div className="overflow-hidden" inert={!shown}>
                      <p className="px-7 pb-6 text-[14px] leading-relaxed text-[#3c4452]">{one.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <FaqArt open={open ?? 0} />
        </div>
      </div>
      </div>
      {/* The same questions for search engines (FAQPage). */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: our own fixed words, as JSON
        dangerouslySetInnerHTML={{ __html: FAQ_SCHEMA }}
      />
    </section>
  );
}

/** The closing banner (Aryan, 26 Nov, after a "you're in good company" layout he gave): white, the
 *  title on the left in the questions' title style with Get Started, and on the right the company's
 *  own people in a checkerboard of 14 squares (six rows, each shown whole), with tool
 *  squares where there are more squares than photos, and the logo at the bottom right. */
const PEOPLE = "/ctabanner/web";
type Square = { row: number; col: number; colour: string } & ({ photo: string } | { icon: typeof Truck; label: string });
const SQUARES: Square[] = [
  { row: 0, col: 0, colour: "#1d9fda", icon: Truck, label: "Delivery" },
  { row: 0, col: 2, colour: "#f36b21", icon: ShoppingCart, label: "Orders" },
  { row: 0, col: 4, colour: "#ec4899", icon: Pill, label: "Medicines" },
  { row: 1, col: 1, colour: "#8fa3ad", photo: "ivy-marcel-varias" },
  { row: 1, col: 3, colour: "#f5c400", photo: "rommel-arcanghel" },
  { row: 1, col: 5, colour: "#9db7b4", photo: "kate-cagoyong" },
  { row: 2, col: 2, colour: "#d94a3d", photo: "lonie-ann-neri" },
  { row: 2, col: 4, colour: "#3f8f8b", photo: "sandeep-garg" },
  { row: 3, col: 1, colour: "#22b378", icon: Wallet, label: "Payments" },
  { row: 3, col: 3, colour: "#e8505b", photo: "jessa-domino" },
  { row: 3, col: 5, colour: "#7c5cff", icon: Package, label: "Stock" },
  { row: 4, col: 2, colour: "#f5c400", icon: CalendarDays, label: "Visits" },
  { row: 5, col: 1, colour: "#f2c6c0", photo: "khalygen" },
  { row: 5, col: 3, colour: "#8ec5e8", icon: MessageSquare, label: "Enquiries" },
];

function SignUpBanner() {
  return (
    <section aria-labelledby="start-title" className="overflow-hidden bg-white">
      <div className={`${wrap} grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-10 lg:pt-2`}>
        <div className="py-6 lg:py-0">
          {/* Two-tone, as "One order, start to finish", the second line in orange (Aryan, 26 Nov). */}
          <h2 id="start-title" className="text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.25] font-semibold tracking-[-0.03em] text-[#1d1f1c]">
            You're in good company
            <br />
            <span className="text-[#f36b21]">The whole team works on Bishnoi One</span>
          </h2>
          <Link
            to="/signup"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#f36b21] px-6 py-3 text-[14px] font-medium text-white transition hover:bg-[#e05a12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21]"
          >
            Get Started <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {/* Six columns by six rows of squares, every row shown whole (Aryan, 26 Nov). */}
        <div aria-hidden="true" className="relative aspect-square w-full">
          <div className="absolute inset-0 grid grid-cols-6 grid-rows-6">
            {SQUARES.map((one) => (
              <div
                key={`${one.row}-${one.col}`}
                className="grid place-items-center overflow-hidden"
                style={{ gridRow: one.row + 1, gridColumn: one.col + 1, background: one.colour }}
              >
                {"photo" in one ? (
                  <img src={`${PEOPLE}/${one.photo}.webp`} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <one.icon className="size-[38%] text-white" strokeWidth={1.6} />
                )}
              </div>
            ))}
          </div>
          {/* The logo at the bottom right. */}
          <div className="absolute right-0 bottom-0 flex h-[33.3%] w-[16.6%] flex-col items-center justify-center gap-1.5">
            <img src="/brand/bishnoi-one-mark.png" alt="" className="w-[62%]" />
            <span className="text-[clamp(0.8rem,1.5vw,1.3rem)] leading-none font-semibold tracking-[-0.03em] whitespace-nowrap text-[#16181d]">
              Bishnoi <span className="text-[#f36b21]">One</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function About() {
  return (
    <div id="about" className="relative">
      {/* The page's hero (Aryan, 24 Nov, after a layout he gave): the headline on the left, its line
          on the right, then one photo the full width of the window. */}
      <section className="bg-white text-[#16181d]">
        {/* The title on the left, its line on the right (Aryan, 24 Nov). */}
        <div className="mx-auto grid w-full max-w-[1440px] items-end px-[clamp(1.25rem,0.6rem+2.4vw,3rem)] gap-x-12 gap-y-6 pt-[clamp(3rem,10vh,7rem)] pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <h1 className="text-[clamp(2.4rem,8vw,3.8rem)] leading-[1.02] font-semibold tracking-[-0.045em] lg:text-[clamp(2.6rem,min(4.6vw,9vh),4.8rem)]">
            One company,
            <br />
            in <span className="text-[#f36b21]">one place.</span>
          </h1>
          <p className="max-w-[62ch] text-[clamp(0.95rem,0.85rem+0.3vw,1.075rem)] leading-[1.55] text-[#2b2f36] lg:pb-2">
            The company portal for 2MG and GetMeds. Selling in the field, approving and paying, keeping stock, delivering and
            looking after people, all on the same records, each person with their own login, so nothing is typed twice.
          </p>
        </div>
        {/* The home page's "Connect, Approve, Grow" photo (Aryan, 24 Nov), the full width of the window. */}
        <img
          src="/home-export/images/image.JPG"
          alt="Two team members reviewing work on a laptop in the office"
          className="block h-[clamp(420px,92vh,980px)] w-full object-cover object-[50%_35%]"
        />
      </section>

      {/* What is inside, as one introduction (Aryan, 24 Nov, after a layout he gave): the title, one
          large statement, then the facts in columns with thin lines between them. */}
      <section className="bg-white text-[#16181d]">
        <div className="mx-auto w-full max-w-[1440px] px-[clamp(1.25rem,0.6rem+2.4vw,3rem)] py-[clamp(3.5rem,9vh,6rem)]">
          <h2 className="text-[clamp(2.2rem,4.4vw,4rem)] leading-none font-semibold tracking-[-0.04em]">
            What is <span className="text-[#f36b21]">inside</span>
          </h2>
          <p className="mt-[clamp(2rem,5vh,3.5rem)] max-w-[60ch] text-[clamp(1.35rem,2.6vw,2.4rem)] leading-[1.32] font-medium tracking-[-0.02em]">
            Every part of the company, around one record. An order is entered once: approval, payment, stock, delivery and the
            books all read and write the same record, so nobody types it twice and nobody works from an old copy.
          </p>

          <dl className="mt-[clamp(2.5rem,7vh,5rem)] grid gap-y-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.7fr_1.2fr_2fr]">
            <div className="lg:pr-10">
              <dt className="text-[15px] text-[#7a8394]">Project</dt>
              <dd className="mt-3 text-[clamp(1.05rem,1.4vw,1.3rem)] leading-snug font-medium">Bishnoi One: the company portal</dd>
            </div>
            <div className="lg:border-l lg:border-[#e6e8ee] lg:px-10">
              <dt className="text-[15px] text-[#7a8394]">Year</dt>
              <dd className="mt-3 text-[clamp(1.05rem,1.4vw,1.3rem)] leading-snug font-medium">2026</dd>
            </div>
            <div className="lg:border-l lg:border-[#e6e8ee] lg:px-10">
              <dt className="text-[15px] text-[#7a8394]">Company</dt>
              <dd className="mt-3 text-[clamp(1.05rem,1.4vw,1.3rem)] leading-snug font-medium">2MG &amp; GetMeds, medicines</dd>
            </div>
            <div className="lg:border-l lg:border-[#e6e8ee] lg:pl-10">
              <dt className="text-[15px] text-[#7a8394]">Topic</dt>
              <dd className="mt-3 flex flex-wrap gap-2.5">
                {/* One colour per topic (Aryan, 25 Nov): blue, yellow, red, green, purple. */}
                {[
                  { topic: "Sales & field", color: "bg-[#2563eb]" },
                  { topic: "Approvals & payments", color: "bg-[#d97706]" },
                  { topic: "Stock & delivery", color: "bg-[#dc2626]" },
                  { topic: "People & HR", color: "bg-[#16a34a]" },
                  { topic: "The books", color: "bg-[#7c3aed]" },
                ].map(({ topic, color }) => (
                  <span key={topic} className={`rounded-full px-4 py-2 text-[15px] font-semibold text-white ${color}`}>
                    {topic}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Why Bishnoi One, as a story (Aryan, 25 Nov, after a values layout he gave): two rows that
          zig-zag. The headline in a grey panel beside a wide photo (public/1.png), then the story in two
          columns beside a second photo (public/2.png). */}
      <section className="bg-white text-[#16181d]">
        <div className="mx-auto grid w-full max-w-[1440px] gap-[clamp(1rem,2vw,1.75rem)] px-[clamp(1.25rem,0.6rem+2.4vw,3rem)] pb-[clamp(3.5rem,9vh,6rem)] lg:grid-cols-12">
          <div className="flex flex-col justify-between gap-10 rounded-2xl bg-[#f7f8fa] px-[clamp(1.5rem,3.5vw,3.5rem)] py-[clamp(2.25rem,6vh,4rem)] lg:col-span-5">
            <h2 className="text-[clamp(2rem,3.4vw,3.4rem)] leading-[1.1] font-medium tracking-[-0.035em]">
              Built inside the company, for the work it does
            </h2>
            <span aria-hidden="true" className="block h-0.5 w-14 bg-[#f36b21]" />
          </div>
          <img
            src="/1.png"
            alt="Three team members working together at a laptop"
            loading="lazy"
            className="aspect-[16/10] h-full w-full rounded-2xl object-cover object-[50%_45%] lg:col-span-7 lg:aspect-auto lg:min-h-[420px]"
          />

          <div className="grid gap-x-[clamp(1.5rem,3vw,3rem)] gap-y-7 py-[clamp(1rem,3vh,2rem)] text-[clamp(1rem,0.9rem+0.35vw,1.15rem)] leading-[1.8] text-[#2b2f36] sm:grid-cols-2 lg:col-span-7 lg:pr-4">
            <div className="space-y-7">
              <p>
                We believe the best tools come from knowing the work up close. Bishnoi One was not bought off a shelf and
                bent to fit: it was built around how 2MG and GetMeds really sell, approve, pay, stock and deliver medicines.
              </p>
              <p>
                It began with one order and the hands it passes through. As approvals, payments, batches and deliveries
                joined, then the books, people and attendance, each part came onto the same records instead of growing its
                own. That is how {WORKSPACES.length} workspaces came to share one portal.
              </p>
            </div>
            <div className="space-y-7">
              <p>
                We prefer to build things ourselves rather than stitch other people's tools together. Every rule the
                business gives goes straight into the system, and every change is kept, so the records stay whole and the
                past always adds up.
              </p>
              <p>
                2026 marks the move: the old tools step aside as the whole company comes onto Bishnoi One. One company, one
                place, one login for each person. We are only getting started.
              </p>
            </div>
          </div>
          <img
            src="/2.png"
            alt="Team members following a meeting with their laptops open"
            loading="lazy"
            className="aspect-[4/3] h-full w-full rounded-2xl object-cover object-[50%_40%] lg:col-span-5 lg:aspect-auto"
          />
        </div>
      </section>

      {/* One order, start to finish. */}
      <div className="relative">
      {/* One order, start to finish (Aryan, 25 Nov, after a "scope of work" layout he gave, on white):
          a badge, a two-tone title, the three phases' names in one card, thin lines, then each
          phase's checks in a soft card with its icon. */}
      <section className="bg-white pt-2 pb-10 text-[#1d1f1c]">
        <div className="mx-auto w-[min(1140px,calc(100%-32px))]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f36b21] px-3.5 py-2 text-[13px] font-medium text-white">
            <Workflow className="size-3.5" aria-hidden="true" /> The order line
          </span>
          <h2 className="mt-7 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.25] font-semibold tracking-[-0.03em]">
            One order, start to finish
            <br />
            <span className="text-[#8b918a]">Six hands, one record, no retyping</span>
          </h2>

          {/* The phases' names in one card, on computers (on phones, each phase has its own). */}
          <div className="mx-7 mt-20 hidden grid-cols-3 rounded-[20px] border border-[#eceee9] bg-white py-8 shadow-[0_10px_40px_-18px_rgba(40,50,35,0.25)] lg:grid">
            {PHASES.map((phase) => (
              <PhaseName key={phase.title} title={phase.title} who={phase.who} />
            ))}
          </div>

          <ol className="mt-10 grid gap-x-7 gap-y-10 lg:mt-0 lg:grid-cols-3">
            {PHASES.map((phase, p) => (
              <li key={phase.title}>
                <div className="rounded-[20px] border border-[#eceee9] bg-white py-6 shadow-[0_10px_40px_-18px_rgba(40,50,35,0.25)] lg:hidden">
                  <PhaseName title={phase.title} who={phase.who} />
                </div>
                <div aria-hidden="true" className="flex h-[150px] items-end justify-between">
                  {(BARS[p] ?? []).map((height, b) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
                      key={b}
                      className="w-0.5 rounded-full bg-gradient-to-b from-[#ff7a1a] via-[#ffb020] to-[#ffd23f]/0"
                      style={{ height }}
                    />
                  ))}
                </div>
                <div className="relative rounded-[20px] bg-gradient-to-b from-[#edf0eb] to-[#edf0eb]/0 px-7 pt-6 pb-8">
                  <span className="absolute top-6 right-7 grid size-12 place-items-center rounded-xl border border-[#dfe3dc] bg-[#f4f6f2] text-[#2a2d29]">
                    <phase.icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <ul className="grid gap-4 pr-14">
                    {phase.checks.map((check) => (
                      <li key={check} className="flex items-start gap-2.5 text-[17px] leading-snug">
                        <CircleCheck className="mt-[3px] size-4 shrink-0 text-[#4f9a35]" strokeWidth={1.8} aria-hidden="true" />
                        {check}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Culture and values (Aryan, 25 Nov, after a values layout he gave): a small title, then the
          values sliding right to left in a loop, each name beside its own drawing, no boxes. */}
      <section aria-labelledby="values-title" className="bg-white pt-0 pb-[clamp(2.5rem,6vw,4rem)]">
        <div className={wrap}>
          <h2
            id="values-title"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#f36b21] px-3.5 py-2 text-[13px] font-medium text-white"
          >
            <HeartHandshake className="size-3.5" aria-hidden="true" /> Culture and values
          </h2>
        </div>
        <div className="values-marquee mt-8 overflow-hidden">
          <div className="values-track flex w-max">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1 ? true : undefined} className="flex">
                {VALUES.map((value) => (
                  <li key={value.title} className="mr-[clamp(2.5rem,5vw,4.5rem)] flex shrink-0 items-center gap-5">
                    <value.Icon />
                    <h3 className="text-[clamp(1.15rem,1.6vw,1.45rem)] leading-tight font-normal tracking-[-0.01em] whitespace-nowrap text-[#2a2d33]">
                      {value.title}
                    </h3>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>

      {/* Who we are, in four cards beside a photo (Aryan, 25 Nov, after a layout he gave, copied as it
          is, on white): what we keep private, how it was built, the portal at a glance, and how
          its desks split by group (counted from WORKSPACES, not made up). */}
      <section aria-labelledby="who-we-are" className="bg-white px-[clamp(0.75rem,2vw,1.75rem)] pt-2 pb-[clamp(2rem,5vw,4rem)]">
        <h2 id="who-we-are" className="sr-only">
          Who we are
        </h2>
        <div className="mx-auto grid max-w-[1440px] gap-1.5 md:grid-cols-2 lg:grid-cols-[1.05fr_1fr_1fr] lg:grid-rows-[minmax(340px,auto)_minmax(340px,auto)]">
          <img
            src="/4.png"
            alt="Team members in blazers reading papers at the office table"
            loading="lazy"
            className="h-[420px] w-full rounded-2xl object-cover object-[45%_40%] md:col-span-2 lg:col-span-1 lg:row-span-2 lg:h-full"
          />

          <div className="flex min-h-[300px] flex-col justify-between gap-10 rounded-2xl border border-[#e8e8e8] bg-white p-8">
            <Tag>Privacy</Tag>
            <p className="max-w-[32ch] text-[18px] leading-[1.5] text-[#151515]">
              The company's records stay the company's.{" "}
              <span className="text-[#9a9a9a]">
                No ads, no trackers, nothing sold to anyone. Each person sees only what their role needs, and every change is
                kept.
              </span>
            </p>
          </div>

          <div className="flex min-h-[300px] flex-col justify-between gap-10 rounded-2xl border border-[#e8e8e8] bg-white p-8">
            <Tag>Independence</Tag>
            <p className="max-w-[32ch] text-[18px] leading-[1.5] text-[#151515]">
              <span className="text-[#9a9a9a]">Built in-house, not bought off a shelf: </span>
              every rule the business gives goes straight into the system, so we fix what matters to our people, not what a
              vendor chooses.
            </p>
          </div>

          <div className="flex min-h-[300px] flex-col justify-between gap-10 rounded-2xl bg-[#2563eb] p-8 text-white">
            <Tag dark>At a glance</Tag>
            <p className="max-w-[32ch] text-[18px] leading-[1.5]">
              Bishnoi One is the company portal of 2MG &amp; GetMeds, built in 2026 inside the company.{" "}
              <span className="text-white/75">
                Every department uses it, from the field to the books, and each person has one login that opens what their
                role allows.
              </span>
            </p>
          </div>

          <div className="flex min-h-[300px] flex-col justify-between gap-10 rounded-2xl bg-[#ea580c] p-8 text-white">
            <Tag light>Our desks</Tag>
            <p className="max-w-[32ch] text-[18px] leading-[1.5]">
              <span className="text-white/80">{WORKSPACES.length} workspaces in three groups: </span>
              {DESK_SPLIT.map((one) => `${one.count} for ${one.label.toLowerCase()}`).join(", ").replace(/, ([^,]*)$/, " and $1")}, all
              on the same records, so nothing is typed twice.
            </p>
          </div>
        </div>
      </section>


      {/* Built to be trusted (Aryan, 25 Nov, after a case-study layout he gave, kept shorter): the title
          and a line beside it, then the founder's words in a grey card with three small numbered cards
          around it, joined by thin lines. Phones: the quote, then the three cards in a column. */}
      <section aria-labelledby="trust-title" className="bg-white pt-[clamp(3rem,7vw,5rem)] pb-4 text-[#1b1b1b]">
        <div className={wrap}>
          {/* The title as "One order, start to finish": a badge, then a two-tone title (Aryan, 26 Nov). */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f36b21] px-3.5 py-2 text-[13px] font-medium text-white">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Trust
          </span>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
            <h2 id="trust-title" className="text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.25] font-semibold tracking-[-0.03em]">
              Built to be trusted
              <br />
              <span className="text-[#8b918a]">Safe records, clear history</span>
            </h2>
            <p className="max-w-[480px] text-[clamp(0.95rem,0.85rem+0.3vw,1.075rem)] leading-[1.55] text-[#6b6b6b]">
              A company's records are only useful if people can rely on them. Bishnoi One keeps them whole, shows who changed
              what, and lets each person reach only what their work needs.
            </p>
          </div>

          <div className="relative mx-auto mt-10 grid max-w-[1040px] gap-4 lg:mt-12 lg:block lg:h-[720px]">
            {/* The founder's words. */}
            <figure className="rounded-2xl bg-[#e9e9e9] p-[clamp(1.5rem,3.5vw,2.75rem)] lg:absolute lg:top-0 lg:left-[16%] lg:h-[310px] lg:w-[44%]">
              <blockquote className="relative pl-7 text-[clamp(1.15rem,1.9vw,1.4rem)] leading-[1.35] tracking-[-0.01em]">
                <span aria-hidden="true" className="absolute top-[-0.15em] left-0 font-serif text-[2.2em] leading-none text-[#c4c4c4]">
                  &ldquo;
                </span>
                We couldn't see orders, payments and stock in one place. It meant{" "}
                <span className="text-[#9a9a9a]">waiting, chasing and retyping</span> at every desk.
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 pl-7">
                <img src="/CEO.png" alt="" className="size-11 shrink-0 rounded-sm bg-white object-cover object-[50%_22%]" />
                <span>
                  <span className="block text-[13px] font-medium">Naresh Kumar Bishnoi</span>
                  <span className="block text-[11.5px] text-[#8a8a8a]">Founder and CEO</span>
                </span>
              </figcaption>
            </figure>

            {/* The joining lines, on computers: right to the third card, down to the second. */}
            <span aria-hidden="true" className="absolute top-[150px] left-[60%] hidden h-[90px] w-[19%] rounded-tr-2xl border-t border-r border-[#d4d4d4] lg:block" />
            <span aria-hidden="true" className="absolute top-[146px] left-[calc(60%-4px)] hidden size-2 rounded-full bg-[#2f5bea] lg:block" />
            <span aria-hidden="true" className="absolute top-[310px] left-[38%] hidden h-[50px] w-px bg-[#d4d4d4] lg:block" />
            <span aria-hidden="true" className="absolute top-[306px] left-[calc(38%-3.5px)] hidden size-2 rounded-full bg-[#3fbfa0] lg:block" />

            {TRUST_STEPS.map((step, i) => (
              <div
                key={step.color}
                className={`rounded-2xl border border-[#e6e6e6] bg-white p-7 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.25)] lg:absolute lg:w-[27%] ${step.place}`}
              >
                <div aria-hidden="true" className="flex gap-1.5">
                  {[0, 1, 2].map((n) => (
                    <span
                      key={n}
                      className="grid size-7 place-items-center rounded-md text-[12.5px]"
                      style={n === i ? { background: step.color, color: "#fff" } : { background: "#f1f1f1", color: "#a8a8a8" }}
                    >
                      {n + 1}
                    </span>
                  ))}
                </div>
                <p className="mt-6 text-[16px] leading-[1.55] text-[#1b1b1b]">
                  {step.text.map((part, k) =>
                    k % 2 ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sentence
                      <span key={k} className="text-[#9a9a9a]">
                        {part}
                      </span>
                    ) : (
                      part
                    ),
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Questions (Aryan, 26 Nov, after a layout he gave): grey cards and an orange panel, pinned on
          computers while the scroll opens each question. The sign-up banner and "How it works" after it
          were taken off for now (Aryan, 26 Nov). */}
      <Faq />
      {/* The way in for someone new (Aryan, 26 Nov). */}
      <SignUpBanner />


      </div>
    </div>
  );
}
