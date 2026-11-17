// Below the portal's first screen (Aryan, 18 Nov): what Bishnoi One is and how it works, as one
// long page: what each workspace holds, a black hole with every part of the company around one
// record, one order from start to finish, the field, the books, how it works, questions, the footer. Only words and a look.

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TILE_GLOW, TILE_ICONS } from "./tiles";
import { WORKSPACES } from "../workspaces";

const wrap = "mx-auto w-[min(1140px,calc(100%-32px))]";
const eyebrow = "text-[11px] font-semibold tracking-[0.24em] uppercase";
const h2 = "text-[clamp(30px,4.2vw,52px)] leading-[1.05] font-semibold tracking-[-0.04em]";



const JOURNEY = [
  { who: "MedRep or Online desk", what: "takes the order", more: "with the Rx for a patient's purchase" },
  { who: "Management", what: "approves it", more: "price and customer checked" },
  { who: "Finance", what: "confirms the payment", more: "cash, transfer, cheque or terms" },
  { who: "Inventory", what: "gives the batch", more: "expiry and cost kept" },
  { who: "Dispatch", what: "packs and delivers", more: "to the customer's door" },
  { who: "The books", what: "post themselves", more: "sale, payment and cost" },
];

/** What each workspace holds, from its own menu (src/menus.ts). */
const DETAILS: Record<string, { who: string; points: string[] }> = {
  sales: {
    who: "MedReps, team leads and the head of each channel",
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
  admin: {
    who: "Setup, logins and the audit",
    points: ["People, seats and logins", "Company settings", "The audit: who did what, and when", "Data checks"],
  },
};

const FIELD = [
  "Today's visits, the plan and the calendar",
  "An order taken at the counter, with the patient's Rx",
  "What each hospital owes, before you walk in",
  "Samples and gifts handed out, counted",
  "Your score, always up to date",
];

const BOOKS = [
  ["Profit and loss", "By month, branch and channel."],
  ["Balance sheet", "What the company owns and owes, today."],
  ["Cash flow", "Where the money came from and went."],
  ["VAT", "Output and input tax, ready to file."],
  ["Customers owe", "Every unpaid invoice, by age."],
  ["Payables", "What the company owes its vendors, by age."],
  ["Gross profit", "By medicine, channel, customer and order."],
  ["Trial balance", "Every account, debits against credits."],
];

const QUESTIONS = [
  ["Which workspace do I press?", "Your own department's. Whichever you press, your login opens your own pages."],
  ["I forgot my password.", "Ask your administrator; they will set a new one."],
  ["Can I see other people's work?", "Only what your role allows. Leads and heads see their own team's."],
  ["Does it work on the phone?", "Yes, in the phone's browser. The field pages are made for it."],
  ["Is anything ever deleted?", "No. A mistake is cancelled or reversed, and the audit keeps who did what and when."],
];

/** A thin line between two sections. */
const Rule = () => (
  <div aria-hidden="true" className="mx-auto h-px w-[min(1140px,calc(100%-32px))] bg-gradient-to-r from-transparent via-[#1f2733]/15 to-transparent" />
);

/** A phone with a rep's day on it, drawn, not a photo. */
function Phone() {
  const rows = [
    ["9:00", "Visit", "#34b261"],
    ["10:30", "Order", "#f36b21"],
    ["12:00", "Collection", "#8b5cf6"],
    ["14:30", "Visit", "#34b261"],
    ["16:00", "Samples", "#f5a524"],
  ];
  return (
    <div className="relative mx-auto w-[min(300px,80vw)]">
      <div aria-hidden="true" className="absolute inset-8 rounded-full bg-[#34b261] opacity-25 blur-[80px]" />
      <div className="relative rounded-[2.75rem] border border-white bg-[#11151c] p-2.5 shadow-[0_50px_90px_-40px_rgba(20,30,50,0.6)]">
        <div className="overflow-hidden rounded-[2.2rem] bg-[#f6f7fb]">
          <div className="flex items-center justify-between px-6 pt-4 text-[11px] font-semibold text-[#1f2733]">
            <span>9:41</span>
            <span className="h-5 w-20 rounded-full bg-[#11151c]" />
            <span>100%</span>
          </div>
          <div className="px-5 pt-5 pb-6">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#8a93a3] uppercase">Today</p>
            <p className="mt-1 text-xl font-semibold tracking-[-0.02em]">Your visits</p>
            <ul className="mt-4 grid gap-2">
              {rows.map(([time, what, tone]) => (
                <li key={time} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-[0_6px_16px_-12px_rgba(20,30,50,0.4)]">
                  <span className="w-11 text-xs font-semibold text-[#5b6472] tabular-nums">{time}</span>
                  <span className="size-2 rounded-full" style={{ background: tone }} />
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium">{what}</span>
                    <span className="mt-1 block h-1.5 w-2/3 rounded-full bg-[#1f2733]/[0.07]" />
                  </span>
                </li>
              ))}
            </ul>
            <span className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-[#f36b21] text-sm font-semibold text-white">New order</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const CLOSE = [
  { title: "Pick your workspace", text: "Each department has its own door: sales and field, management, finance, stock, dispatch, people." },
  { title: "Sign in as yourself", text: "Your own login ID and password. Your role decides what you see and what you can do." },
  { title: "Every change kept", text: "Who did it and when, in the audit. Nothing with history is ever deleted." },
];


function Seats() {
  const [open, setOpen] = useState(WORKSPACES[0]?.key ?? "sales");
  const chosen = WORKSPACES.find((one) => one.key === open) ?? WORKSPACES[0];
  const Detail = ({ inline }: { inline?: boolean }) => {
    if (!chosen) return null;
    const detail = DETAILS[chosen.key];
    const Icon = TILE_ICONS[chosen.key];
    return (
      <div className={`relative overflow-hidden rounded-[2rem] border border-white bg-white/85 shadow-[0_30px_60px_-34px_rgba(20,30,50,0.45)] backdrop-blur-xl ${inline ? "mt-2 p-6" : "p-9"}`}>
        <span aria-hidden="true" className="absolute -top-24 -right-24 size-72 rounded-full opacity-20 blur-3xl" style={{ background: TILE_GLOW[chosen.key] }} />
        <div className="relative flex items-center gap-4">
          {!inline && (
            <span className="relative grid size-16 shrink-0 place-items-center rounded-[1.25rem] border border-white bg-white shadow-[0_14px_30px_-16px_rgba(20,30,50,0.35)]">
              <span className="size-9">{Icon && <Icon />}</span>
            </span>
          )}
          <div>
            {!inline && <h3 className="text-2xl font-semibold tracking-[-0.03em]">{chosen.label}</h3>}
            <p className="text-[15px] text-[#5b6472]">{detail?.who}</p>
          </div>
        </div>
        <p className={`relative ${inline ? "mt-4" : "mt-7"} text-[11px] font-semibold tracking-[0.2em] text-[#8a93a3] uppercase`}>What you do here</p>
        <ul className="relative mt-3 grid gap-2.5">
          {detail?.points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-[15px] text-[#2b3340]">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white" style={{ background: TILE_GLOW[chosen.key] }}>
                <Check className="size-3" strokeWidth={3} aria-hidden="true" />
              </span>
              {point}
            </li>
          ))}
        </ul>
        <p className="relative mt-7 border-t border-black/5 pt-4 text-[13px] text-[#8a93a3]">
          Everyone also has their own leave, forms, payslips and messages.
        </p>
      </div>
    );
  };
  return (
    <section className="relative">
      <div className={`${wrap} py-24`}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className={`${eyebrow} text-[#c2410c]`}>Built for every seat</p>
            <h2 className={`${h2} mt-4 max-w-2xl`}>{WORKSPACES.length} workspaces, one company.</h2>
          </div>
          <p className="max-w-sm text-[15px] leading-relaxed text-[#5b6472]">Press a workspace to see who it is for and what is inside.</p>
        </div>
        <div className="mt-12 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <ul className="grid gap-2 sm:grid-cols-2">
            {WORKSPACES.map((one) => {
              const Icon = TILE_ICONS[one.key];
              const on = one.key === open;
              return (
                <li key={one.key} className={on ? "sm:col-span-2 lg:col-span-1" : undefined}>
                  <button
                    type="button"
                    onClick={() => setOpen(one.key)}
                    aria-expanded={on}
                    className={`group flex w-full items-center gap-3 rounded-[1.25rem] border p-3 text-left transition ${on ? "border-white bg-white shadow-[0_18px_36px_-24px_rgba(20,30,50,0.45)]" : "border-transparent hover:border-white hover:bg-white/70"}`}
                  >
                    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-[#f6f7fb]">
                      <span aria-hidden="true" className={`absolute inset-1.5 rounded-lg blur-md transition-opacity ${on ? "opacity-40" : "opacity-15"}`} style={{ background: TILE_GLOW[one.key] }} />
                      <span className="relative size-6">{Icon && <Icon />}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] ${on ? "font-semibold" : "font-medium"}`}>{one.label}</span>
                      <span className="block truncate text-[13px] text-[#7a8394]">{one.about}</span>
                    </span>
                    <span aria-hidden="true" className={`h-6 w-1 rounded-full transition ${on ? "bg-[#f36b21]" : "bg-transparent"}`} />
                  </button>
                  {on && (
                    <div className="lg:hidden">
                      <Detail inline />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="sticky top-6 hidden lg:block">
            <Detail />
          </div>
        </div>
      </div>
    </section>
  );
}

export function About() {
  return (
    <div id="about" className="relative">
      <Rule />
      <Seats />

      <Rule />

      {/* The black hole: everything turns around one record. */}
      <section className="relative isolate overflow-hidden bg-[#020203] text-white">
        <div className="relative h-[clamp(560px,86vh,820px)]">
          {/* One bright light in the middle: the record everything turns around. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="sun-breathe absolute top-[58%] left-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,170,90,0.45),rgba(243,107,33,0.12)_55%,transparent)]" />
            <div className="absolute top-[58%] left-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,#ffffff,#fff3dc_30%,rgba(255,196,120,0.75)_55%,transparent)] blur-[2px]" />
            <div className="absolute top-[58%] left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_60px_30px_rgba(255,236,210,0.9),0_0_160px_80px_rgba(255,170,90,0.45)]" />
            <div className="absolute top-[58%] left-1/2 h-[2px] w-[80%] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-[#fff4e6] to-transparent" />
            <div className="absolute top-[58%] left-1/2 h-10 w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,220,180,0.35),transparent)] blur-md" />
          </div>
          <div className={`relative ${wrap} pt-24 text-center`}>
            <p className="text-[11px] font-medium tracking-[0.42em] text-white/50 uppercase">What is inside</p>
            <h2 className="mx-auto mt-6 max-w-3xl text-[clamp(34px,5vw,64px)] leading-[1.02] font-medium tracking-[-0.045em] text-white [text-shadow:0_2px_30px_rgba(0,0,0,0.6)]">
              Every part of the company,
              <br />
              around <span className="font-[Iowan_Old_Style,Palatino,Georgia,serif] font-normal tracking-[-0.02em] text-[#ffd9b3] italic">one record.</span>
            </h2>
          </div>
          <p className={`absolute inset-x-0 bottom-16 mx-auto max-w-lg px-4 text-center text-[15px] leading-relaxed text-white/60 [text-shadow:0_2px_20px_rgba(0,0,0,0.8)]`}>
            An order is entered once. Approval, payment, stock, delivery and the books all read and write the same record, so
            nobody types it twice and nobody works from an old copy.
          </p>
        </div>
      </section>

      {/* One order, start to finish. */}
      <div className="relative">
      <section className={`${wrap} py-24`}>
        <p className={`${eyebrow} text-[#1f9d55]`}>One order, start to finish</p>
        <h2 className={`${h2} mt-4 max-w-3xl`}>
          Six hands, <span className="text-[#1f9d55]">one record</span>, no retyping.
        </h2>
        <ol className="mt-14 grid gap-6 md:grid-cols-3 lg:grid-cols-6">
          {JOURNEY.map((step, i) => (
            <li key={step.who} className="relative">
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[#1f9d55]/30 bg-white text-sm font-bold text-[#1f9d55] shadow-sm">{i + 1}</span>
                {i < JOURNEY.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-gradient-to-r from-[#1f9d55]/40 to-[#f36b21]/30 lg:block" />}
              </div>
              <p className="mt-4 text-[12px] font-semibold tracking-wide text-[#8a93a3] uppercase">{step.who}</p>
              <p className="mt-1 text-lg leading-snug font-semibold tracking-[-0.02em]">{step.what}</p>
              <p className="mt-1 text-sm text-[#5b6472]">{step.more}</p>
            </li>
          ))}
        </ol>
      </section>

      <Rule />

      {/* In the field. */}
      <section className={`${wrap} grid items-center gap-14 py-24 lg:grid-cols-2`}>
        <div>
          <p className={`${eyebrow} text-[#1f9d55]`}>In the field</p>
          <h2 className={`${h2} mt-4`}>The office in a MedRep's pocket.</h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#5b6472]">
            Made for the phone first. Everything a rep needs between two visits, without calling the office.
          </p>
          <ul className="mt-8 grid gap-3.5">
            {FIELD.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] text-[#2b3340]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#1f9d55] text-white">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <Phone />
      </section>

      <Rule />

      {/* The books. */}
      <section className={`${wrap} py-24`}>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-end">
          <div>
            <p className={`${eyebrow} text-[#7c3aed]`}>Money</p>
            <h2 className={`${h2} mt-4`}>Books that keep themselves.</h2>
          </div>
          <p className="max-w-lg text-[15px] leading-relaxed text-[#5b6472]">
            Every invoice, payment, refund, return and stock movement posts to the right accounts as it happens. Finance checks; nobody
            re-enters.
          </p>
        </div>
        <ul className="mt-12 grid gap-px overflow-hidden rounded-[2rem] border border-white bg-[#1f2733]/[0.06] shadow-[0_30px_60px_-40px_rgba(20,30,50,0.4)] sm:grid-cols-2 lg:grid-cols-4">
          {BOOKS.map(([title, text]) => (
            <li key={title} className="bg-white/80 p-6 backdrop-blur">
              <h3 className="font-semibold tracking-[-0.01em]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#5b6472]">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <Rule />

      {/* The close: how it works, in three lines, and the way in. */}
      <section className="relative">
        <div className={`relative ${wrap} py-28 text-center`}>
          <p className={`${eyebrow} text-[#c2410c]`}>How it works</p>
          <h2 className={`${h2} mx-auto mt-4 max-w-3xl`}>
            One portal. <span className="text-[#f36b21]">Your own login.</span> The same records.
          </h2>
          <ol className="mx-auto mt-16 grid max-w-4xl text-left md:grid-cols-3 md:divide-x md:divide-[#1f2733]/10">
            {CLOSE.map((one, i) => (
              <li key={one.title} className="px-2 py-5 md:px-8 md:py-0">
                <span className="text-sm font-semibold text-[#f36b21] tabular-nums">0{i + 1}</span>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">{one.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#5b6472]">{one.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-16 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="inline-flex items-center gap-2 rounded-full bg-[#1f2733] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_16px_34px_-14px_rgba(20,30,50,0.6)] transition hover:bg-black"
            >
              Choose your workspace <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <Link to="/login?with=password" className="inline-flex items-center gap-2 rounded-full border border-[#1f2733]/15 bg-white/70 px-7 py-3.5 text-sm font-semibold text-[#1f2733] transition hover:bg-white">
              Log in with ID and password
            </Link>
          </div>
        </div>
      </section>

      <Rule />

      {/* Questions. */}
      <section className={`${wrap} grid gap-10 py-24 lg:grid-cols-[1fr_1.6fr]`}>
        <div>
          <p className={`${eyebrow} text-[#c2410c]`}>Questions</p>
          <h2 className={`${h2} mt-4`}>Before you sign in.</h2>
        </div>
        <div className="divide-y divide-[#1f2733]/10 border-y border-[#1f2733]/10">
          {QUESTIONS.map(([question, answer]) => (
            <details key={question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {question}
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-[#1f2733]/10 text-[#8a93a3] transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5b6472]">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-t border-black/5">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-3 py-8 text-sm text-[#8a93a3]`}>
          <span className="flex items-center gap-2.5">
            <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
            <span className="font-semibold text-[#1f2733]">Bishnoi One</span>
          </span>
          <span>Each person signs in as themselves · Need access? Ask your administrator</span>
        </div>
      </footer>
      </div>
    </div>
  );
}
