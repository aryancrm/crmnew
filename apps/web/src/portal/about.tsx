// Below the portal's first screen (Aryan, 18 Nov): what Bishnoi One is and how it works, as one
// long page: how signing in works, a night sky with the company turning around one record, one
// order from start to finish, a tile for every seat, and why it is safe. Only words and a look.

import { ArrowRight } from "lucide-react";
import { TILE_GLOW, TILE_ICONS } from "./tiles";
import { type Workspace, WORKSPACES } from "../workspaces";

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

const PLANETS = [
  { name: "Orders", rx: 170, color: "#34b261", r: 7, dur: 16, at: 2 },
  { name: "Money", rx: 270, color: "#a259ff", r: 9, dur: 26, at: 15 },
  { name: "Stock", rx: 380, color: "#f5a524", r: 10, dur: 38, at: 8 },
  { name: "Delivery", rx: 500, color: "#ff7a59", r: 8, dur: 52, at: 40 },
  { name: "People", rx: 630, color: "#4c9bff", r: 11, dur: 70, at: 22 },
];
const SUN = { x: 720, y: 290 };
const ellipse = (rx: number) => {
  const ry = rx * 0.3;
  return `M${SUN.x - rx},${SUN.y} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0`;
};

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

/** The sun is the one record; the departments turn around it. */
function SolarSystem() {
  return (
    <svg viewBox="0 0 1440 580" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Orders, money, stock, delivery and people turning around one record" className="h-full w-full">
      <defs>
        <radialGradient id="sun-core">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset=".35" stopColor="#ffe3a3" />
          <stop offset=".75" stopColor="#ffa24a" />
          <stop offset="1" stopColor="#f36b21" />
        </radialGradient>
        <radialGradient id="sun-glow">
          <stop offset="0" stopColor="#ffb25e" stopOpacity=".55" />
          <stop offset=".4" stopColor="#f36b21" stopOpacity=".18" />
          <stop offset="1" stopColor="#f36b21" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="flare" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#ffe7c4" stopOpacity=".7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {PLANETS.map((planet) => (
        <path key={planet.name} d={ellipse(planet.rx)} fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth="1" />
      ))}
      <circle cx={SUN.x} cy={SUN.y} r="300" fill="url(#sun-glow)" className="sun-breathe" />
      <rect x={SUN.x - 460} y={SUN.y - 1.5} width="920" height="3" rx="1.5" fill="url(#flare)" />
      <circle cx={SUN.x} cy={SUN.y} r="58" fill="url(#sun-core)" className="sun-breathe" />
      <text x={SUN.x} y={SUN.y + 98} textAnchor="middle" fill="#ffd9b8" fontSize="13" fontWeight="600" letterSpacing="3">ONE RECORD</text>
      {PLANETS.map((planet) => (
        <g key={planet.name}>
          <circle r={planet.r * 2.4} fill={planet.color} opacity=".18" />
          <circle r={planet.r} fill={planet.color} />
          <circle r={planet.r} fill="url(#sun-core)" opacity=".18" />
          <text y={-planet.r - 10} textAnchor="middle" fill="#fff" fillOpacity=".8" fontSize="13" fontWeight="500">
            {planet.name}
          </text>
          <animateMotion dur={`${planet.dur}s`} begin={`-${planet.at}s`} repeatCount="indefinite" path={ellipse(planet.rx)} />
        </g>
      ))}
    </svg>
  );
}

export function About({ onPick }: { onPick: (one: Workspace) => void }) {
  return (
    <div id="about" className="relative">
      {/* How signing in works. */}
      <section className={`${wrap} py-24`}>
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
            <li key={title} className="relative rounded-[2rem] border border-white/90 bg-white/70 p-8 shadow-[0_24px_50px_-30px_rgba(20,30,50,0.35)] backdrop-blur-xl">
              <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#ff9a5a] to-[#f36b21] text-base font-bold text-white shadow-[0_10px_20px_-8px_rgba(243,107,33,0.6)]">
                {i + 1}
              </span>
              <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5b6472]">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* The night sky: everything turns around one record. */}
      <section className="relative overflow-hidden bg-[#03040a] text-white">
        <Sky />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-40 size-[40rem] rounded-full bg-[#3b2a8f] opacity-25 blur-[140px]" />
          <div className="absolute -right-40 bottom-0 size-[38rem] rounded-full bg-[#0f6b45] opacity-20 blur-[140px]" />
        </div>
        <div className={`relative ${wrap} pt-28 text-center`}>
          <p className={`${eyebrow} text-[#ff9a5a]`}>What is inside</p>
          <h2 className={`${h2} mx-auto mt-4 max-w-3xl`}>
            Every part of the company turns around{" "}
            <span className="bg-gradient-to-r from-[#ffd38a] via-[#ff8a3d] to-[#f36b21] bg-clip-text text-transparent">one record</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/60">
            An order is entered once. Approval, payment, stock, delivery and the books all read and write the same record, so
            nobody types it twice and nobody works from an old copy.
          </p>
        </div>
        <div className="relative -mt-4 h-[clamp(320px,42vw,580px)]">
          <SolarSystem />
        </div>
        <div className={`relative ${wrap} pb-28`}>
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

      {/* One order, start to finish. */}
      <section className={`${wrap} py-24`}>
        <p className={`${eyebrow} text-[#1f9d55]`}>One order, start to finish</p>
        <h2 className={`${h2} mt-4 max-w-3xl`}>
          Six hands, <span className="text-[#1f9d55]">one record</span>, no retyping.
        </h2>
        <ol className="mt-14 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {JOURNEY.map((step, i) => (
            <li key={step.who} className="relative">
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[#1f9d55]/30 bg-white text-sm font-bold text-[#1f9d55] shadow-sm">{i + 1}</span>
                {i < JOURNEY.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-gradient-to-r from-[#1f9d55]/40 to-[#f36b21]/30 lg:block" />}
              </div>
              <p className="mt-4 text-[13px] font-semibold tracking-wide text-[#8a93a3] uppercase">{step.who}</p>
              <p className="mt-1 text-lg leading-snug font-semibold tracking-[-0.02em]">{step.what}</p>
              <p className="mt-1 text-sm text-[#5b6472]">{step.more}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* A door for every seat. */}
      <section className="border-y border-white/80 bg-white/50 backdrop-blur">
        <div className={`${wrap} py-24`}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className={`${eyebrow} text-[#c2410c]`}>Built for every seat</p>
              <h2 className={`${h2} mt-4 max-w-2xl`}>{WORKSPACES.length} workspaces, one company.</h2>
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-[#5b6472]">Press yours to sign in. Inside, you find only the pages your work needs.</p>
          </div>
          <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WORKSPACES.map((one) => {
              const Icon = TILE_ICONS[one.key];
              return (
                <li key={one.key}>
                  <button
                    type="button"
                    onClick={() => onPick(one)}
                    className="group flex w-full items-center gap-4 rounded-[1.5rem] border border-white bg-white/80 p-4 text-left shadow-[0_14px_34px_-26px_rgba(20,30,50,0.4)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgba(20,30,50,0.45)]"
                  >
                    <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-[#f6f7fb]">
                      <span aria-hidden="true" className="absolute inset-2 rounded-xl opacity-25 blur-lg" style={{ background: TILE_GLOW[one.key] }} />
                      <span className="relative size-8">{Icon && <Icon />}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{one.label}</span>
                      <span className="block truncate text-sm text-[#7a8394]">{one.about}</span>
                    </span>
                    <ArrowRight className="size-4 text-[#b0b7c3] transition group-hover:translate-x-0.5 group-hover:text-[#f36b21]" aria-hidden="true" />
                  </button>
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
