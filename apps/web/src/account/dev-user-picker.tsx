// Development only: picks one of the demo company's people (SEED_DEMO=1) and fills in the sign-in.
// It opens nothing by itself: Sign in checks the password as for anyone. It shows only under Vite's
// dev server on this computer (login.tsx renders it behind import.meta.hot, which no build has), and
// only with the demo password (the API's SEED_PASSWORD) in apps/web/.env.development.local, which
// git ignores:
//
//   VITE_DEV_LOGIN=<the demo password>

import type { Me } from "@2mg/api/types";
import { Check, Search, UserRoundCog } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { type Workspace, WORKSPACES, workspaceOf } from "../workspaces";

type Role = Me["role"];

// The demo seeds' people; each one's email is <name>@2mg.test. A MedRep's line says whether their
// seat works from the office or in the field (docs/PLAN.md 28).
const PEOPLE: [Role, string, string][] = [
  ["admin", "Admin", "System admin"],
  ["ceo", "Naresh", "CEO"],
  ["management", "Sarla", "Operations management"],
  ["finance", "Fiona", "Finance officer"],
  ["dispatch", "Marco", "Dispatch lead"],
  ["inventory", "Irene", "Inventory officer"],
  ["hr", "Helen", "HR officer"],
  ["online", "Jane", "Online desk lead"],
  ["online", "Mae", "B2C CHC"],
  ["manager", "Vanessa", "HOSP head"],
  ["manager", "Rosa", "RX head"],
  ["manager", "Pia", "PAP head"],
  ["manager", "Sam", "Sales and Marketing Mentor"],
  ["manager", "Malou", "COO, Modern Trade"],
  ["team_lead", "Daniel", "Area manager"],
  ["team_lead", "Lara", "Sales Coach, MD Telesales"],
  ["team_lead", "Jess", "B2B Sales Coach"],
  ["team_lead", "Jimmy", "Government Bidding Admin"],
  ["medrep", "Ryan", "Hospital CHC · Field"],
  ["medrep", "Mia", "Hospital CHC · Field"],
  ["medrep", "Carlo", "Hospital CHC, Mindanao · Field"],
  ["medrep", "Joy", "Rx CHC · Field"],
  ["medrep", "Paula", "PAP MedRep · Field"],
  ["medrep", "Kim", "MD Telesales, Oncology · Office"],
  ["medrep", "Ana", "MD Telesales, Anesthesia · Office"],
  ["medrep", "Fritz", "CRR · Office"],
  ["medrep", "Flor", "NBD · Office"],
  ["medrep", "Annie", "CLIDP Sales Coach · Office"],
  ["medrep", "Hazel", "Government Bidding · Office"],
  ["medrep", "Arron", "Government Bidding, Customer Happiness · Office"],
  ["medrep", "Rey", "Hospital, Government Account · Field"],
  // In the demo company only (pnpm dev:demo-api, 26 Nov): the chart has no MedRep under Malou.
  ["medrep", "Marites", "MedRep, Modern Trade · Field"],
  ["regulatory", "Esther", "In-licensing Mentor"],
  ["regulatory", "Dhebbie", "In-licensing Executive"],
  ["regulatory", "Ivy", "Regulatory Affairs Mentor"],
  ["regulatory", "Alikka", "Regulatory Affairs Pharmacist"],
  ["staff", "Kriscel", "Digital Marketing Coach"],
  ["staff", "Arnel", "Multimedia Artist"],
  ["staff", "Jade", "IT Division"],
  ["staff", "Linus", "IT Division"],
];

const emailOf = (name: string) => `${name.toLowerCase()}@2mg.test`;
const THIS_COMPUTER = ["localhost", "127.0.0.1", "[::1]"];

export function DevUserPicker({
  workspace,
  current,
  onPick,
}: {
  workspace: Workspace;
  current: string;
  onPick: (email: string, password: string) => void;
}) {
  const demo = import.meta.env.VITE_DEV_LOGIN as string | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const [shown, setShown] = useState(false);
  const [find, setFind] = useState("");
  const [empty, setEmpty] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!shown) return;
    let here = true;
    setFind("");
    // An empty database refuses every one of them: say so instead of letting the sign-in fail.
    api<{ stats: { value: number }[] }>("/api/portal/departments/admin")
      .then((answer) => here && setEmpty(answer.stats[0]?.value === 0))
      .catch(() => undefined);
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setShown(false);
    };
    document.addEventListener("pointerdown", away);
    return () => {
      here = false;
      document.removeEventListener("pointerdown", away);
    };
  }, [shown]);

  if (!demo || !THIS_COMPUTER.includes(window.location.hostname)) return null;

  const words = find.trim().toLowerCase();
  const matching = PEOPLE.map(([role, name, title]) => ({ name, title, role, home: workspaceOf({ role }) })).filter(
    (one) => !words || `${one.name} ${one.title} ${one.home.label}`.toLowerCase().includes(words),
  );
  // This department's people first, then everyone else under their own department.
  const groups = [
    { label: `${workspace.label} (this page)`, people: matching.filter((one) => workspace.roles.includes(one.role)) },
    ...WORKSPACES.filter((space) => space.key !== workspace.key).map((space) => ({
      label: space.label,
      people: matching.filter((one) => !workspace.roles.includes(one.role) && one.home.key === space.key),
    })),
  ].filter((group) => group.people.length);

  const pick = (one: (typeof matching)[number]) => {
    setShown(false);
    // Someone of another department signs in on their own department's page.
    if (!workspace.roles.includes(one.role))
      navigate(`/login/${one.home.key}`, { state: location.state, replace: true });
    onPick(emailOf(one.name), demo);
  };

  return (
    <div
      ref={box}
      className="contents"
      onKeyDown={(event) => {
        if (!shown || event.key !== "Escape") return;
        // Esc closes the list only, not the department's page under it.
        event.preventDefault();
        event.stopPropagation();
        setShown(false);
        trigger.current?.focus();
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setShown(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => setShown(!shown)}
        aria-label="Pick a demo user (development only)"
        title="Pick a demo user (development only)"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        className="grid size-11 shrink-0 place-items-center rounded-full text-[#6b7380] transition-colors hover:bg-[#f1f3f6] hover:text-[#c2410c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21] aria-expanded:bg-[#f1f3f6] aria-expanded:text-[#c2410c]"
      >
        <UserRoundCog className="size-[18px]" aria-hidden="true" />
      </button>
      {shown && (
        <div
          id={id}
          role="dialog"
          aria-label="Demo users"
          tabIndex={-1}
          className="absolute top-full right-0 z-30 mt-2 w-[min(22rem,calc(100vw-32px))] overflow-hidden rounded-xl border border-[#d5d9e1] bg-white shadow-xl outline-none"
        >
          <label className="flex h-11 items-center gap-2.5 border-b border-[#eceef3] px-3.5 focus-within:border-[#f36b21]">
            <Search className="size-4 shrink-0 text-[#6b7380]" aria-hidden="true" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the list was just opened to search it
              autoFocus
              value={find}
              onChange={(event) => setFind(event.target.value)}
              onKeyDown={(event) => {
                const first = groups[0]?.people[0];
                if (event.key !== "Enter" || empty || !first) return;
                event.preventDefault();
                pick(first);
              }}
              placeholder="Search name or department"
              aria-label="Search demo users"
              autoComplete="off"
              className="min-w-0 flex-1 text-[14px] outline-none!"
            />
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
              Dev only
            </span>
          </label>
          {empty ? (
            <p role="status" className="p-3.5 text-[13px] text-[#5b6472]">
              This database has no people, so nobody can sign in here. Use a server started with demo data (SEED_DEMO=1).
            </p>
          ) : (
            <div className="max-h-[min(20rem,50dvh)] overflow-y-auto p-1.5">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h2 className="px-2 pt-2 pb-1 text-[11px] font-semibold text-[#6b7380] uppercase">{group.label}</h2>
                  {group.people.map((one) => (
                    <button
                      key={one.name}
                      type="button"
                      onClick={() => pick(one)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[#f6f7f9] focus-visible:bg-[#f6f7f9] focus-visible:outline-2 focus-visible:outline-[#f36b21]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium text-[#1f2733]">{one.name}</span>
                        <span className="block truncate text-[12px] text-[#6b7380]">{one.title}</span>
                      </span>
                      {current === emailOf(one.name) && <Check className="size-4 text-[#1f9d55]" aria-label="Picked" />}
                    </button>
                  ))}
                </section>
              ))}
              {!groups.length && <p className="p-2 text-[13px] text-[#6b7380]">No demo user by that name.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
