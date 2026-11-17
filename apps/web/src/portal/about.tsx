// Below the portal's first screen (Aryan, 18 Nov): what Bishnoi One is and how it works, as one
// long page: what each workspace holds, a night sky with every part of the company turning around
// one record, one order from start to finish, how it works, and the footer. Only words and a look.

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
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

/** The sun is the one record; the departments turn around it. Each planet is a lit sphere whose
 *  bright side always faces the sun (it turns as it travels), with a glass label that stays upright. */
const PLANETS = [
  { name: "Orders", rx: 175, color: "#34b261", light: "#b8f5cc", r: 10, dur: 18, at: 3 },
  { name: "Money", rx: 280, color: "#8b5cf6", light: "#dccbff", r: 13, dur: 28, at: 17 },
  { name: "Stock", rx: 395, color: "#f5a524", light: "#ffe7a8", r: 15, dur: 40, at: 6, ring: true },
  { name: "Delivery", rx: 515, color: "#ff6b4a", light: "#ffd0c2", r: 12, dur: 54, at: 41 },
  { name: "People", rx: 640, color: "#3b82f6", light: "#c7dcff", r: 17, dur: 72, at: 26 },
];
const SUN = { x: 720, y: 300 };
const TILT = 0.3;
const orbit = (rx: number) => {
  const ry = rx * TILT;
  return `M${SUN.x - rx},${SUN.y} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0`;
};

function SolarSystem() {
  return (
    <svg viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Orders, money, stock, delivery and people turning around one record" className="h-full w-full overflow-visible">
      <defs>
        <radialGradient id="sun-core" cx=".5" cy=".5" r=".5" fx=".42" fy=".4">
          <stop offset="0" stopColor="#fffef8" />
          <stop offset=".3" stopColor="#fff1c9" />
          <stop offset=".62" stopColor="#ffbe6b" />
          <stop offset=".88" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#f0641e" />
        </radialGradient>
        <radialGradient id="sun-corona">
          <stop offset=".45" stopColor="#ffb26b" stopOpacity=".55" />
          <stop offset=".7" stopColor="#ff7a2e" stopOpacity=".16" />
          <stop offset="1" stopColor="#ff7a2e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sun-wide">
          <stop offset="0" stopColor="#ff9a4a" stopOpacity=".22" />
          <stop offset=".5" stopColor="#f36b21" stopOpacity=".07" />
          <stop offset="1" stopColor="#f36b21" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="flare" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#ffe9cc" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {/* An orbit is faint behind the sun and brighter in front. */}
        <linearGradient id="orbit-line" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".05" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".1" />
          <stop offset="1" stopColor="#fff" stopOpacity=".28" />
        </linearGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        {PLANETS.map((planet) => (
          <radialGradient key={planet.name} id={`planet-${planet.name}`} cx=".5" cy=".5" r=".55" fx=".5" fy=".18">
            <stop offset="0" stopColor={planet.light} />
            <stop offset=".35" stopColor={planet.color} />
            <stop offset=".8" stopColor={planet.color} stopOpacity=".55" />
            <stop offset="1" stopColor="#05060c" />
          </radialGradient>
        ))}
        <linearGradient id="ring-line" x1="0" x2="1">
          <stop offset="0" stopColor="#ffe7a8" stopOpacity=".1" />
          <stop offset=".5" stopColor="#ffe7a8" stopOpacity=".75" />
          <stop offset="1" stopColor="#ffe7a8" stopOpacity=".1" />
        </linearGradient>
      </defs>

      {PLANETS.map((planet) => (
        <path key={planet.name} d={orbit(planet.rx)} fill="none" stroke="url(#orbit-line)" strokeWidth="1" />
      ))}

      {/* The sun: a wide warm light, a corona, slow rays, a lens streak and the bright core. */}
      <circle cx={SUN.x} cy={SUN.y} r="420" fill="url(#sun-wide)" />
      <circle cx={SUN.x} cy={SUN.y} r="130" fill="url(#sun-corona)" className="sun-breathe" />
      <g opacity=".5">
        {Array.from({ length: 36 }, (_, i) => (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ring
            key={i}
            x1={SUN.x}
            y1={SUN.y - 66}
            x2={SUN.x}
            y2={SUN.y - (i % 3 === 0 ? 150 : 108)}
            stroke="#ffcf94"
            strokeOpacity={i % 3 === 0 ? 0.22 : 0.12}
            strokeWidth="1.2"
            strokeLinecap="round"
            transform={`rotate(${i * 10} ${SUN.x} ${SUN.y})`}
          />
        ))}
        <animateTransform attributeName="transform" type="rotate" from={`0 ${SUN.x} ${SUN.y}`} to={`360 ${SUN.x} ${SUN.y}`} dur="140s" repeatCount="indefinite" />
      </g>
      <rect x={SUN.x - 420} y={SUN.y - 1} width="840" height="2" rx="1" fill="url(#flare)" />
      <circle cx={SUN.x} cy={SUN.y} r="66" fill="#ffb066" opacity=".55" filter="url(#soft)" />
      <circle cx={SUN.x} cy={SUN.y} r="58" fill="url(#sun-core)" />
      <text x={SUN.x} y={SUN.y + 104} textAnchor="middle" fill="#ffd9b8" fillOpacity=".9" fontSize="11" fontWeight="600" letterSpacing="4">
        ONE RECORD
      </text>

      {PLANETS.map((planet) => {
        const move = { dur: `${planet.dur}s`, begin: `-${planet.at}s`, repeatCount: "indefinite", path: orbit(planet.rx) } as const;
        const width = planet.name.length * 7 + 22;
        return (
          <g key={planet.name}>
            {planet.ring && (
              <g>
                <path d={`M${-planet.r * 2.1},0 A${planet.r * 2.1},${planet.r * 0.55} 0 0,1 ${planet.r * 2.1},0`} fill="none" stroke="url(#ring-line)" strokeWidth="2" />
                <animateMotion {...move} />
              </g>
            )}
            <g>
              <circle r={planet.r * 1.9} fill={planet.color} opacity=".14" filter="url(#soft)" />
              <circle r={planet.r} fill={`url(#planet-${planet.name})`} />
              <circle r={planet.r} fill="none" stroke={planet.light} strokeOpacity=".25" strokeWidth=".8" />
              <animateMotion {...move} rotate="auto" />
            </g>
            {planet.ring && (
              <g>
                <path d={`M${-planet.r * 2.1},0 A${planet.r * 2.1},${planet.r * 0.55} 0 0,0 ${planet.r * 2.1},0`} fill="none" stroke="url(#ring-line)" strokeWidth="2" />
                <animateMotion {...move} />
              </g>
            )}
            <g>
              <g transform={`translate(0 ${planet.r + 20})`}>
                <rect x={-width / 2} y="-11" width={width} height="22" rx="11" fill="#0b0d18" fillOpacity=".7" stroke="#fff" strokeOpacity=".14" />
                <text y="4" textAnchor="middle" fill="#fff" fillOpacity=".86" fontSize="11" fontWeight="500" letterSpacing=".4">
                  {planet.name}
                </text>
              </g>
              <animateMotion {...move} />
            </g>
          </g>
        );
      })}
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
      <Seats />

      {/* The night sky: everything turns around one record. */}
      <section className="relative overflow-hidden bg-[#03040a] text-white">
        <Sky />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-40 size-[40rem] rounded-full bg-[#3b2a8f] opacity-20 blur-[140px]" />
          <div className="absolute -right-40 -bottom-40 size-[34rem] rounded-full bg-[#0f6b45] opacity-15 blur-[140px]" />
        </div>
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
        <div className="relative mx-auto h-[clamp(320px,50vw,700px)] w-[min(1440px,100%)] pb-10">
          <SolarSystem />
        </div>
      </section>

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

      {/* The close: how it works, in three lines, and the way in. */}
      <section className="relative overflow-hidden border-t border-white/80 bg-gradient-to-b from-white/60 to-[#fdf3ec]">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-[#ffd9c2] opacity-50 blur-[140px]" />
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

      <footer className="bg-[#0b0d14] text-white">
        <div className={`${wrap} grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
          <div>
            <span className="flex items-center gap-3">
              <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10" />
              <span className="text-xl font-semibold tracking-[-0.03em]">Bishnoi One</span>
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">One company. Every department, one place. Each person signs in as themselves.</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-white/40 uppercase">Selling</p>
            <ul className="mt-4 grid gap-2.5 text-sm text-white/75">
              {WORKSPACES.filter((one) => one.group === "selling").map((one) => <li key={one.key}>{one.label}</li>)}
            </ul>
            <p className="mt-7 text-xs font-semibold tracking-[0.18em] text-white/40 uppercase">Operations</p>
            <ul className="mt-4 grid gap-2.5 text-sm text-white/75">
              {WORKSPACES.filter((one) => one.group === "operations").map((one) => <li key={one.key}>{one.label}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-white/40 uppercase">Office</p>
            <ul className="mt-4 grid gap-2.5 text-sm text-white/75">
              {WORKSPACES.filter((one) => one.group === "office").map((one) => <li key={one.key}>{one.label}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-white/40 uppercase">Sign in</p>
            <ul className="mt-4 grid gap-2.5 text-sm text-white/75">
              <li>
                <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="hover:text-white">
                  Choose your workspace
                </button>
              </li>
              <li>
                <Link to="/login?with=password" className="hover:text-white">Log in with ID and password</Link>
              </li>
            </ul>
            <p className="mt-7 text-xs font-semibold tracking-[0.18em] text-white/40 uppercase">Help</p>
            <p className="mt-4 text-sm leading-relaxed text-white/75">Need access or a new password? Ask your administrator.</p>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className={`${wrap} flex flex-wrap items-center justify-between gap-3 py-6 text-xs text-white/40`}>
            <span>© {new Date().getFullYear()} Bishnoi One</span>
            <span>Every change is kept: who did it and when.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
