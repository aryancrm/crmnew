// The hero's moving dashboards (Aryan, 23 Nov): small, partial copies of our real screens, in the
// look of the app (MedReps home, Management desk, Finance's orders to check, Dispatch desk, CEO
// home), stacked down the orange panel and joined the way an order moves through the company.
// A camera follows one order down the line while each desk's cursor does its part, then pulls back
// to show the whole line, like the export's hero demo (HomePage.jsx, HeroDemo). Only an animation:
// nothing is clickable, the names and figures are the demo company's, made up.

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { heroLogo } from "../portal/hero-logos";
import "./order-line-demo.css";

const W = 520; // a screen's design width
const ORDER = "2MG-500021";
const BUYER = "Makati Medical Center";

type Cursor = { x: number; y: number; click: number };
type Screen = "rep" | "mgmt" | "fin" | "disp" | "ceo";
const CURSORS: { who: Screen; name: string; colour: string }[] = [
  { who: "rep", name: "Ryan · MedReps", colour: "#f36b21" },
  { who: "mgmt", name: "Sarla · Management", colour: "#5a6dff" },
  { who: "fin", name: "Fiona · Finance", colour: "#15803d" },
  { who: "disp", name: "Marco · Dispatch", colour: "#c2410c" },
  { who: "ceo", name: "Naresh · CEO", colour: "#173f2a" },
];

const start = () => ({
  step: "rep" as Screen,
  typed: 0,
  sent: false,
  waiting: 10,
  checks: 0,
  approved: false,
  approvedToday: 6,
  finChecks: 0,
  invoiced: false,
  disp: "none" as "none" | "pack" | "ship" | "road",
  sales: 150,
  hosp: 150,
  toast: null as null | { text: string; key: number },
  cam: { target: "rep" as string, zoom: 1 },
  cursors: Object.fromEntries(CURSORS.map((c) => [c.who, { x: 40, y: 40, click: 0 }])) as Record<Screen, Cursor>,
});
type State = ReturnType<typeof start>;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(t);
      reject(new Error("stop"));
    });
  });

/** An element's place inside the track, ignoring CSS transforms. */
function offsetIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function OrderLineDemo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 700, h: 700 });
  const [s, setS] = useState<State>(start);
  const [still, setStill] = useState(false);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      setBox({ w: width, h: height });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A screen's width on the panel: most of the panel's width.
  const base = Math.max(0.55, Math.min(1.6, (box.w * 0.86) / W));

  // The camera: centre on a screen (or the whole line) at a zoom.
  const track = trackRef.current;
  let fx = W / 2;
  let fy = 150;
  let zoom = s.cam.zoom;
  if (track) {
    if (s.cam.target === "all") {
      fy = track.offsetHeight / 2;
      zoom = Math.min(1, (box.h * 0.92) / (track.offsetHeight * base), (box.w * 0.9) / (W * base));
    } else {
      const el = track.querySelector<HTMLElement>(`[data-t="${s.cam.target}"]`);
      if (el) {
        const o = offsetIn(el, track);
        const z = base * zoom;
        const edge = 28; // px between the panel's edge and the screen
        fx = W / 2;
        if (s.cam.target.startsWith("link")) fy = o.y + o.h / 2;
        // The last desk sits at the bottom; the others at the top, the next desk filling below.
        else if (s.cam.target === "ceo") fy = o.y + o.h - (box.h / 2 - edge) / z;
        else fy = o.y + (box.h / 2 - edge) / z;
      }
    }
  }
  const scale = base * zoom;

  useEffect(() => {
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (quiet.matches) {
      setStill(true);
      setS((p) => ({ ...p, sent: true, typed: BUYER.length, checks: 4, approved: true, finChecks: 4, invoiced: true, disp: "road", sales: 174, hosp: 174, cam: { target: "all", zoom: 1 } }));
      return;
    }
    const ctrl = new AbortController();
    const sig = ctrl.signal;
    const set = (fn: (p: State) => Partial<State>) => setS((p) => ({ ...p, ...fn(p) }));
    const pause = (ms: number) => wait(ms, sig);
    const move = async (who: Screen, target: string, ms = 950) => {
      const root = trackRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-t="${target}"]`);
      if (root && el) {
        const o = offsetIn(el, root);
        set((p) => ({ cursors: { ...p.cursors, [who]: { ...p.cursors[who], x: o.x + o.w * 0.55, y: o.y + o.h * 0.6 } } }));
      }
      await pause(ms);
    };
    const click = async (who: Screen) => {
      set((p) => ({ cursors: { ...p.cursors, [who]: { ...p.cursors[who], click: p.cursors[who].click + 1 } } }));
      await pause(300);
    };
    const cam = (target: string, zoomTo = 1) => set(() => ({ cam: { target, zoom: zoomTo } }));
    const toast = (text: string) => set(() => ({ toast: { text, key: Math.random() } }));
    const tween = async (from: number, to: number, ms: number, apply: (v: number) => void) => {
      for (let i = 1; i <= 16; i++) {
        apply(from + ((to - from) * i) / 16);
        await pause(ms / 16);
      }
    };
    // Each cursor waits in a corner of its own screen until its turn.
    const park = () => {
      const root = trackRef.current;
      if (!root) return;
      const cursors = { ...start().cursors };
      for (const c of CURSORS) {
        const el = root.querySelector<HTMLElement>(`[data-t="${c.who}"]`);
        if (el) {
          const o = offsetIn(el, root);
          cursors[c.who] = { x: o.x + o.w - 120, y: o.y + o.h - 40, click: 0 };
        }
      }
      set(() => ({ cursors }));
    };

    const run = async () => {
      for (;;) {
        setS(start());
        await pause(60);
        park();
        cam("rep", 1);
        await pause(900);

        // MedReps: Ryan raises the order.
        await move("rep", "new-order", 1000);
        await click("rep");
        set(() => ({ sent: true }));
        for (let i = 1; i <= BUYER.length; i++) {
          set(() => ({ typed: i }));
          await pause(28);
        }
        await move("rep", "send", 800);
        await click("rep");
        set(() => ({ step: "mgmt" }));
        toast(`${ORDER} sent to Management`);
        await pause(900);

        // Down the line to Management: Sarla checks and approves.
        cam("link-1", 0.9);
        await pause(1100);
        cam("mgmt", 1);
        set((p) => ({ waiting: p.waiting + 1 }));
        await pause(700);
        for (let i = 1; i <= 4; i++) {
          set(() => ({ checks: i }));
          await pause(320);
        }
        await move("mgmt", "approve", 1000);
        await click("mgmt");
        set((p) => ({ approved: true, waiting: p.waiting - 1, approvedToday: p.approvedToday + 1, step: "fin" }));
        toast("Approved · on to Finance");
        await pause(1000);

        // Finance: Fiona's four checks, then the invoice.
        cam("link-2", 0.9);
        await pause(1100);
        cam("fin", 1);
        await pause(600);
        for (let i = 1; i <= 4; i++) {
          set(() => ({ finChecks: i }));
          await pause(300);
        }
        await move("fin", "send-dispatch", 1000);
        await click("fin");
        set(() => ({ invoiced: true, step: "disp" }));
        toast("Invoice 2MG-SI-000021 made · on to Dispatch");
        await pause(1000);

        // Dispatch: Marco packs and ships; the stock leaves the warehouse.
        cam("link-3", 0.9);
        await pause(1100);
        cam("disp", 1);
        set(() => ({ disp: "pack" }));
        await pause(700);
        await move("disp", "disp-btn", 1000);
        await click("disp");
        set(() => ({ disp: "ship" }));
        await pause(700);
        await click("disp");
        set(() => ({ disp: "road", step: "ceo" }));
        toast("On the road · 120 pieces out of Main warehouse");
        await pause(1000);

        // The CEO's home: the sale is counted.
        cam("link-4", 0.9);
        await pause(1100);
        cam("ceo", 1);
        await pause(500);
        await tween(150, 174, 1000, (v) => set(() => ({ sales: v, hosp: v })));
        await move("ceo", "ceo-sales", 900);
        await pause(1300);

        // Pull back: the whole line, one order through every desk.
        set(() => ({ toast: null }));
        cam("all");
        await pause(3200);
      }
    };
    // Wait a frame so the screens are laid out before the cursors find their buttons.
    const id = window.requestAnimationFrame(() => run().catch(() => undefined));
    return () => {
      window.cancelAnimationFrame(id);
      ctrl.abort();
    };
  }, []);

  const typedBuyer = BUYER.slice(0, s.typed);
  const disp = s.disp;

  return (
    <div className="ol" ref={boxRef} aria-hidden="true">
      <div
        ref={trackRef}
        className="ol__track"
        style={{ width: W, transform: `translate(${box.w / 2}px, ${box.h / 2}px) scale(${scale}) translate(${-fx}px, ${-fy}px)` }}
      >
        {/* MedReps: Ryan's home */}
        <Window t="rep" app="Hospital CHC" side={["Home", "My orders", "Hospitals", "Visits"]} cta="Create New Order" ctaT="new-order">
          <p className="ol__date">Monday, November 23</p>
          <h4>Good morning, Ryan</h4>
          <div className="ol__panel">
            <small>My Own KPI</small>
            <b className="ol__big">₱139,752.50</b>
            <Counts
              items={[
                ["Orders invoiced", 5, "receipt"],
                ["New customers", 1, "userPlus"],
                ["Orders raised", s.sent ? 10 : 9, "file"],
              ]}
            />
          </div>
          {s.sent && (
            <div className="ol__new">
              <span className="ol__av">MM</span>
              <span className="ol__new-text">
                <b>
                  {typedBuyer}
                  {s.typed < BUYER.length && <i className="ol__caret" />}
                </b>
                <small>Capecitabine 500 mg × 120 · ₱24,150</small>
              </span>
              <span className={`ol__btn ${s.step !== "rep" ? "is-done" : ""}`} data-t="send">
                {s.step !== "rep" ? "✓ Sent" : "Send"}
              </span>
            </div>
          )}
        </Window>

        <Link t="link-1" text="Order → Management" on={s.step !== "rep"} />

        {/* Management desk */}
        <Window t="mgmt" app="Management" side={["Orders to approve", "Team figures", "Stopped orders", "Customers to check"]}>
          <h4>Management desk</h4>
          <Counts
            items={[
              ["Waiting for approval", s.waiting, "clock"],
              ["On hold", 1, "pause"],
              ["Approved today", s.approvedToday, "check"],
            ]}
          />
          <OrderCard
            checks={s.checks}
            labels={["Price", "Stock", "Customer", "Papers"]}
            title="Management check"
            button={s.approved ? "✓ Approved" : "Approve"}
            done={s.approved}
            buttonT="approve"
            extra={["Send back", "Reject"]}
          />
        </Window>

        <Link t="link-2" text="Approved → Finance" on={s.approved} />

        {/* Finance: orders to check */}
        <Window t="fin" app="Finance" side={["Orders to check", "Prepaid orders", "Due payments", "Books"]}>
          <h4>Orders to check</h4>
          <div className="ol__pills">
            <span className="is-on">Needs you {s.approved && !s.invoiced ? 1 : 0}</span>
            <span>Payment 0</span>
            <span>Credit limit 0</span>
            <span>Sent on today {s.invoiced ? 3 : 2}</span>
          </div>
          {s.approved ? (
            <OrderCard
              checks={s.finChecks}
              labels={["Payment", "Papers", "Owed before", "Credit limit"]}
              title="Finance check"
              button={s.invoiced ? "✓ Sent to Dispatch" : "Check & send to Dispatch"}
              done={s.invoiced}
              buttonT="send-dispatch"
              extra={["Hold"]}
            />
          ) : (
            <p className="ol__empty">Waiting for Management…</p>
          )}
        </Window>

        <Link t="link-3" text="Invoiced → Dispatch" on={s.invoiced} />

        {/* Dispatch desk */}
        <Window t="disp" app="Dispatch" side={["To pack & ship", "On the road", "Delivered", "Returns to check"]}>
          <h4>Dispatch desk</h4>
          <Counts
            items={[
              ["To pack", disp === "pack" ? 3 : 2, "box"],
              ["To ship", disp === "ship" ? 2 : 1, "send"],
              ["On the road", disp === "road" ? 2 : 1, "truck"],
            ]}
          />
          <div className="ol__table">
            <div className="ol__tr ol__tr--head">
              <span>Order</span>
              <span>What goes</span>
              <span>Where it stands</span>
              <span />
            </div>
            <div className="ol__tr">
              <span><b>2MG-500009</b> San Juan de Dios</span>
              <span>Capecitabine × 120</span>
              <span><i className="ol__chip ol__chip--yellow">To pack</i></span>
              <span><i className="ol__btn">Pack</i></span>
            </div>
            {disp !== "none" && (
              <div className="ol__tr is-new">
                <span><b>{ORDER}</b> {BUYER}</span>
                <span>Capecitabine × 120</span>
                <span>
                  <i key={disp} className={`ol__chip ${disp === "pack" ? "ol__chip--yellow" : disp === "ship" ? "ol__chip--red" : "ol__chip--road"}`}>
                    {disp === "pack" ? "To pack" : disp === "ship" ? "To ship" : "On the road"}
                  </i>
                </span>
                <span>
                  <i className={`ol__btn ${disp === "road" ? "is-done" : ""}`} data-t="disp-btn">
                    {disp === "pack" ? "Pack" : disp === "ship" ? "Ship" : "✓ Shipped"}
                  </i>
                </span>
              </div>
            )}
          </div>
        </Window>

        <Link t="link-4" text="Delivered → the CEO's figures" on={disp === "road"} />

        {/* The CEO's home */}
        <Window t="ceo" app="CEO" side={["Home", "Target sheet", "Divisions", "Company tree"]}>
          <p className="ol__date">Monday, November 23</p>
          <h4>Good evening, Naresh</h4>
          <div className="ol__two">
            <div className="ol__panel" data-t="ceo-sales">
              <small>Sales this month</small>
              <b className="ol__big">₱{Math.round(s.sales)}K</b>
              {[
                ["HOSP · Hospitals", s.hosp],
                ["RX · Doctors", 0],
                ["B2B · Distributors", 0],
              ].map(([name, value]) => (
                <div key={name as string} className="ol__bar-row">
                  <span>{name}</span>
                  <i className="ol__bar">
                    <i style={{ width: `${Math.min(100, ((value as number) / 180) * 100)}%` }} />
                  </i>
                  <b>₱{Math.round(value as number)}K</b>
                </div>
              ))}
            </div>
            <div className="ol__panel">
              <small>Orders right now</small>
              <b className="ol__big">18</b>
              <ul className="ol__list">
                <li><i style={{ background: "#8b5cf6" }} />At Management <b>{s.approved ? 10 : 11}</b></li>
                <li><i style={{ background: "#f59e0b" }} />With Finance <b>{s.approved && !s.invoiced ? 3 : 2}</b></li>
                <li><i style={{ background: "#06b6d4" }} />Packing <b>{disp === "pack" || disp === "ship" ? 4 : 3}</b></li>
                <li><i style={{ background: "#ef4444" }} />On the road <b>{disp === "road" ? 2 : 1}</b></li>
              </ul>
            </div>
          </div>
        </Window>

        {!still &&
          CURSORS.map((c) => (
            <div
              key={c.who}
              className={`ol__cursor ${s.step === c.who || (c.who === "ceo" && s.cam.target === "ceo") ? "is-on" : ""}`}
              style={{ transform: `translate(${s.cursors[c.who].x}px, ${s.cursors[c.who].y}px)`, "--c": c.colour } as CSSProperties}
            >
              <span key={s.cursors[c.who].click} className={`ol__ripple ${s.cursors[c.who].click ? "is-on" : ""}`} />
              <svg width="16" height="18" viewBox="0 0 18 20">
                <path d="M1 1l15 7.2-6.6 1.9-3.1 6.4z" fill={c.colour} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              <span className="ol__name">{c.name}</span>
            </div>
          ))}
      </div>

      {s.toast && (
        <div key={s.toast.key} className="ol__toast">
          <span /> {s.toast.text}
        </div>
      )}
    </div>
  );
}

/** One screen, in the app's look: its top bar, a short side menu, then its own content. */
function Window(props: { t: string; app: string; side: string[]; cta?: string; ctaT?: string; children: ReactNode }) {
  const key = { "Hospital CHC": "sales", Management: "management", Finance: "finance", Dispatch: "dispatch", CEO: "ceo" }[props.app] ?? "sales";
  return (
    <div className="ol__window" data-t={props.t}>
      <div className="ol__top">
        <img src="/brand/bishnoi-one-mark.png" alt="" width={14} height={14} />
        <b>Bishnoi One</b>
        <span className="ol__app">{props.app}</span>
        <span className="ol__search" />
        <span className="ol__start">Start my day</span>
      </div>
      <div className="ol__body">
        <aside className="ol__side">
          <span className="ol__side-head">
            <img src={heroLogo(key)} alt="" width={14} height={14} />
            {props.app}
          </span>
          {props.cta && (
            <span className="ol__cta" data-t={props.ctaT}>
              + {props.cta}
            </span>
          )}
          {props.side.map((item, i) => (
            <span key={item} className={`ol__side-item ${i === 0 ? "is-on" : ""}`}>
              {item}
            </span>
          ))}
        </aside>
        <div className="ol__main">{props.children}</div>
      </div>
    </div>
  );
}

/** The order's card, as on the Management and Finance desks: four checks, then the button. */
function OrderCard(props: { checks: number; labels: string[]; title: string; button: string; done: boolean; buttonT: string; extra: string[] }) {
  return (
    <div className={`ol__card ${props.done ? "is-done" : ""}`}>
      <div className="ol__card-head">
        <span className="ol__av">MM</span>
        <span>
          <b>{BUYER}</b>
          <small>
            ₱24,150 · {ORDER} <i className="ol__tag">HOSP</i>
          </small>
        </span>
        <i className="ol__chip ol__chip--green">● New</i>
      </div>
      <p className="ol__med">
        <b>Medicine:</b> Capecitabine 500 mg × 120
      </p>
      <small className="ol__check-title">
        {props.title} <span>{props.checks} of 4 fine</span>
      </small>
      <div className="ol__checks">
        {props.labels.map((label, i) => (
          <span key={label} className={i < props.checks ? "is-ok" : ""}>
            <i />
            {label}
          </span>
        ))}
      </div>
      <div className="ol__actions">
        <span className={`ol__btn ol__btn--wide ${props.done ? "is-done" : ""}`} data-t={props.buttonT}>
          {props.button}
        </span>
        {props.extra.map((label) => (
          <span key={label} className={`ol__ghost ${label === "Reject" ? "is-red" : ""}`}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The join between two desks: a dashed line with dots running down it and what passes. */
function Link({ t, text, on }: { t: string; text: string; on: boolean }) {
  return (
    <div className={`ol__link ${on ? "is-on" : ""}`} data-t={t}>
      <span className="ol__link-line" />
      <span className="ol__link-dot" />
      <span className="ol__link-dot" style={{ animationDelay: "-0.8s" }} />
      <span className="ol__link-pill">{text}</span>
    </div>
  );
}

/** Line icons for the count cards (24-unit paths, drawn with the stroke). */
const GLYPHS = {
  receipt: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6",
  userPlus: "M15 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M22 11h-6",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 14h6M9 17h4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  pause: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M10 9v6M14 9v6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  truck: "M2 6h12v10H2zM14 9h4l4 4v3h-8M6.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
} as const;

/** A desk's three counts as one strip (blue, yellow, green), each with its icon in a glassy circle. */
function Counts(props: { items: [label: string, value: number, glyph: keyof typeof GLYPHS][] }) {
  return (
    <div className="ol__counts">
      {props.items.map(([label, value, glyph]) => (
        <span className="ol__count" key={label}>
          <span className="ol__count-text">
            <small>{label}</small>
            <b>{value}</b>
          </span>
          <span className="ol__glass">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={GLYPHS[glyph]} />
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}
