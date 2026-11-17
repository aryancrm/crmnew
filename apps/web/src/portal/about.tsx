// Below the portal's first screen (Aryan, 18 Nov): what Bishnoi One is and how it works, as one
// long page: one order from start to finish, how signing in works, what each workspace holds, a
// night sky with every part of the company around one record, and why it is safe. Only words and a look.

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
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

const INSIDE = [
  { key: "sales", title: "Orders", text: "Taken in the field or online, then approved, paid, packed and delivered, every step timed." },
  { key: "management", title: "Approvals", text: "Management approves every order before it moves. Nothing ships unapproved." },
  { key: "finance", title: "Money", text: "Invoices, payments, refunds and credits post to the books by themselves." },
  { key: "inventory", title: "Stock", text: "Every batch and expiry in every warehouse; a recall traced to each customer." },
  { key: "dispatch", title: "Delivery", text: "Packing and delivery, each order followed to the customer's door." },
  { key: "online", title: "Online desk", text: "Messenger and website orders, with the patient's Rx, in one queue." },
  { key: "hr", title: "People", text: "The company chart, attendance, leave, payroll, targets and scorecards." },
  { key: "regulatory", title: "Quality", text: "Registrations, samples, complaints and side-effects, each to a due day." },
];

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

const SAFE = [
  { title: "Your own login", text: "Nobody shares an account. Each person signs in with their own ID and password." },
  { title: "Your role decides", text: "Every page and every button checks what your role may do, every time." },
  { title: "Every change kept", text: "Who did it and when, in the audit. Nothing with history is ever deleted." },
];

function Sky() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 1800" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
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

/** A giant planet's edge lit from behind: the night sky's one light. */
function Horizon() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[clamp(420px,46vw,470px)] bottom-0 overflow-visible">
      <div className="sun-breathe absolute top-0 left-1/2 h-40 w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(255,170,90,0.55),rgba(243,107,33,0.18)_55%,transparent)] blur-2xl" />
      <div
        className="absolute top-0 left-1/2 aspect-square w-[max(2600px,220vw)] -translate-x-1/2 rounded-full bg-[#04050b]"
        style={{
          boxShadow:
            "0 -1px 0 0 rgba(255,214,170,0.95), 0 -6px 24px -4px rgba(255,150,70,0.65), 0 -40px 120px -10px rgba(243,107,33,0.35), 0 -90px 220px -40px rgba(95,208,139,0.18), inset 0 40px 120px -40px rgba(243,107,33,0.25)",
        }}
      />
      <div className="absolute top-0 left-1/2 h-[3px] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-[#fff3e2] to-transparent blur-[1px]" />
    </div>
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
    <section className="border-y border-white/80 bg-white/50 backdrop-blur">
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
      {/* One order, start to finish. */}
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

      {/* How signing in works. */}
      <section className={`${wrap} pb-24`}>
        <div className="rounded-[2.5rem] border border-white/90 bg-white/40 px-6 py-16 shadow-[0_30px_70px_-50px_rgba(20,30,50,0.4)] backdrop-blur md:px-12">
          <p className={`${eyebrow} text-center text-[#c2410c]`}>How it works</p>
          <h2 className={`${h2} mx-auto mt-4 max-w-3xl text-center`}>
            One portal. <span className="text-[#f36b21]">Your own login.</span> The same records.
          </h2>
          <ol className="relative mt-14 grid gap-5 md:grid-cols-3">
            <span aria-hidden="true" className="absolute top-12 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-[#f36b21]/0 via-[#f36b21]/40 to-[#1f9d55]/0 md:block" />
            {[
              ["Pick your workspace", "Sales and field, management, finance, stock, dispatch, people: each department has its own door."],
              ["Sign in as yourself", "Your own login ID and password. Your role decides what you see and what you can do."],
              ["Work from one record", "An order, its stock, its invoice and its payment are the same record for everyone who touches it."],
            ].map(([title, text], i) => (
              <li key={title} className="relative rounded-[2rem] border border-white/90 bg-white/80 p-8 shadow-[0_24px_50px_-30px_rgba(20,30,50,0.35)] backdrop-blur-xl">
                <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#ff9a5a] to-[#f36b21] text-base font-bold text-white shadow-[0_10px_20px_-8px_rgba(243,107,33,0.6)]">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#5b6472]">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Seats />

      {/* The night sky: everything turns around one record. */}
      <section className="relative overflow-hidden bg-[#03040a] text-white">
        <Sky />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-40 size-[40rem] rounded-full bg-[#3b2a8f] opacity-20 blur-[140px]" />
          <div className="absolute -top-20 -right-40 size-[34rem] rounded-full bg-[#0f6b45] opacity-15 blur-[140px]" />
        </div>
        <Horizon />
        <div className={`relative ${wrap} pt-28 text-center`}>
          <p className={`${eyebrow} text-[#ff9a5a]`}>What is inside</p>
          <h2 className={`${h2} mx-auto mt-4 max-w-3xl`}>
            Every part of the company, around{" "}
            <span className="bg-gradient-to-r from-[#ffd38a] via-[#ff8a3d] to-[#f36b21] bg-clip-text text-transparent">one record</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/60">
            An order is entered once. Approval, payment, stock, delivery and the books all read and write the same record, so
            nobody types it twice and nobody works from an old copy.
          </p>
        </div>
        <div className={`relative ${wrap} pt-[clamp(150px,14vw,190px)] pb-28`}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INSIDE.map((one) => {
              const Icon = TILE_ICONS[one.key];
              return (
                <li
                  key={one.title}
                  className="group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.07]"
                >
                  <span aria-hidden="true" className="absolute -top-10 -right-10 size-32 rounded-full opacity-20 blur-3xl transition-opacity group-hover:opacity-40" style={{ background: TILE_GLOW[one.key] }} />
                  <span className="relative block size-10">{Icon && <Icon />}</span>
                  <h3 className="relative mt-5 text-lg font-semibold">{one.title}</h3>
                  <p className="relative mt-1.5 text-sm leading-relaxed text-white/60">{one.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Why it is safe. */}
      <section className={`${wrap} py-24 text-center`}>
        <p className={`${eyebrow} text-[#c2410c]`}>Safe by design</p>
        <h2 className={`${h2} mx-auto mt-4 max-w-2xl`}>Your work, kept straight.</h2>
        <ul className="mt-12 grid gap-5 text-left md:grid-cols-3">
          {SAFE.map((one) => (
            <li key={one.title} className="rounded-[2rem] border border-white/90 bg-white/70 p-8 shadow-[0_24px_50px_-30px_rgba(20,30,50,0.35)] backdrop-blur-xl">
              <h3 className="text-xl font-semibold tracking-[-0.02em]">{one.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5b6472]">{one.text}</p>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="mt-14 inline-flex items-center gap-2 rounded-full bg-[#f36b21] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_16px_34px_-12px_rgba(243,107,33,0.7)] transition hover:bg-[#e05a12]"
        >
          Choose your workspace <ArrowRight className="size-4" aria-hidden="true" />
        </button>
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
  );
}
