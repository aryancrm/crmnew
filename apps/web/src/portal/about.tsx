// The About page (/about; on the home page until 24 Nov): what Bishnoi One is and how it works, as one
// long page: a black hole with every part of the company around one record, one order from start
// to finish, the field, the books, how it works, questions, the footer. Only words and a look.
// DETAILS (what each workspace holds) is shown in the home page's workspace showcase (home-export).

import { ArrowRight, Check, ChevronDown, Eye, History, ShieldCheck, Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import { WORKSPACES } from "../workspaces";
import { heroLogo } from "./hero-logos";

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

const FIELD = [
  "Today's visits, the plan and the calendar",
  "An order taken at the counter, with the patient's Rx",
  "What each hospital owes, before you walk in",
  "Samples and gifts handed out, counted",
  "Your score, always up to date",
];

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

/** Between two sections: a thin wave in the portal's orange and green, with a star, and room around it. */
const Rule = () => (
  <div aria-hidden="true" className="mx-auto w-[min(1140px,calc(100%-32px))] py-10">
    <svg viewBox="0 0 1140 24" preserveAspectRatio="none" className="h-6 w-full">
      <defs>
        <linearGradient id="rule-line" x1="0" x2="1">
          <stop offset="0" stopColor="#f36b21" stopOpacity="0" />
          <stop offset=".3" stopColor="#f36b21" stopOpacity=".45" />
          <stop offset=".7" stopColor="#1f9d55" stopOpacity=".45" />
          <stop offset="1" stopColor="#1f9d55" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 12C180 4 340 20 520 12S860 4 1140 12" stroke="url(#rule-line)" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>
);

const CLOSE = [
  { title: "Pick your workspace", text: "Each department has its own door: sales and field, management, finance, stock, dispatch, people." },
  { title: "Sign in as yourself", text: "Your own login ID and password. Your role decides what you see and what you can do." },
  { title: "Every change kept", text: "Who did it and when, in the audit. Nothing with history is ever deleted." },
];

/** The workspaces' three groups, as the navbar's Systems menu has them. */
const GROUPS = [
  { id: "selling", label: "Selling", note: "Field, teams and the online desk", color: "#1f9d55" },
  { id: "operations", label: "Operations", note: "Approvals, money, stock and delivery", color: "#f36b21" },
  { id: "office", label: "Office", note: "People, compliance and the company", color: "#5a6dff" },
] as const;

/** What the app holds to, from its own rules (the API checks them, not only the screens). */
const TRUST = [
  {
    icon: ShieldCheck,
    title: "Your role, checked every time",
    text: "Every action asks who you are and what your seat allows. A hidden button is never the only guard.",
  },
  {
    icon: History,
    title: "Nothing with history is deleted",
    text: "Orders, payments and stock are cancelled, reversed or archived, never wiped, so the past always adds up.",
  },
  {
    icon: Eye,
    title: "Every change kept",
    text: "Who did what, and when, is written to the audit, so any step can be looked back at.",
  },
  {
    icon: Stethoscope,
    title: "The data checks itself",
    text: "Built-in checks compare the records against each other, so a gap shows up before it becomes a problem.",
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
];

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
      <section className={`${wrap} py-24`}>
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className={`${eyebrow} text-[#1f9d55]`}>One order, start to finish</p>
            <h2 className={`${h2} mt-4 max-w-3xl`}>
              Six hands, <span className="text-[#1f9d55]">one record</span>, no retyping.
            </h2>
          </div>
        </div>
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

      {/* Every workspace, by group, each with its logo and what it is for. */}
      <section className={`${wrap} py-24`}>
        <p className={`${eyebrow} text-[#5a6dff]`}>Every workspace</p>
        <h2 className={`${h2} mt-4 max-w-3xl`}>
          {WORKSPACES.length} desks, <span className="text-[#5a6dff]">one company.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-[#5b6472]">
          Each workspace is a department's own screen: its lists, its tasks and its figures. They hand work to each other
          as it moves, so nobody chases a file by message.
        </p>
        <div className="mt-14 grid gap-10 lg:grid-cols-3">
          {GROUPS.map((group) => (
            <div key={group.id}>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-[#eceef3] pb-3">
                <span className="size-2.5 rounded-full" style={{ background: group.color }} />
                <h3 className="text-lg font-semibold tracking-[-0.02em]">{group.label}</h3>
                <span className="text-[13px] text-[#8a93a3]">{group.note}</span>
              </div>
              <ul className="mt-4 grid gap-1">
                {WORKSPACES.filter((one) => one.group === group.id).map((one) => (
                  <li key={one.key}>
                    <Link
                      to={`/login/${one.key}`}
                      className="group flex items-center gap-3.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-[#f6f7fb]"
                    >
                      <img src={heroLogo(one.key)} alt="" width={36} height={36} className="size-9 shrink-0 object-contain" />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-[#1f2733] group-hover:text-[#c2410c]">{one.label}</span>
                        <span className="block text-[13px] text-[#5b6472]">{one.about}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
        </div>
          <ul className="grid gap-4 lg:pl-12">
            {FIELD.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] text-[#2b3340]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#1f9d55] text-white">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
      </section>

      <Rule />

      {/* What the app holds to. */}
      <section className={`${wrap} py-24`}>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className={`${eyebrow} text-[#1f9d55]`}>Built to be trusted</p>
            <h2 className={`${h2} mt-4`}>
              Safe records, <span className="text-[#1f9d55]">clear history.</span>
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#5b6472]">
              A company's records are only useful if people can rely on them. Bishnoi One keeps them whole, shows who
              changed what, and lets each person reach only what their work needs.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {TRUST.map((one) => (
              <li key={one.title} className="rounded-2xl border border-[#eceef3] bg-white p-6">
                <span className="grid size-11 place-items-center rounded-full bg-[#1f9d55] text-white">
                  <one.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.02em]">{one.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[#5b6472]">{one.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Rule />

      {/* Questions, each opening its answer. */}
      <section className={`${wrap} grid gap-12 py-24 lg:grid-cols-[1fr_1.4fr]`}>
        <div>
          <p className={`${eyebrow} text-[#c2410c]`}>Questions</p>
          <h2 className={`${h2} mt-4`}>Before you sign in.</h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#5b6472]">
            Something else? Ask HR or your administrator: they set up logins and seats.
          </p>
        </div>
        <div className="divide-y divide-[#eceef3] border-y border-[#eceef3]">
          {QUESTIONS.map((one) => (
            <details key={one.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {one.q}
                <ChevronDown className="size-5 shrink-0 text-[#8a93a3] transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5b6472]">{one.a}</p>
            </details>
          ))}
        </div>
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
            <Link
              to="/login#systems"
              className="inline-flex items-center gap-2 rounded-full bg-[#1f2733] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_16px_34px_-14px_rgba(20,30,50,0.6)] transition hover:bg-black"
            >
              Choose your workspace <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      </div>
    </div>
  );
}
