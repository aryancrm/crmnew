// The Sign up page's left side (Aryan, 24 Nov, after two pictures he gave): cards about joining
// Bishnoi One, what you can use inside and how work gets better, on the sign-in page's picture.
// Laid out flat at a fixed size and scaled to the panel, cropped at the right and the bottom.

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import "./join-collage.css";
import { heroLogo } from "./hero-logos";

/** The heads already on the home page's hero. */
const FACES = [
  { img: "/home-export/images/MAMMALOU.png", bg: "#5a6dff" },
  { img: "/home-export/images/MAMVAN.png", bg: "#ffd900" },
  { img: "/home-export/images/SIRJAVED.png", bg: "#fd4040" },
  { img: "/home-export/images/SIRSUBIR.png", bg: "#59ba43" },
];

const CANVAS_W = 1120;
const CANVAS_H = 1300; // down to the phone's screen

/** The mark and the name, as the pictures sign their cards. */
function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`jc-brand ${light ? "jc-brand--light" : ""}`}>
      <img src="/brand/bishnoi-one-mark.png" alt="" />
      Bishnoi One
    </span>
  );
}

function Face({ index, className = "" }: { index: number; className?: string }) {
  const face = FACES[index % FACES.length];
  return (
    <span className={`jc-face ${className}`} style={{ background: face?.bg }}>
      <img src={face?.img} alt="" />
    </span>
  );
}

export function JoinCollage({ brand }: { brand: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [left, setLeft] = useState(0);

  // Small enough that the phone card shows at the bottom; centred across the panel.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const k = Math.min(el.offsetWidth / CANVAS_W, el.offsetHeight / CANVAS_H);
      setScale(k);
      setLeft(Math.max(0, (el.offsetWidth - CANVAS_W * k) / 2));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="jc" ref={box}>
      <div className="jc-canvas" style={{ "--k": scale, left } as CSSProperties}>
        {/* White card: the headline on the left, the person with the phone at the right edge. */}
        <section className="jc-card jc-move">
          <h3>
            Work as
            <br />
            you move!
          </h3>
          <p>Orders, approvals, leave and payslips on the go: your desk, ready on your phone.</p>
          <img className="jc-move__person" src="/createaccountimage.png" alt="" />
          <Brand />
        </section>

        {/* Orange card, cut by the edge. */}
        <section className="jc-card jc-orange">
          <h3>
            Sign up once,
            <br />
            work from
            <br />
            anywhere.
          </h3>
          <span className="jc-orange__site">bishnoi.one · company portal</span>
        </section>

        {/* Black card: one place, every desk. */}
        <section className="jc-card jc-dark">
          <h3>
            One Place.
            <br />
            Every Desk.
          </h3>
          <div className="jc-person">
            <b>Management</b>
            <span className="jc-person__photo" style={{ background: FACES[0]?.bg }}>
              <img src="/maamchi.png" alt="" />
            </span>
            <i>→</i>
          </div>
          <span className="jc-bubble">👋</span>
          <span className="jc-voice">
            {[6, 12, 18, 10, 16, 8, 14, 20, 12, 7, 15, 10].map((height, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed picture
              <i key={i} style={{ height }} />
            ))}
            <b>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </b>
          </span>
          <Face index={2} className="jc-dark__face" />
          <div className="jc-mini">
            <span className="jc-mini__brand">
              <img src="/brand/bishnoi-one-mark.png" alt="" /> Bishnoi One
            </span>
            <span className="jc-mini__photo" style={{ background: FACES[3]?.bg }}>
              <img src="/sirsameen.png" alt="" />
            </span>
          </div>
          <Brand light />
        </section>

        {/* White card: join your team. */}
        <section className="jc-card jc-join">
          <h3>
            Join your
            <br />
            team
          </h3>
          <div className="jc-join__faces">
            <Face index={1} />
            <Face index={0} />
            <Face index={3} />
            <span className="jc-plus">+</span>
          </div>
          <img className="jc-join__object" src={heroLogo("hr")} alt="" />
          <Brand />
        </section>

        {/* White card: the phone with the first steps. */}
        <section className="jc-card jc-phone">
          <div className="jc-phone__device">
            <span className="jc-phone__island" />
            <div className="jc-phone__screen">
              <div className="jc-phone__bars">
                <i className="is-on" />
                <i className="is-on" />
                <i />
                <i />
              </div>
              <div className="jc-phone__top">
                <span className="jc-phone__avatar">
                  <img src="/brand/bishnoi-one-mark.png" alt="" />
                </span>
                Bishnoi One
                <span className="jc-phone__x">×</span>
              </div>
              <span className="jc-phone__logo">
                <img src="/brand/bishnoi-one-mark.png" alt="" /> Bishnoi One
              </span>
              <h4>How to begin your first day?</h4>
              <ol>
                <li>
                  <i>01</i>
                  <span>
                    Create your account
                    <small>Your name, email, mobile and department</small>
                  </span>
                </li>
                <li className="jc-phone__step2">
                  <i>02</i>
                  <span>
                    Set your password
                    <small>From the email, once you're accepted</small>
                  </span>
                </li>
              </ol>
              <span className="jc-phone__arc" />
            </div>
          </div>

          {/* The second phone, in yellow: what you can use inside. */}
          <div className="jc-phone__device jc-phone__device--b">
            <span className="jc-phone__island" />
            <div className="jc-phone__screen jc-phone__screen--yellow">
              <div className="jc-phone__bars">
                <i className="is-on" />
                <i className="is-on" />
                <i className="is-on" />
                <i />
              </div>
              <div className="jc-phone__top">
                <span className="jc-phone__avatar">
                  <img src="/brand/bishnoi-one-mark.png" alt="" />
                </span>
                Bishnoi One
                <span className="jc-phone__x">×</span>
              </div>
              <span className="jc-phone__logo">
                <img src="/brand/bishnoi-one-mark.png" alt="" /> Bishnoi One
              </span>
              <h4>What you can use inside</h4>
              <ol>
                <li>
                  <i>01</i>
                  <span>
                    Your own desk
                    <small>Orders, approvals and tasks in one list</small>
                  </span>
                </li>
                <li className="jc-phone__step2">
                  <i>02</i>
                  <span>
                    Leave and payslips
                    <small>Ask, track and download, any time</small>
                  </span>
                </li>
              </ol>
              <span className="jc-phone__arc" />
            </div>
          </div>
        </section>
      </div>

      <div className="jc-mark">{brand}</div>
    </div>
  );
}
