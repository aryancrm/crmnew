// The home page's first screen in two columns (Aryan, 23 Nov): on the left the export's headline,
// promise and call to action, then six featured apps (logo, name underneath); on the right the
// systems' dashboards in small animated copies (order-line-demo.tsx), on an orange panel that
// runs from the top of the page, behind the navbar, to the window's right and bottom edges. Ours, built from
// the export's pieces, so re-scoping the export keeps it.

import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { heroLogo } from "../portal/hero-logos";
import { type Workspace, WORKSPACES } from "../workspaces";
import { OrderLineDemo } from "./order-line-demo";
import { Icon } from "./HomePage.jsx";
import "./hero-split.css";

// The export's team faces beside "from one login": x/y centre each head in its circle.
const TEAM = [
  { img: "/home-export/images/MAMMALOU.png", bg: "#5a6dff", x: "-74.8%", y: "-4.8%" },
  { img: "/home-export/images/MAMVAN.png", bg: "#ffd900", x: "-82%", y: "-9.6%" },
  { img: "/home-export/images/SIRJAVED.png", bg: "#fd4040", x: "-72.4%", y: "-4.8%" },
  { img: "/home-export/images/SIRSUBIR.png", bg: "#59ba43", x: "-72.4%", y: "-9.6%" },
];

/** The six apps shown under the call to action; the rest are in the navbar's Systems menu. */
const FEATURED = ["sales", "management", "finance", "inventory", "dispatch", "hr"];
const APPS = FEATURED.map((key) => WORKSPACES.find((one) => one.key === key)).filter((one): one is Workspace => !!one);

export function HeroSplit() {
  return (
    <section className="hero hero--split" id="top">
      <div className="shell shell--wide hero-split">
        <div className="hero-split__copy">
          <h1 className="hero__title">
            Run your whole company
            <br />
            <span className="hero__accent">in one place</span>
            <br />
            <span className="hero__line3">
              <span className="hero__stack" aria-hidden="true">
                {TEAM.map((p, i) => (
                  <span
                    key={p.img}
                    className="hero__face"
                    style={{ "--i": i, "--bg": p.bg, "--x": p.x, "--y": p.y } as CSSProperties}
                  >
                    <img src={p.img} alt="" width="80" height="80" />
                  </span>
                ))}
              </span>
              from one login
            </span>
          </h1>

          <p className="hero__lead">
            Eight connected systems for stock, people, customers, reporting, books, finance, files and support. Set Bishnoi
            One up in an afternoon.
          </p>
          <div className="hero-split__cta">
            <a className="hero__cta" href="#systems">
              Access your apps
              <span className="hero__cta-icon">
                <Icon name="arrowUpRight" size={16} />
              </span>
            </a>
            <p className="hero__fineprint">Free forever plan · No credit card</p>
          </div>

          <div className="hero-split__apps">
            <p className="hero-split__label" id="featured-apps">
              Featured apps
            </p>
            <ul aria-labelledby="featured-apps">
              {APPS.map((one) => (
                <li key={one.key}>
                  <Link className="hero-split__app" to={`/login/${one.key}`} title={one.about}>
                    <img src={heroLogo(one.key)} alt="" width={44} height={44} decoding="async" />
                    <span>{one.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="hero-split__stage">
          <OrderLineDemo />
        </div>
      </div>
    </section>
  );
}
