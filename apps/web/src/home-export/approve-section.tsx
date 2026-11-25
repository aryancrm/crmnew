// "Approve from one dashboard" (Aryan, 24 Nov): the export's ApproveSmarter band with the same look
// (its classes and layout), filled with our own systems: the hero's system logos, the order line
// from MedReps to the books, and a Management desk of our kind of requests. Made-up demo figures;
// the export's file (HomePage.jsx) is generated and stays as it is.

import { type CSSProperties, useEffect, useRef } from "react";
import { heroLogo } from "../portal/hero-logos";
import { Icon, useInView } from "./HomePage.jsx";

/** The flow in the "Preview the workflow" card: one hospital order, desk by desk. */
const STEPS: [system: string, title: string, sub: string][] = [
  ["sales", "Order taken by the rep", "Trigger · from MedReps, with the patient's Rx"],
  ["management", "Price and customer checked", "Approval · Management, reminder after 4 hours"],
  ["finance", "Payment confirmed", "Action · cash, transfer, cheque or terms"],
  ["inventory", "Batch given from stock", "Action · expiry and cost kept"],
  ["dispatch", "Packed and delivered", "Action · to the customer's door"],
  ["books", "The books post themselves", "Action · sale, payment and cost"],
];

const SYSTEMS: [system: string, label: string, on: boolean][] = [
  ["sales", "MedReps", true],
  ["finance", "Finance", true],
  ["books", "Books", false],
];

/** The laptop's dashboard is drawn at this width and scaled to the screen. */
const DASH_W = 440;

/** The side menu: the desk's own pages, then the other systems (with their logos). */
const NAV: [label: string, system: string | null, glyph: "board" | "check" | "shield" | null][] = [
  ["Home", null, "board"],
  ["Approvals", null, "check"],
  ["MedReps", "sales", null],
  ["Finance", "finance", null],
  ["Inventory", "inventory", null],
  ["Dispatch", "dispatch", null],
  ["HR", "hr", null],
  ["Regulatory", "regulatory", null],
  ["Books", "books", null],
  ["CEO", "ceo", null],
  ["Settings", null, "shield"],
];

/** Owner avatars, the same colours as the export's. */
const OWNERS: Record<string, string> = { J: "#f36b21", M: "#5a6dff", K: "#173f2a", A: "#3e8e2d", R: "#fd4040" };

type Row = [title: string, sub: string, owner: string, amount: string, tone: string, status: string, action: string | null];

/** Management's approvals, grouped like the export's tables. */
const GROUPS: { title: string; color: string; rows: Row[] }[] = [
  {
    title: "Waiting for you",
    color: "#f36b21",
    rows: [
      ["2MG-500021 · Makati Medical", "Ryan · MedReps", "J", "₱24,150", "yellow", "Pending", "Approve"],
      ["Leave · Dec 4–5", "Leo Cruz · HR", "A", "2 days", "yellow", "Pending", "Approve"],
      ["Return · MegaDrug", "Dispatch · Finance", "R", "₱4,200", "red", "Escalated", "Review"],
      ["Credit terms · St. Luke's", "Finance", "K", "30 days", "blue", "In review", "Approve"],
    ],
  },
  {
    title: "Approved today",
    color: "#3e8e2d",
    rows: [
      ["2MG-500009 · San Juan de Dios", "Sarla · Management", "M", "₱18,600", "green", "Approved", null],
      ["Stock in · Capecitabine", "Inventory · Books", "A", "₱52,000", "green", "Approved", null],
    ],
  },
  {
    title: "Due this week",
    color: "#5a6dff",
    rows: [
      ["Product licence renewal", "Regulatory", "K", "₱120,000", "blue", "Due Thu", "Approve"],
      ["New laptop · Ria Santos", "Onboarding · HR", "J", "₱58,000", "yellow", "Due Fri", "Approve"],
    ],
  },
];

const vars = (values: Record<string, string | number>) => values as CSSProperties;

export function ApproveSection() {
  const [ref, inView] = useInView<HTMLElement>({ threshold: 0.15 });
  const fitRef = useRef<HTMLDivElement>(null);

  // The dashboard is drawn DASH_W px wide and scaled to the laptop screen's width.
  useEffect(() => {
    const el = fitRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--s", String(el.offsetWidth / DASH_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <section className={`aps ${inView ? "is-in" : ""}`} ref={ref} aria-labelledby="aps-title">
      <div className="aps__panels">
        {/* Preview the workflow */}
        <div className="aps__panel aps__panel--peach">
          <span className="aps__tag">Preview the workflow</span>

          <div className="aps__modal" aria-hidden="true">
            <div className="aps__modal-head">
              <span className="aps__dot aps__dot--orange" />
              <div>
                <b>Hospital order to delivery</b>
                <small>Taken once by the rep, then approved, paid, picked, delivered and posted to the books.</small>
              </div>
              <span className="aps__x">×</span>
            </div>

            <div className="aps__modal-body">
              <ol className="aps__steps">
                {STEPS.map(([system, title, sub], i) => (
                  <li key={title} style={vars({ "--i": i })}>
                    <img src={heroLogo(system)} alt="" />
                    <span>
                      <b>{title}</b>
                      <small>{sub}</small>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="aps__side">
                <em>Systems</em>
                {SYSTEMS.map(([system, label, on]) => (
                  <div key={system} className="aps__sys">
                    <img src={heroLogo(system)} alt="" />
                    <span>{label}</span>
                    <i className={on ? "is-on" : ""}>{on ? "Connected" : "Connect"}</i>
                  </div>
                ))}
                <em>Preview</em>
                <dl>
                  <dt>Orders / mo</dt>
                  <dd>2,431</dd>
                  <dt>Avg. approval</dt>
                  <dd>6 min</dd>
                  <dt>Saved</dt>
                  <dd>~14 h / wk</dd>
                </dl>
              </div>
            </div>

            <div className="aps__modal-foot">
              <span>Preview in sandbox</span>
              <span className="aps__btn aps__btn--ghost">Close</span>
              <span className="aps__btn">Use this flow</span>
            </div>
          </div>
        </div>

        {/* Approve from one dashboard */}
        <div className="aps__panel aps__panel--lilac">
          <span className="aps__tag">Approve from one dashboard</span>

          <div className="aps__scene" aria-hidden="true">
            <img className="aps__scene-img" src="/home-export/images/tablelaptop.png" alt="" loading="lazy" />
            {/* The dashboard laid over the laptop screen (below the browser bar). */}
            <div className="aps__screen-fit" ref={fitRef}>
              <div className="aps__dash">
                <aside className="aps__side-nav">
                  <span className="aps__brandmini">
                    <img src="/home-export/images/bishnoi-logo.png" alt="" /> Bishnoi One
                  </span>
                  {NAV.map(([label, system, glyph], i) => (
                    <span key={label} className={`aps__nav-item ${i === 1 ? "is-on" : ""}`}>
                      {system ? <img src={heroLogo(system)} alt="" /> : glyph && <Icon name={glyph} size={8} className="aps__nav-ico" />}
                      {label}
                    </span>
                  ))}
                </aside>

                <div className="aps__dash-main">
                  <div className="aps__dash-head">
                    <b>Management desk</b>
                    <span className="aps__search">Search orders…</span>
                    <span className="aps__me">S</span>
                  </div>

                  {GROUPS.map((group) => (
                    <div key={group.title} className="aps__table" style={vars({ "--grp": group.color })}>
                      <div className="aps__tr aps__th">
                        <span>{group.title}</span>
                        <span>Owner</span>
                        <span>Amount</span>
                        <span>Status</span>
                        <span />
                      </div>
                      {group.rows.map(([title, sub, owner, amount, tone, status, action]) => (
                        <div key={title} className="aps__tr">
                          <span>
                            <b>{title}</b>
                            <small>{sub}</small>
                          </span>
                          <span>
                            <i className="aps__av" style={vars({ "--c": OWNERS[owner] ?? "#5a6dff" })}>
                              {owner}
                            </i>
                          </span>
                          <span>{amount}</span>
                          <span className="aps__status" data-tone={tone}>
                            {status}
                          </span>
                          <span>{action ? <i className={`aps__btn ${action === "Review" ? "aps__btn--ghost" : ""}`}>{action}</i> : null}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Big headline band */}
      <div className="aps__band">
        <h2 className="aps__title" id="aps-title">
          <span className="aps__row">
            <span className="aps__word">Decide faster and approve</span>
            <span className="aps__photo">
              <img src="/home-export/images/howwework.jpg" alt="" aria-hidden="true" loading="lazy" />
            </span>
          </span>
          <span className="aps__row">
            <span className="aps__word">all in one place.</span>
            <a className="aps__cta" href="#cta">
              Explore now
            </a>
          </span>
        </h2>
        <p className="aps__note">Every request, approval and sign-off in one place.</p>
      </div>
    </section>
  );
}
