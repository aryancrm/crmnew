// Below the portal's first screen (Aryan, 18 Nov): what Bishnoi One is and how it works, as one
// long page: what each workspace holds, a night sky with every part of the company turning around
// one record, one order from start to finish, how it works, and the footer. Only words and a look.

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Cosmos } from "./cosmos";
import { TILE_GLOW, TILE_ICONS } from "./tiles";
import { WORKSPACES } from "../workspaces";

const wrap = "mx-auto w-[min(1140px,calc(100%-32px))]";
const eyebrow = "text-[11px] font-semibold tracking-[0.24em] uppercase";
const h2 = "text-[clamp(30px,4.2vw,52px)] leading-[1.05] font-semibold tracking-[-0.04em]";

/** Same numbers every time, so the sky doesn't jump between visits. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seeded(18_11_2026);
const STARS = Array.from({ length: 260 }, (_, i) => ({
  x: random() * 1440,
  y: random() * 1800,
  r: random() < 0.08 ? 1.6 + random() : 0.4 + random() * 0.9,
  o: 0.25 + random() * 0.6,
  twinkle: i % 4 === 0,
  delay: random() * 4,
  dur: 2.4 + random() * 3,
}));


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

const CLOSE = [
  { title: "Pick your workspace", text: "Each department has its own door: sales and field, management, finance, stock, dispatch, people." },
  { title: "Sign in as yourself", text: "Your own login ID and password. Your role decides what you see and what you can do." },
  { title: "Every change kept", text: "Who did it and when, in the audit. Nothing with history is ever deleted." },
];

function Sky() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 1800" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full [mask-image:linear-gradient(to_bottom,transparent_0,black_280px,black_calc(100%-280px),transparent_100%)]">
      {STARS.map((star, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
          key={i}
          cx={star.x}
          cy={star.y}
          r={star.r}
          fill="#fff"
          opacity={star.o}
          className={star.twinkle ? "star-twinkle" : undefined}
          style={star.twinkle ? { animationDelay: `${star.delay}s`, animationDuration: `${star.dur}s` } : undefined}
        />
      ))}
    </svg>
  );
}

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
      <Seats />

      {/* The night sky: everything turns around one record. */}
      <section className="relative overflow-hidden bg-[linear-gradient(to_bottom,rgba(3,4,10,0)_0,rgba(3,4,10,0.35)_90px,rgba(3,4,10,0.85)_200px,#03040a_300px,#03040a_calc(100%-300px),rgba(3,4,10,0.85)_calc(100%-200px),rgba(3,4,10,0.35)_calc(100%-90px),rgba(3,4,10,0)_100%)] text-white">
        <Sky />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute top-[320px] -left-40 size-[40rem] rounded-full bg-[#3b2a8f] opacity-20 blur-[140px]" />
          <div className="absolute -right-40 bottom-[320px] size-[34rem] rounded-full bg-[#0f6b45] opacity-15 blur-[140px]" />
        </div>
        <div className={`relative ${wrap} pt-[22rem] text-center`}>
          <p className="text-[11px] font-medium tracking-[0.42em] text-white/45 uppercase">What is inside</p>
          <h2 className="mx-auto mt-6 max-w-3xl text-[clamp(34px,5vw,64px)] leading-[1.02] font-medium tracking-[-0.045em] text-white">
            Every part of the company,
            <br />
            around <span className="font-[Iowan_Old_Style,Palatino,Georgia,serif] font-normal tracking-[-0.02em] text-[#ffd9b3] italic">one record.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-white/50">
            An order is entered once. Approval, payment, stock, delivery and the books all read and write the same record, so
            nobody types it twice and nobody works from an old copy.
          </p>
        </div>
        <div className="relative mx-auto mt-6 mb-[18rem] h-[clamp(380px,52vw,720px)] w-[min(1440px,100%)]">
          <Cosmos />
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
