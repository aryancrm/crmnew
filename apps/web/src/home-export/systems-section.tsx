// "Every department, one connected platform": the export's sliding row and the showcase under it,
// filled with the portal's 14 workspaces. Each has its hero logo, its words from "Built for every
// seat" (portal/about.tsx) and a live board of its everyday work (workspace-demos.tsx).

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DETAILS } from "../portal/about";
import { heroLogo } from "../portal/hero-logos";
import { TILE_GLOW } from "../portal/tiles";
import { SOON_SYSTEMS, type Workspace, WORKSPACES } from "../workspaces";
import { Icon, useInView } from "./HomePage.jsx";
import { WorkspaceDemo } from "./workspace-demos";

type Entry = {
  /** Used in #showcase-<id> links: "ws-<key>". */
  id: string;
  key: string;
  name: string;
  tagline: string;
  blurb: string;
  description: string;
  bullets: string[];
  colour: string;
  /** On the way (WorkDrive, Digital Marketing): a card in the rail, its links empty for now. */
  soon?: boolean;
};

const entryOf = (one: Workspace): Entry => {
  const detail = DETAILS[one.key];
  return {
    id: `ws-${one.key}`,
    key: one.key,
    name: one.label,
    tagline: one.about,
    blurb: detail?.who ?? one.about,
    description: `Sign in to ${one.label} with your own login; your role decides what you see and do.`,
    bullets: (detail?.points ?? []).slice(0, 4),
    colour: TILE_GLOW[one.key] ?? "#f36b21",
    soon: one.soon,
  };
};

/** The showcase: the live workspaces, each with its board. */
const ENTRIES: Entry[] = WORKSPACES.map(entryOf);
/** The rail: those, then the systems on the way (no board yet, so not in the showcase). */
const RAIL: Entry[] = [...ENTRIES, ...SOON_SYSTEMS.map(entryOf)];
/** An empty link for a system on the way. */
const linkOf = (entry: Entry) => (entry.soon ? "#" : `#showcase-${entry.id}`);
const stayIfSoon = (entry: Entry) => (event: { preventDefault: () => void }) => {
  if (entry.soon) event.preventDefault();
};

/** A workspace's logo, the same image as on the portal's first screen. */
function TileIcon({ workspaceKey, size }: { workspaceKey: string; size: number }) {
  return (
    <img
      src={heroLogo(workspaceKey)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      loading="lazy"
      style={{ width: size, height: size, flex: "none", objectFit: "contain" }}
    />
  );
}

const STYLES = ["orange", "light", "forest", "light"];

export function SystemsRail() {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [sectionRef, inView] = useInView<HTMLElement>({ threshold: 0.2 });

  // Keep the dots in step with the scroll position.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const card = track.firstElementChild;
      if (!card) return;
      const step = card.getBoundingClientRect().width + 16;
      setIndex(Math.min(RAIL.length - 1, Math.round(track.scrollLeft / step)));
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, []);

  const go = (to: number) => {
    const track = trackRef.current;
    const card = track?.children[to] as HTMLElement | undefined;
    const first = track?.firstElementChild as HTMLElement | null;
    if (!track || !card || !first) return;
    track.scrollTo({ left: card.offsetLeft - first.offsetLeft, behavior: "smooth" });
  };

  return (
    <section className={`rail ${inView ? "is-in" : ""}`} id="systems" ref={sectionRef}>
      <div className="shell shell--wide rail__head">
        <h2 className="rail__title">
          Every department,
          <span className="rail__title-2">
            <em>one connected</em> platform
          </span>
        </h2>

        <div className="rail__side">
          <p>
            Start with the system your team needs today. Add the rest whenever you are ready — they share one record from
            the very first day.
          </p>
          <div className="rail__controls">
            <div className="rail__dots" role="tablist" aria-label="Choose a workspace">
              {RAIL.map((entry, i) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={entry.name}
                  className={i === index ? "is-active" : ""}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            <div className="rail__arrows">
              <button type="button" className="rail__arrow" aria-label="Previous workspace" disabled={index === 0} onClick={() => go(Math.max(0, index - 1))}>
                <Icon name="arrowLeft" size={18} />
              </button>
              <button
                type="button"
                className="rail__arrow rail__arrow--next"
                aria-label="Next workspace"
                disabled={index === RAIL.length - 1}
                onClick={() => go(Math.min(RAIL.length - 1, index + 1))}
              >
                <Icon name="arrowRight" size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <ul className="rail__track" ref={trackRef}>
        {RAIL.map((entry, i) => (
          <li key={entry.id} className={`rail__card rail__card--${STYLES[i % STYLES.length]}`} style={{ "--i": i } as CSSProperties}>
            <div className="rail__card-top">
              <span className="rail__logo">
                <TileIcon workspaceKey={entry.key} size={28} />
              </span>
              <h3>{entry.name}</h3>
              <p className="rail__tagline">{entry.tagline}</p>
            </div>
            <div className="rail__card-bottom">
              <p>{entry.blurb.replace(/\.?$/, ".")}</p>
              <div className="rail__card-foot">
                <a className="rail__go" href={linkOf(entry)} onClick={stayIfSoon(entry)} aria-label={`Open ${entry.name}`}>
                  <Icon name="arrowUpRight" size={16} />
                </a>
                <a className="rail__more" href={linkOf(entry)} onClick={stayIfSoon(entry)}>
                  Learn more
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// How long each workspace stays before the next one.
const DURATION = 10500;

export function ProductShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sectionRef, inView] = useInView<HTMLElement>({ threshold: 0.25, once: false });

  useEffect(() => {
    if (paused || !inView) return;
    const id = window.setTimeout(() => setActive((i) => (i + 1) % ENTRIES.length), DURATION);
    return () => window.clearTimeout(id);
  }, [active, paused, inView]);

  // Links such as #showcase-ws-finance open that one and scroll it into view.
  useEffect(() => {
    const openFromHash = () => {
      const match = window.location.hash.match(/^#showcase-(.+)$/);
      if (!match) return;
      const index = ENTRIES.findIndex((entry) => entry.id === match[1]);
      if (index === -1) return;
      setActive(index);
      setPaused(true);
      document.getElementById("showcase")?.scrollIntoView({ behavior: "smooth" });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  const entry = ENTRIES[active] ?? ENTRIES[0];
  if (!entry) return null;
  // Each workspace takes its own tile colour as the accent.
  const colours = { "--accent": entry.colour, "--accent-2": entry.colour, "--accent-soft": `${entry.colour}1f` } as CSSProperties;

  return (
    <section className="section showcase" id="showcase" ref={sectionRef} aria-label={`The ${ENTRIES.length} Bishnoi One workspaces`}>
      <div className="shell">
        <div
          className="showcase__panel"
          style={colours}
          id={`panel-${entry.id}`}
          aria-live="polite"
          aria-label={`${entry.name} overview`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="showcase__copy" key={entry.id}>
            <span className="showcase__badge">
              <TileIcon workspaceKey={entry.key} size={18} />
              {entry.name}
            </span>
            <h3>{entry.blurb}</h3>
            <p>{entry.description}</p>
            <ul className="showcase__bullets">
              {entry.bullets.map((bullet) => (
                <li key={bullet}>
                  <span className="showcase__check">
                    <Icon name="check" size={14} />
                  </span>
                  {bullet}
                </li>
              ))}
            </ul>
            <div className="showcase__footer">
              <Link className="btn btn--primary showcase__cta" to={`/login/${entry.key}`}>
                Sign in to {entry.name}
                <Icon name="arrowRight" size={17} />
              </Link>
            </div>
          </div>

          <div className="showcase__art" key={`${entry.id}-art`}>
            <WorkspaceDemo workspaceKey={entry.key} />
          </div>
        </div>
      </div>
    </section>
  );
}
