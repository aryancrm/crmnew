// Bishnoi One's workspace illustrations: one small scene per department, drawn for the portal in
// the logo's own colours (the orange B, the green orbit, the star) on a warm ground. Original line
// art, one stroke weight, so the board reads as one set.

import type { ReactNode } from "react";

const INK = "#1d2a22";
const ORANGE = "#ff6a1a";
const ORANGE_SOFT = "#ffe3d1";
const GREEN = "#1f8a3e";
const GREEN_SOFT = "#d8efdf";
const CREAM = "#fff7ef";

/** The common frame: a soft ground, the orbit's arc and its star, then the scene. */
function Scene({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 160 112" role="img" aria-label={label} className="h-full w-full">
      <rect x="0" y="0" width="160" height="112" rx="14" fill={CREAM} />
      <circle cx="122" cy="30" r="34" fill={ORANGE_SOFT} opacity=".7" />
      <path d="M8 92C40 104 108 104 152 70" stroke={GREEN} strokeOpacity=".35" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M148 14l2.2 5.6 5.6 2.2-5.6 2.2-2.2 5.6-2.2-5.6-5.6-2.2 5.6-2.2z" fill={GREEN} opacity=".85" />
      <g stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {children}
      </g>
    </svg>
  );
}

const Sales = () => (
  <Scene label="Sales and field">
    {/* The MedRep's bag, a route through two pins, a handshake card */}
    <rect x="30" y="50" width="52" height="36" rx="6" fill={ORANGE} stroke={INK} />
    <path d="M46 50v-6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v6" />
    <path d="M56 60v14M49 67h14" stroke="#fff" strokeWidth="2.6" />
    <path d="M92 74c10-2 14-16 26-18s16-10 18-18" strokeDasharray="3 4" />
    <path d="M96 64a6 6 0 1 1 12 0c0 5-6 10-6 10s-6-5-6-10z" fill={GREEN} />
    <circle cx="102" cy="64" r="2" fill="#fff" stroke="none" />
    <path d="M128 34a6 6 0 1 1 12 0c0 5-6 10-6 10s-6-5-6-10z" fill={ORANGE} />
    <circle cx="134" cy="34" r="2" fill="#fff" stroke="none" />
  </Scene>
);

const Management = () => (
  <Scene label="Management">
    {/* A clipboard of orders, two ticked, and the approval stamp */}
    <rect x="40" y="26" width="58" height="72" rx="6" fill="#fff" />
    <rect x="56" y="20" width="26" height="12" rx="4" fill={GREEN_SOFT} />
    <path d="M50 46l4 4 8-8" stroke={GREEN} strokeWidth="2.4" />
    <path d="M68 46h20M50 62l4 4 8-8" />
    <path d="M50 62l4 4 8-8" stroke={GREEN} strokeWidth="2.4" />
    <path d="M68 62h20M50 78h38" />
    <circle cx="112" cy="74" r="16" fill={ORANGE} />
    <path d="M104 74l6 6 10-12" stroke="#fff" strokeWidth="2.8" />
  </Scene>
);

const Finance = () => (
  <Scene label="Finance">
    {/* Coins rising beside a ledger's chart */}
    <rect x="28" y="32" width="64" height="58" rx="6" fill="#fff" />
    <path d="M38 78l12-14 10 8 18-22" stroke={GREEN} strokeWidth="2.4" />
    <path d="M72 50h6v6" stroke={GREEN} strokeWidth="2.4" />
    <path d="M38 44h22" />
    <ellipse cx="118" cy="86" rx="16" ry="5" fill={ORANGE} />
    <path d="M102 86v-8c0 3 7 5 16 5s16-2 16-5v8" fill={ORANGE} />
    <ellipse cx="118" cy="78" rx="16" ry="5" fill="#ffb27f" />
    <path d="M102 78v-8c0 3 7 5 16 5s16-2 16-5v8" fill={ORANGE} />
    <ellipse cx="118" cy="70" rx="16" ry="5" fill="#ffb27f" />
    <path d="M114 70h8" stroke="#fff" strokeWidth="2.4" />
  </Scene>
);

const Inventory = () => (
  <Scene label="Inventory">
    {/* A shelf of boxes and a vial, batch-labelled */}
    <path d="M24 90h112M24 58h112M30 90V36M130 90V36" />
    <rect x="38" y="66" width="24" height="24" rx="3" fill={ORANGE} />
    <path d="M44 74h12" stroke="#fff" strokeWidth="2.4" />
    <rect x="66" y="70" width="20" height="20" rx="3" fill={GREEN_SOFT} />
    <rect x="92" y="62" width="28" height="28" rx="3" fill="#fff" />
    <path d="M100 72h12M100 78h8" />
    <rect x="44" y="38" width="12" height="20" rx="3" fill={GREEN} />
    <path d="M46 38v-4h8v4" />
    <rect x="62" y="42" width="12" height="16" rx="3" fill="#fff" />
    <rect x="82" y="34" width="34" height="24" rx="3" fill={ORANGE_SOFT} />
    <path d="M90 46h18" />
  </Scene>
);

const Dispatch = () => (
  <Scene label="Dispatch">
    {/* The delivery van on its way */}
    <path d="M16 90h128" strokeDasharray="6 6" />
    <path d="M30 54h56v30H30z" fill={ORANGE} />
    <path d="M86 62h20l12 12v10H86z" fill="#fff" />
    <path d="M92 66h12l6 8H92z" fill={GREEN_SOFT} />
    <circle cx="46" cy="86" r="7" fill="#fff" />
    <circle cx="104" cy="86" r="7" fill="#fff" />
    <path d="M42 66h22" stroke="#fff" strokeWidth="2.6" />
    <path d="M122 46h14M126 54h12" stroke={GREEN} />
  </Scene>
);

const Online = () => (
  <Scene label="Online desk">
    {/* A phone with the customer's message and the reply */}
    <rect x="34" y="20" width="44" height="80" rx="8" fill="#fff" />
    <path d="M50 26h12" />
    <rect x="40" y="36" width="28" height="12" rx="6" fill={GREEN_SOFT} />
    <rect x="46" y="54" width="26" height="12" rx="6" fill={ORANGE} />
    <path d="M94 50h44a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-30l-10 8v-8h-4a6 6 0 0 1-6-6V56a6 6 0 0 1 6-6z" fill={GREEN} />
    <circle cx="106" cy="65" r="2" fill="#fff" stroke="none" />
    <circle cx="116" cy="65" r="2" fill="#fff" stroke="none" />
    <circle cx="126" cy="65" r="2" fill="#fff" stroke="none" />
  </Scene>
);

const Hr = () => (
  <Scene label="HR">
    {/* Three people and an ID badge */}
    <circle cx="52" cy="50" r="10" fill={ORANGE_SOFT} />
    <path d="M34 86c2-14 10-20 18-20s16 6 18 20" fill={ORANGE} />
    <circle cx="80" cy="44" r="11" fill={GREEN_SOFT} />
    <path d="M60 86c2-16 10-24 20-24s18 8 20 24" fill={GREEN} />
    <rect x="104" y="44" width="34" height="44" rx="5" fill="#fff" />
    <circle cx="121" cy="60" r="6" fill={ORANGE_SOFT} />
    <path d="M112 76h18M116 82h10" />
  </Scene>
);

const Regulatory = () => (
  <Scene label="Regulatory">
    {/* The registration certificate and the safety shield */}
    <rect x="30" y="28" width="58" height="66" rx="5" fill="#fff" />
    <path d="M40 42h38M40 52h38M40 62h24" />
    <circle cx="70" cy="80" r="8" fill={ORANGE} />
    <path d="M66 86l-2 10 6-4 6 4-2-10" fill={ORANGE} />
    <path d="M118 30l20 8v16c0 14-9 24-20 28-11-4-20-14-20-28V38z" fill={GREEN} />
    <path d="M110 56l6 6 10-12" stroke="#fff" strokeWidth="2.8" />
  </Scene>
);

const Office = () => (
  <Scene label="Office staff">
    {/* The open work log and its pen */}
    <path d="M28 40c12-6 28-6 42 0v52c-14-6-30-6-42 0z" fill="#fff" />
    <path d="M70 40c14-6 30-6 42 0v52c-12-6-28-6-42 0z" fill={ORANGE_SOFT} />
    <path d="M36 52h24M36 62h24M36 72h18M78 52h24M78 62h16" />
    <path d="M120 30l12 12-34 34-14 2 2-14z" fill={GREEN} />
    <path d="M114 36l12 12" />
  </Scene>
);

const Ceo = () => (
  <Scene label="CEO">
    {/* The summit, its flag, and the company's growth */}
    <path d="M18 92l34-46 18 22 16-14 30 38z" fill={GREEN_SOFT} />
    <path d="M52 46l8 10" />
    <path d="M86 54V28" />
    <path d="M86 28h20l-6 6 6 6H86" fill={ORANGE} />
    <rect x="112" y="72" width="8" height="20" rx="2" fill={ORANGE_SOFT} />
    <rect x="124" y="62" width="8" height="30" rx="2" fill={ORANGE} />
    <rect x="136" y="50" width="8" height="42" rx="2" fill={GREEN} />
  </Scene>
);

const Admin = () => (
  <Scene label="Administration">
    {/* The settings gear and the key to every login */}
    <path
      d="M64 38l5 1 2-6h8l2 6 5 2 5-3 6 6-3 5 2 5 6 2v8l-6 2-2 5 3 5-6 6-5-3-5 2-2 6h-8l-2-6-5-2-5 3-6-6 3-5-2-5-6-2v-8l6-2 2-5-3-5 6-6z"
      fill={GREEN}
    />
    <circle cx="75" cy="60" r="10" fill="#fff" />
    <circle cx="118" cy="74" r="10" fill={ORANGE} />
    <path d="M110 80l-20 18M98 90l5 5M93 95l4 4" />
    <circle cx="118" cy="74" r="3" fill="#fff" stroke="none" />
  </Scene>
);

/** Each workspace's scene, by its key. */
export const WORKSPACE_ART: Record<string, () => ReactNode> = {
  sales: Sales,
  management: Management,
  finance: Finance,
  inventory: Inventory,
  dispatch: Dispatch,
  online: Online,
  hr: Hr,
  regulatory: Regulatory,
  office: Office,
  ceo: Ceo,
  admin: Admin,
};

/** The logo's orbit, large and quiet, for the portal's dark side. */
export function OrbitBackdrop() {
  return (
    <svg viewBox="0 0 800 600" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
      <ellipse cx="420" cy="360" rx="520" ry="150" transform="rotate(-14 420 360)" stroke={GREEN} strokeOpacity=".28" strokeWidth="2" fill="none" />
      <ellipse cx="420" cy="360" rx="420" ry="110" transform="rotate(-14 420 360)" stroke={ORANGE} strokeOpacity=".14" strokeWidth="1.5" fill="none" />
      <path d="M690 120l6 15 15 6-15 6-6 15-6-15-15-6 15-6z" fill={GREEN} fillOpacity=".55" />
      <path d="M150 470l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill={ORANGE} fillOpacity=".5" />
    </svg>
  );
}
