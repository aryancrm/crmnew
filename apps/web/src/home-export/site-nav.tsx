// The exported home page's navbar and footer, filled with this app's own navigation: Systems
// (the portal's workspaces in three columns, Selling, Operations and Office, each opening its own
// sign-in, /login/<key>), About Us (/about) and Sign up. The look is the export's (its classes, logo and icons); the icons beside each
// workspace are the portal's own tile icons.

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { heroLogo } from "../portal/hero-logos";
import { type Workspace, WORKSPACES } from "../workspaces";
import { Icon, OrbitLogo, useScrollPosition } from "./HomePage.jsx";
import "./site-nav.css";

const GROUPS = [
  { id: "selling", label: "Selling", note: "Field, teams and the online desk" },
  { id: "operations", label: "Operations", note: "Approvals, money, stock and delivery" },
  { id: "office", label: "Office", note: "People, compliance and the company" },
] as const;

type GroupId = (typeof GROUPS)[number]["id"];
const inGroup = (id: GroupId) => WORKSPACES.filter((one) => one.group === id);
const signInTo = (one: Workspace) => `/login/${one.key}`;

/** A workspace's own logo, the same as in the hero and the Systems menu. */
function TileIcon({ workspace }: { workspace: Workspace }) {
  return (
    <img
      src={heroLogo(workspace.key)}
      alt=""
      aria-hidden="true"
      decoding="async"
      style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
    />
  );
}

/** The logo and the Sign in links. On the home page (/login) they scroll; on another page (the
 *  About page) they go to the home page first, and to its systems section for Sign in. */
function usePlaces() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const home = pathname === "/login";
  return {
    toTop: () => (home ? window.scrollTo({ top: 0, behavior: "smooth" }) : navigate("/login")),
    toWorkspaces: () => {
      const section = home && document.getElementById("systems");
      if (section) section.scrollIntoView({ behavior: "smooth" });
      else navigate("/login#systems");
    },
    /** Sign in: first the choice of system (/signin, Aryan 25 Nov), then its sign-in. */
    toSignIn: () => navigate("/signin"),
  };
}

/** The workspace search: as you type, a short list of matching workspaces opens under the bar
 *  (nothing shows on a click alone); Enter or a click opens the one picked. */
function SearchBar({ className = "", onOpen }: { className?: string; onOpen?: () => void }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const listId = `hx-workspaces${className ? "-drawer" : ""}`;

  const words = query.trim().toLowerCase();
  const matches = words
    ? [
        ...WORKSPACES.filter((one) => one.label.toLowerCase().startsWith(words)),
        ...WORKSPACES.filter(
          (one) => !one.label.toLowerCase().startsWith(words) && `${one.label} ${one.about}`.toLowerCase().includes(words),
        ),
      ]
    : [];
  const shown = focused && words.length > 0;

  const go = (one: Workspace) => {
    setQuery("");
    setFocused(false);
    input.current?.blur();
    onOpen?.();
    navigate(signInTo(one));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = matches[active] ?? matches[0];
    if (found) go(found);
  };

  return (
    <form
      className={`nav__search nav__search--suggest ${className}`}
      role="search"
      onSubmit={submit}
      onClick={() => input.current?.focus()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Icon name="search" size={18} />
      <input
        ref={input}
        type="text"
        name="q"
        autoComplete="off"
        placeholder="Search workspaces"
        aria-label="Search workspaces"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setFocused(true);
        }}
        onKeyDown={(event) => {
          if (!shown) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((now) => Math.min(now + 1, Math.max(matches.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((now) => Math.max(now - 1, 0));
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setFocused(false);
          }
        }}
      />
      {shown && (
        <div className="search-suggest" id={listId} role="listbox" aria-label="Workspaces">
          {matches.length ? (
            matches.map((one, i) => (
              <button
                key={one.key}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`search-suggest__item ${i === active ? "is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(one)}
              >
                <img src={heroLogo(one.key)} alt="" width={26} height={26} />
                <span>
                  <strong>{one.label}</strong>
                  <small>{one.about}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="search-suggest__none">No workspace by that name.</p>
          )}
        </div>
      )}
    </form>
  );
}

/** "Systems": every workspace in three columns, Selling, Operations and Office. */
function SystemsPanel({ onNavigate }: { onNavigate: () => void }) {
  const { toWorkspaces } = usePlaces();
  return (
    <div className="mega mega--systems">
      <div className="systems-menu">
        {GROUPS.map((group) => (
          <section key={group.id} className="systems-menu__col" aria-labelledby={`systems-${group.id}`}>
            <p className="systems-menu__head" id={`systems-${group.id}`}>
              {group.label}
            </p>
            <p className="systems-menu__note">{group.note}</p>
            <ul>
              {inGroup(group.id).map((one) => (
                <li key={one.key}>
                  <Link className="systems-menu__app" to={signInTo(one)} onClick={onNavigate}>
                    <img src={heroLogo(one.key)} alt="" width={28} height={28} decoding="async" />
                    <span>
                      <strong>
                        {one.label}
                        <Icon name="arrowRight" size={14} />
                      </strong>
                      <small>{one.about}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mega__footer">
        <span>Your own login opens what your role allows.</span>
        <a
          className="link-arrow"
          href="#systems"
          onClick={(event) => {
            event.preventDefault();
            onNavigate();
            toWorkspaces();
          }}
        >
          All workspaces <Icon name="arrowRight" size={16} />
        </a>
      </div>
    </div>
  );
}

export function Navbar() {
  const { toTop, toSignIn } = usePlaces();
  const [openMenu, setOpenMenu] = useState<"systems" | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSystems, setMobileSystems] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const scrollY = useScrollPosition();
  useEffect(() => {
    if (!mobileOpen) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [mobileOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hover intent: a short grace period so the panel doesn't flicker shut between trigger and panel.
  const openWithIntent = (id: "systems" | null) => {
    window.clearTimeout(closeTimer.current);
    setOpenMenu(id);
  };
  const closeWithIntent = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 140);
  };
  const closeAll = () => {
    setOpenMenu(null);
    setMobileOpen(false);
  };

  return (
    <>
      <header
        className={`nav is-scrolled ${scrollY < 8 ? "is-top" : ""}`}
        onMouseLeave={closeWithIntent}
      >
        <div className="nav__inner shell shell--wide">
          <a
            className="nav__brand"
            href="#top"
            aria-label="Bishnoi One, back to the top"
            onClick={(event) => {
              event.preventDefault();
              closeAll();
              toTop();
            }}
          >
            <OrbitLogo variant="lockup" />
          </a>

          <nav className="nav__links nav__links--pill" aria-label="Main">
            <div className="nav__item" onMouseEnter={() => openWithIntent("systems")} onFocus={() => openWithIntent("systems")}>
              <button
                type="button"
                className={`nav__trigger ${openMenu ? "is-open" : ""}`}
                aria-expanded={openMenu === "systems"}
                onClick={() => setOpenMenu(openMenu ? null : "systems")}
              >
                Systems
                <Icon name="chevronDown" size={16} />
              </button>
            </div>
            <Link className="nav__trigger" to="/about" onClick={closeAll}>
              About Us
            </Link>
            <Link className="nav__trigger" to="/signup">
              Sign up
            </Link>
          </nav>

          <SearchBar />

          <div className="nav__actions">
            <a
              className="btn btn--gradient btn--sm nav__login"
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                closeAll();
                toSignIn();
              }}
            >
              Sign in
            </a>
            <button
              type="button"
              className="nav__burger"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              <Icon name={mobileOpen ? "close" : "menu"} size={24} />
            </button>
          </div>
        </div>

        <div className={`nav__panel ${openMenu ? "is-open" : ""}`} onMouseEnter={() => openWithIntent(openMenu)} onMouseLeave={closeWithIntent}>
          <div className="nav__panel-inner shell">{openMenu && <SystemsPanel onNavigate={() => setOpenMenu(null)} />}</div>
        </div>
      </header>

      {/* The phone drawer; `inert` keeps its links out of the tab order while it is shut. */}
      <div className={`drawer ${mobileOpen ? "is-open" : ""}`} aria-hidden={!mobileOpen} inert={!mobileOpen}>
        <div className="drawer__scroll">
          <SearchBar className="nav__search--drawer" onOpen={() => setMobileOpen(false)} />
          <nav className="drawer__nav" aria-label="Mobile">
            <div className={`drawer__group ${mobileSystems ? "is-open" : ""}`}>
              <button type="button" className="drawer__trigger" aria-expanded={mobileSystems} onClick={() => setMobileSystems(!mobileSystems)}>
                Systems
                <Icon name="chevronDown" size={20} />
              </button>
              <div className="drawer__sub">
                <div className="drawer__sub-inner">
                  {GROUPS.map((group) => (
                    <div key={group.id} className="drawer__systems-group">
                      <p className="drawer__systems-head">{group.label}</p>
                      {inGroup(group.id).map((one) => (
                        <Link key={one.key} to={signInTo(one)} onClick={() => setMobileOpen(false)}>
                          <strong>{one.label}</strong>
                          <span>{one.about}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Link className="drawer__trigger" to="/about" onClick={() => setMobileOpen(false)}>
              About Us
            </Link>
            <Link className="drawer__trigger" to="/signup" onClick={() => setMobileOpen(false)}>
              Sign up
            </Link>
          </nav>
          <div className="drawer__actions">
            <a
              className="btn btn--gradient btn--block btn--lg"
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                closeAll();
                toSignIn();
              }}
            >
              Sign in
            </a>
          </div>
        </div>
      </div>
      <button
        type="button"
        className={`drawer__scrim ${mobileOpen ? "is-open" : ""}`}
        aria-label="Close menu"
        inert={!mobileOpen}
        onClick={() => setMobileOpen(false)}
      />
    </>
  );
}

/** What the company's system really does, from its own rules, in place of the export's badges. */
const FACTS: { icon: "shield" | "people" | "check" | "board"; text: string }[] = [
  { icon: "people", text: "Your own login" },
  { icon: "shield", text: "Your role checked on every action" },
  { icon: "check", text: "Every change kept, who and when" },
  { icon: "board", text: "Nothing with history is deleted" },
];

export function Footer() {
  const { toSignIn } = usePlaces();
  return (
    <footer className="footer">
      <div className="shell footer__top">
        <div className="footer__brand">
          <OrbitLogo />
          <p>
            Bishnoi One is the company portal: sales, approvals, money, stock, dispatch and people working from the same
            records. Pick your workspace and sign in as yourself.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <Link className="btn btn--gradient btn--sm" to="/signup">
              Create your account
            </Link>
            <a
              className="link-arrow"
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                toSignIn();
              }}
            >
              Sign in <Icon name="arrowRight" size={16} />
            </a>
          </div>
        </div>

        <nav className="footer__cols" aria-label="Footer">
          {GROUPS.map((group) => (
            <div key={group.id} className="footer__col">
              <h4>{group.label}</h4>
              <ul>
                {inGroup(group.id).map((one) => (
                  <li key={one.key}>
                    <Link to={signInTo(one)}>
                      <span className="footer__logo">
                        <TileIcon workspace={one} />
                      </span>
                      {one.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="footer__col">
            <h4>Bishnoi One</h4>
            <ul>
              <li>
                <Link to="/about">
                  <Icon name="sparkle" size={16} className="footer__glyph" />
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/signup">
                  <Icon name="people" size={16} className="footer__glyph" />
                  Sign up
                </Link>
              </li>
              <li>
                <a
                  href="/signin"
                  onClick={(event) => {
                    event.preventDefault();
                    toSignIn();
                  }}
                >
                  <Icon name="arrowRight" size={16} className="footer__glyph" />
                  Sign in
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <div className="shell footer__badges">
        {FACTS.map((fact) => (
          <span key={fact.text}>
            <Icon name={fact.icon} size={16} /> {fact.text}
          </span>
        ))}
      </div>

      <div className="shell footer__bottom">
        <p>© {new Date().getFullYear()} Bishnoi One. All rights reserved.</p>
      </div>
    </footer>
  );
}
