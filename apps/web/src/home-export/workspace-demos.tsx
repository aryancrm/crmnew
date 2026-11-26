// A small, scripted "live" board for each of the 14 workspaces in the showcase, built like the
// export's own system demos (HomePage.jsx, SystemDemo): two team cursors with name tags move
// around and do that workspace's everyday job. Pure illustration; the names and figures are made up.
// It uses the export's `sd__` styles, so it looks the same as the export's demos.

import { type CSSProperties, type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { TILE_ICONS } from "../portal/tiles";

type St = Record<string, any>;
type Step = {
  to?: string;
  fx?: number;
  fy?: number;
  move?: number;
  wait?: number;
  wait0?: number;
  click?: 1;
  carry?: string | null;
  set?: St;
  type?: [string, string];
};
type Scene = {
  nav: string[];
  on: number;
  title: string;
  action: string;
  people: [Who, Who];
  init: St;
  scripts: Step[][];
  View: (props: { st: St }) => JSX.Element;
};

const PEOPLE = {
  mark: { name: "Mark", c: "#5a6dff", d: "0s" },
  john: { name: "John", c: "#ffd900", ci: "#1a1a1a", d: "-0.8s" },
  joshua: { name: "Joshua", c: "#fd4040", d: "-1.4s" },
  angel: { name: "Angel", c: "#3e8e2d", d: "-2s" },
  jane: { name: "Jane", c: "#f36b21", d: "-0.5s" },
  kate: { name: "Kate", c: "#173f2a", d: "-1.1s" },
};
type Who = keyof typeof PEOPLE;
type Person = { name: string; c: string; ci?: string; d: string };
const person = (k: Who): Person => PEOPLE[k];

type Tone = "blue" | "red" | "green" | "yellow" | undefined;

const Chip = ({ tone, children }: { tone?: Tone; children: ReactNode }) => (
  <span className="sd__chip" data-tone={tone}>
    {children}
  </span>
);

const Bar = ({ pct, low, t }: { pct: number; low?: boolean; t?: string }) => (
  <span className={`sd__bar ${low ? "is-low" : ""}`} data-t={t}>
    <i style={{ width: `${pct}%` }} />
  </span>
);

const Av = ({ k }: { k: Who }) => (
  <span className="sd__av" style={{ "--c": person(k).c, "--ci": person(k).ci ?? "#fff" } as CSSProperties}>
    {person(k).name[0]}
  </span>
);

const Btn = ({ t, done, ghost, children }: { t?: string; done?: unknown; ghost?: boolean; children: ReactNode }) => (
  <span className={`sd__btn ${ghost ? "is-ghost" : ""} ${done ? "is-done" : ""}`} data-t={t}>
    {children}
  </span>
);

/** A table: a header row in the group colour, then rows of cells. */
function Table({ title, grp, cols, head, children }: { title: string; grp: string; cols: string; head: string[]; children: ReactNode }) {
  return (
    <div className="sd__table" style={{ "--cols": cols, "--grp": grp } as CSSProperties}>
      <div className="sd__tr sd__th">
        <span className="sd__grp">{title}</span>
        {head.map((h, i) => (
          <span key={i}>{h}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

const Row = ({ t, children }: { t?: string; children: ReactNode }) => (
  <div className="sd__tr" data-t={t}>
    {children}
  </div>
);

const Name = ({ b, s }: { b: string; s?: string }) => (
  <span>
    <b>{b}</b>
    {s ? <small>{s}</small> : null}
  </span>
);

/** Small table under each board: [title, sub, owner, middle, chip tone, chip label] rows. */
const MiniTable = ({ title, grp, head, rows }: { title: string; grp: string; head: string; rows: [string, string, Who, string, Tone, string][] }) => (
  <Table title={title} grp={grp} cols="1.6fr 46px 0.9fr 1fr" head={["Owner", head, "Status"]}>
    {rows.map(([name, sub, who, mid, tone, label]) => (
      <Row key={name}>
        <Name b={name} s={sub} />
        <span>
          <Av k={who} />
        </span>
        <span>{mid}</span>
        <span>
          <Chip tone={tone}>{label}</Chip>
        </span>
      </Row>
    ))}
  </Table>
);

/** A board of columns; cards move between them (st[card] names the column). */
function Board({ st, cols, cards }: { st: St; cols: [string, string][]; cards: { id: string; name: string; sub: string; col: string }[] }) {
  return (
    <div className="sd__cols">
      {cols.map(([key, label], i) => {
        const list = cards.map((c) => ({ ...c, col: st[c.id] || c.col })).filter((c) => c.col === key);
        return (
          <div key={key} className="sd__col" data-t={`col-${key}`} data-won={i === cols.length - 1 || undefined}>
            <h6>
              {label}
              <span key={list.length}>{list.length}</span>
            </h6>
            {list.map((c) =>
              st[`lift_${c.id}`] ? (
                <div key={c.id} className="sd__deal is-ghost" />
              ) : (
                <div key={`${c.id}-${c.col}`} className="sd__deal" data-t={`d-${c.id}`}>
                  {c.name}
                  <small>{c.sub}</small>
                </div>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A bar chart with a Week / Month switch and a tip on one bar. */
function Chart({ st, title, week, month, tip }: { st: St; title: string; week: number[]; month: number[]; tip: string }) {
  const isMonth = st.range === "month";
  const vals = isMonth ? month : week;
  const labels = isMonth ? ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] : ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="sd__chart">
      <div className="sd__chart-head">
        <b>{title}</b>
        <span className="sd__seg">
          <span className={!isMonth ? "is-on" : ""} data-t="week">
            Week
          </span>
          <span className={isMonth ? "is-on" : ""} data-t="month">
            Month
          </span>
        </span>
      </div>
      <div className="sd__bars">
        {vals.map((v, i) => (
          <span key={i} data-t={`bar${i}`} className={st.tip === i ? "is-hot" : ""} style={{ height: `${v}%` }}>
            {st.tip === i ? <em className="sd__tip">{tip}</em> : null}
          </span>
        ))}
      </div>
      <div className="sd__axis">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/** A list on the left and the open item on the right, with a reply typed into it. */
function Desk({
  st,
  items,
  head,
  ctx,
  msg,
  empty,
  sendLabel,
}: {
  st: St;
  items: { b: string; s: string; chip: ReactNode; t?: string }[];
  head: string;
  ctx: ReactNode;
  msg: string;
  empty: string;
  sendLabel: [string, string];
}) {
  return (
    <div className="sd__desk">
      <div className="sd__tickets">
        {items.map((it, i) => (
          <div key={it.b} className={`sd__ticket ${i === 0 && st.open === 0 ? "is-on" : ""}`} data-t={it.t ?? (i === 0 ? "t0" : undefined)}>
            <b>{it.b}</b>
            <small>{it.s}</small>
            {it.chip}
          </div>
        ))}
      </div>
      <div className="sd__card sd__detail">
        {st.open === 0 ? (
          <>
            <h6>{head}</h6>
            <span className="sd__ctx">{ctx}</span>
            <p className="sd__msg">{msg}</p>
            <div className={`sd__reply ${st.reply !== undefined && !st.solved ? "is-typing" : ""}`} data-t="reply">
              {st.reply || <span className="sd__ph">Write here…</span>}
            </div>
            <span className={`sd__btn sd__send ${st.solved ? "is-done" : ""}`} data-t="send">
              {st.solved ? sendLabel[1] : sendLabel[0]}
            </span>
          </>
        ) : (
          <span className="sd__empty">{empty}</span>
        )}
      </div>
    </div>
  );
}

/* --- One scene per workspace ------------------------------------------------- */
export const SCENES: Record<string, Scene> = {
  leads: {
    nav: ["Today", "Team orders", "Targets", "Customers"],
    on: 1,
    title: "Team orders",
    action: "Ask for exception",
    people: ["jane", "mark"],
    init: { msg: "Checking the team's orders for today" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 250 },
        { to: "send", click: 1, set: { sent: 1, msg: "SO-3412 sent on to Management" }, wait: 1700 },
      ],
      [
        { wait0: 1800 },
        { to: "r1", fx: 0.3, wait: 250 },
        { to: "back", click: 1, set: { back: 1, msg: "SO-3409 sent back: Rx missing" }, wait: 900 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="Held orders" grp="#5a6dff" cols="1.6fr 46px 0.9fr 0.95fr 78px" head={["Rep", "Amount", "Status", ""]}>
          <Row t="r0">
            <Name b="SO-3412" s="St. Luke's Clinic" />
            <span><Av k="mark" /></span>
            <span>₱48,200</span>
            <span>{st.sent ? <Chip tone="blue">With Mgmt</Chip> : <Chip tone="yellow">Held</Chip>}</span>
            <span><Btn t="send" done={st.sent}>{st.sent ? "Sent" : "Send on"}</Btn></span>
          </Row>
          <Row t="r1">
            <Name b="SO-3409" s="Rivera Pharmacy" />
            <span><Av k="kate" /></span>
            <span>₱12,750</span>
            <span>{st.back ? <Chip tone="red">Sent back</Chip> : <Chip tone="yellow">Held</Chip>}</span>
            <span><Btn t="back" ghost done={st.back}>{st.back ? "Done" : "Send back"}</Btn></span>
          </Row>
          <Row>
            <Name b="SO-3405" s="Metro Hospital" />
            <span><Av k="angel" /></span>
            <span>₱96,000</span>
            <span><Chip tone="green">Approved</Chip></span>
            <span />
          </Row>
        </Table>
        <Table title="Against target" grp="#3e8e2d" cols="1.6fr 46px 1.6fr 0.8fr" head={["", "This month", ""]}>
          <Row>
            <Name b="Mark" s="₱410k of ₱500k" />
            <span><Av k="mark" /></span>
            <span><Bar pct={st.sent ? 92 : 82} /></span>
            <span><Chip tone="green">{st.sent ? "92%" : "82%"}</Chip></span>
          </Row>
          <Row>
            <Name b="Kate" s="₱190k of ₱450k" />
            <span><Av k="kate" /></span>
            <span><Bar pct={42} low /></span>
            <span><Chip tone="red">42%</Chip></span>
          </Row>
        </Table>
      </>
    ),
  },

  heads: {
    nav: ["Channels", "Managers", "Map", "Targets"],
    on: 0,
    title: "Channels",
    action: "Set targets",
    people: ["kate", "joshua"],
    init: { msg: "Each channel against the month's target" },
    scripts: [
      [
        { to: "month", click: 1, set: { range: "month" }, wait: 1000 },
        { to: "bar5", fy: 0.25, set: { tip: 5 }, wait: 1300 },
      ],
      [
        { wait0: 2600 },
        { to: "action", click: 1, set: { msg: "November targets set for 6 managers" }, wait: 1800 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Chart st={st} title="Sales, all channels" week={[38, 52, 47, 66, 58, 74, 61]} month={[50, 58, 63, 69, 72, 91, 80]} tip="₱8.6M · 104% of target" />
        <MiniTable
          title="Managers"
          grp="#f36b21"
          head="Of target"
          rows={[
            ["Hospital channel", "4 teams", "kate", "96%", "green", "On track"],
            ["Drugstores", "3 teams", "joshua", "71%", "yellow", "Behind"],
          ]}
        />
      </>
    ),
  },

  sales: {
    nav: ["Today", "Visits", "Orders", "Customers"],
    on: 0,
    title: "Today's visits",
    action: "+ New order",
    people: ["mark", "angel"],
    init: { open: -1, msg: "4 visits planned for today" },
    scripts: [
      [
        { to: "t0", fx: 0.4, click: 1, set: { open: 0 }, wait: 500 },
        { to: "reply", fx: 0.3, click: 1, wait: 100 },
        { type: ["reply", "Amoxicillin 500mg × 20 boxes, terms 30 days"], wait: 250 },
        { to: "send", click: 1, set: { solved: 1, msg: "Order SO-3415 taken at Dr. Cruz's clinic" }, wait: 1600 },
      ],
      [
        { wait0: 1300 },
        { to: "checkin", click: 1, set: { checked: 1 }, wait: 700 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Desk
          st={st}
          items={[
            { b: "Dr. Cruz · Paediatrics", s: "9:30 · Makati Med", chip: st.solved ? <Chip tone="green">Order taken</Chip> : <Chip tone="blue">Visit now</Chip> },
            {
              b: "Rivera Pharmacy",
              s: "11:00 · Pasig",
              t: "checkin",
              chip: <span className={`sd__assign ${st.checked ? "is-done" : ""}`}>{st.checked ? "Checked in" : "Check in"}</span>,
            },
            { b: "Metro Hospital", s: "2:00 · Collection ₱24,800", chip: <Chip tone="yellow">Collect</Chip> },
          ]}
          head="Dr. Cruz · new order"
          ctx={
            <>
              <Chip tone="blue">Rx attached</Chip>
              <Chip tone="yellow">Last order 12 days ago</Chip>
            </>
          }
          msg="Needs stock for next week's patients."
          empty="Pick a visit to see the customer and take an order on the spot."
          sendLabel={["Take order", "Taken"]}
        />
        <MiniTable
          title="My score"
          grp="#3e8e2d"
          head="This month"
          rows={[
            ["Visits", "38 of 45", "mark", "84%", "green", "Good"],
            ["Collections", "₱120k due", "mark", "61%", "yellow", "Call 3"],
          ]}
        />
      </>
    ),
  },

  management: {
    nav: ["To check", "Stuck", "Returns", "New customers"],
    on: 0,
    title: "Orders to check",
    action: "Approve all",
    people: ["john", "kate"],
    init: { msg: "7 orders waiting for approval" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 250 },
        { to: "approve", click: 1, set: { approved: 1, msg: "SO-3412 approved: price and customer checked" }, wait: 1700 },
      ],
      [
        { wait0: 1900 },
        { to: "r1", fx: 0.3, wait: 250 },
        { to: "hold", click: 1, set: { held: 1, msg: "SO-3410 held: over the credit limit" }, wait: 900 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="Waiting for you" grp="#5a6dff" cols="1.6fr 46px 0.9fr 0.95fr 74px" head={["Rep", "Amount", "Check", ""]}>
          <Row t="r0">
            <Name b="SO-3412" s="St. Luke's Clinic" />
            <span><Av k="mark" /></span>
            <span>₱48,200</span>
            <span>{st.approved ? <Chip tone="green">Approved</Chip> : <Chip tone="blue">Price ok</Chip>}</span>
            <span><Btn t="approve" done={st.approved}>{st.approved ? "Done" : "Approve"}</Btn></span>
          </Row>
          <Row t="r1">
            <Name b="SO-3410" s="Santos Drugstore" />
            <span><Av k="jane" /></span>
            <span>₱210,000</span>
            <span>{st.held ? <Chip tone="red">Held</Chip> : <Chip tone="yellow">Over limit</Chip>}</span>
            <span><Btn t="hold" ghost done={st.held}>{st.held ? "Held" : "Hold"}</Btn></span>
          </Row>
          <Row>
            <Name b="SO-3407" s="Metro Hospital" />
            <span><Av k="angel" /></span>
            <span>₱96,000</span>
            <span><Chip tone="blue">Price ok</Chip></span>
            <span><Btn>Approve</Btn></span>
          </Row>
        </Table>
        <MiniTable
          title="Stuck over two days"
          grp="#fd4040"
          head="Waiting"
          rows={[
            ["SO-3391", "Waiting for payment", "joshua", "3 days", "red", "Chase"],
            ["RT-118", "Return to approve", "kate", "2 days", "yellow", "Review"],
          ]}
        />
      </>
    ),
  },

  finance: {
    nav: ["Payments", "Invoices", "Owed", "Banking"],
    on: 0,
    title: "Payments to confirm",
    action: "+ Record payment",
    people: ["jane", "angel"],
    init: { msg: "Confirming today's payments" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 200 },
        { to: "confirm", click: 1, set: { paid: 1, msg: "₱48,200 transfer confirmed for SO-3412" }, wait: 1700 },
      ],
      [
        { wait0: 1900 },
        { to: "cheque", click: 1, set: { cheque: 1, msg: "Cheque deposited, clears in 3 days" }, wait: 1300 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="Approved orders" grp="#3e8e2d" cols="1.5fr 46px 0.9fr 0.85fr 82px" head={["By", "Amount", "How", ""]}>
          <Row t="r0">
            <Name b="SO-3412" s="St. Luke's Clinic" />
            <span><Av k="jane" /></span>
            <span>₱48,200</span>
            <span>{st.paid ? <Chip tone="green">Paid</Chip> : <Chip tone="blue">Transfer</Chip>}</span>
            <span><Btn t="confirm" done={st.paid}>{st.paid ? "Confirmed" : "Confirm"}</Btn></span>
          </Row>
          <Row>
            <Name b="SO-3407" s="Metro Hospital" />
            <span><Av k="angel" /></span>
            <span>₱96,000</span>
            <span>{st.cheque ? <Chip tone="yellow">Deposited</Chip> : <Chip tone="blue">Cheque</Chip>}</span>
            <span><Btn t="cheque" ghost done={st.cheque}>{st.cheque ? "Done" : "Deposit"}</Btn></span>
          </Row>
          <Row>
            <Name b="SO-3404" s="Rivera Pharmacy" />
            <span><Av k="mark" /></span>
            <span>₱12,750</span>
            <span><Chip tone="yellow">30 days</Chip></span>
            <span><Btn ghost>Remind</Btn></span>
          </Row>
        </Table>
        <MiniTable
          title="What customers owe"
          grp="#f36b21"
          head="Balance"
          rows={[
            ["Santos Drugstore", "2 invoices", "jane", "₱184k", "red", "Overdue"],
            ["Metro Hospital", "1 invoice", "angel", st.cheque ? "₱0" : "₱96k", st.cheque ? "green" : "yellow", st.cheque ? "Clearing" : "Due Fri"],
          ]}
        />
      </>
    ),
  },

  inventory: {
    nav: ["Medicines", "Batches", "Transfers", "Purchases"],
    on: 1,
    title: "Batches",
    action: "+ Purchase order",
    people: ["mark", "joshua"],
    init: { msg: "Watching stock and expiry in 2 warehouses" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 250 },
        { to: "issue", click: 1, set: { issued: 1, msg: "Batch AMX-2611 given to SO-3412" }, wait: 1700 },
      ],
      [
        { wait0: 1700 },
        { to: "r2", fx: 0.3, wait: 250 },
        { to: "move", click: 1, set: { moved: 1, msg: "60 boxes moved to the Cebu warehouse" }, wait: 700 },
        { to: "bar2", fx: 0.8, wait: 600 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="Batches" grp="#5a6dff" cols="1.7fr 46px 1fr 0.95fr 72px" head={["By", "Stock", "Expiry", ""]}>
          <Row t="r0">
            <Name b="Amoxicillin 500mg" s={`AMX-2611 · ${st.issued ? 300 : 320} boxes`} />
            <span><Av k="mark" /></span>
            <span><Bar pct={st.issued ? 60 : 64} /></span>
            <span><Chip tone="green">Aug 2028</Chip></span>
            <span><Btn t="issue" done={st.issued}>{st.issued ? "Given" : "Give"}</Btn></span>
          </Row>
          <Row>
            <Name b="Paracetamol 500mg" s="PCM-2588 · 14 boxes" />
            <span><Av k="kate" /></span>
            <span><Bar pct={9} low /></span>
            <span><Chip tone="red">Low</Chip></span>
            <span />
          </Row>
          <Row t="r2">
            <Name b="Cetirizine 10mg" s={`CTZ-2540 · ${st.moved ? "Cebu" : "Manila"}`} />
            <span><Av k="joshua" /></span>
            <span><Bar pct={st.moved ? 80 : 40} t="bar2" /></span>
            <span><Chip tone="yellow">Feb 2027</Chip></span>
            <span><Btn t="move" ghost done={st.moved}>{st.moved ? "Moved" : "Transfer"}</Btn></span>
          </Row>
        </Table>
        <MiniTable
          title="Purchase orders"
          grp="#f36b21"
          head="Boxes"
          rows={[
            ["PO-0921", "MedSupply Co.", "mark", "400", "yellow", "In transit"],
            ["PO-0918", "PharmaHub", "joshua", "250", "green", "Received"],
          ]}
        />
      </>
    ),
  },

  dispatch: {
    nav: ["To pack", "Shipments", "Couriers", "Delivered"],
    on: 1,
    title: "Shipments",
    action: "+ Book courier",
    people: ["john", "angel"],
    init: { msg: "Packing today's approved, paid orders" },
    scripts: [
      [
        { to: "d-a", wait: 200 },
        { click: 1, carry: "SO-3412 · 3 boxes", set: { lift_a: 1 }, wait: 120 },
        { to: "col-ship", fy: 0.75, move: 900 },
        { click: 1, carry: null, set: { a: "ship", lift_a: 0, msg: "SO-3412 packed and handed to the courier" }, wait: 1500 },
      ],
      [
        { wait0: 2900 },
        { to: "d-c", wait: 200 },
        { click: 1, carry: "SO-3398 · delivered", set: { lift_c: 1 }, wait: 120 },
        { to: "col-done", fy: 0.75, move: 900 },
        { click: 1, carry: null, set: { c: "done", lift_c: 0 }, wait: 600 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Board
          st={st}
          cols={[
            ["pack", "To pack"],
            ["ship", "On the way"],
            ["done", "Delivered"],
          ]}
          cards={[
            { id: "a", name: "SO-3412", sub: "St. Luke's · 3 boxes", col: "pack" },
            { id: "b", name: "SO-3407", sub: "Metro Hospital", col: "pack" },
            { id: "c", name: "SO-3398", sub: "Rivera · LBC", col: "ship" },
            { id: "d", name: "SO-3390", sub: "Santos · J&T", col: "done" },
          ]}
        />
        <MiniTable
          title="Couriers today"
          grp="#5a6dff"
          head="Parcels"
          rows={[
            ["LBC", "Pick-up 3:00", "john", "6", "blue", "Booked"],
            ["Own van", "Metro Manila", "angel", "4", "green", "Out"],
          ]}
        />
      </>
    ),
  },

  online: {
    nav: ["Inbox", "Leads", "Patients", "Channels"],
    on: 0,
    title: "Inbox",
    action: "+ New lead",
    people: ["kate", "mark"],
    init: { open: -1, msg: "Answering Messenger and website chats" },
    scripts: [
      [
        { to: "t0", fx: 0.4, click: 1, set: { open: 0 }, wait: 500 },
        { to: "reply", fx: 0.3, click: 1, wait: 100 },
        { type: ["reply", "Yes, in stock. We can deliver tomorrow."], wait: 250 },
        { to: "send", click: 1, set: { solved: 1, msg: "Reply sent · enquiry saved as a lead" }, wait: 1600 },
      ],
      [
        { wait0: 1300 },
        { to: "assign", click: 1, set: { assigned: 1 }, wait: 700 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Desk
          st={st}
          items={[
            { b: "Do you have Losartan 50mg?", s: "Messenger · Ana R.", chip: st.solved ? <Chip tone="green">Lead</Chip> : <Chip tone="red">New</Chip> },
            {
              b: "Bulk order for our clinic",
              s: "Website · Zen Clinic",
              t: "assign",
              chip: <span className={`sd__assign ${st.assigned ? "is-done" : ""}`}>{st.assigned ? "Mark" : "Give to a rep"}</span>,
            },
            { b: "Points balance", s: "Patient · #P-2210", chip: <Chip tone="blue">Replied</Chip> },
          ]}
          head="Ana R. · Messenger"
          ctx={
            <>
              <Chip tone="blue">Patient · 320 points</Chip>
              <Chip tone="yellow">Last bought Oct 2</Chip>
            </>
          }
          msg="Hi! Do you have Losartan 50mg? I need 3 boxes."
          empty="Pick a message to see the person's orders and points."
          sendLabel={["Send", "Sent"]}
        />
        <MiniTable
          title="Channels"
          grp="#3e8e2d"
          head="Today"
          rows={[
            ["Messenger", "Page inbox", "kate", "42 chats", "green", "Live"],
            ["Website", "Order form", "mark", "9 leads", "blue", "Live"],
          ]}
        />
      </>
    ),
  },

  hr: {
    nav: ["People", "Attendance", "Leave", "Payroll"],
    on: 2,
    title: "Leave",
    action: "Run payroll",
    people: ["angel", "jane"],
    init: { msg: "3 leave requests to approve" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 250 },
        { to: "approve", click: 1, set: { approved: 1, msg: "Leave approved for Kate, Nov 27–28" }, wait: 1700 },
      ],
      [
        { wait0: 2000 },
        { to: "action", click: 1, set: { payroll: 1, msg: "Payroll for Nov 16–30 ready · 128 payslips" }, wait: 1300 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="Leave requests" grp="#5a6dff" cols="1.6fr 46px 0.9fr 0.9fr 78px" head={["", "Days", "Status", ""]}>
          <Row t="r0">
            <Name b="Kate" s="Vacation · Nov 27–28" />
            <span><Av k="kate" /></span>
            <span>2</span>
            <span>{st.approved ? <Chip tone="green">Approved</Chip> : <Chip tone="yellow">Waiting</Chip>}</span>
            <span><Btn t="approve" done={st.approved}>{st.approved ? "Done" : "Approve"}</Btn></span>
          </Row>
          <Row>
            <Name b="Joshua" s="Sick · Nov 24" />
            <span><Av k="joshua" /></span>
            <span>1</span>
            <span><Chip tone="yellow">Waiting</Chip></span>
            <span><Btn>Approve</Btn></span>
          </Row>
        </Table>
        <Table title="Attendance today" grp="#3e8e2d" cols="1.6fr 46px 0.9fr 1fr" head={["", "In", "Status"]}>
          <Row>
            <Name b="Mark" s="Sales · Makati" />
            <span><Av k="mark" /></span>
            <span>8:02</span>
            <span><Chip tone="green">On time</Chip></span>
          </Row>
          <Row>
            <Name b="John" s="Dispatch · Pasig" />
            <span><Av k="john" /></span>
            <span>8:41</span>
            <span><Chip tone="yellow">Late</Chip></span>
          </Row>
          <Row>
            <Name b="Payroll" s="Nov 16–30" />
            <span><Av k="jane" /></span>
            <span>{st.payroll ? "128" : "—"}</span>
            <span>{st.payroll ? <Chip tone="blue">Ready</Chip> : <Chip>Draft</Chip>}</span>
          </Row>
        </Table>
      </>
    ),
  },

  regulatory: {
    nav: ["Registrations", "Complaints", "Documents", "Reports"],
    on: 0,
    title: "Registrations",
    action: "+ New product",
    people: ["kate", "joshua"],
    init: { msg: "Following 4 product registrations" },
    scripts: [
      [
        { to: "d-a", wait: 200 },
        { click: 1, carry: "Losartan 50mg", set: { lift_a: 1 }, wait: 120 },
        { to: "col-review", fy: 0.75, move: 900 },
        { click: 1, carry: null, set: { a: "review", lift_a: 0, msg: "Losartan 50mg filed with the regulator" }, wait: 1500 },
      ],
      [
        { wait0: 2900 },
        { to: "d-c", wait: 200 },
        { click: 1, carry: "Cetirizine syrup", set: { lift_c: 1 }, wait: 120 },
        { to: "col-ok", fy: 0.75, move: 900 },
        { click: 1, carry: null, set: { c: "ok", lift_c: 0 }, wait: 600 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Board
          st={st}
          cols={[
            ["prep", "Preparing"],
            ["review", "Under review"],
            ["ok", "Registered"],
          ]}
          cards={[
            { id: "a", name: "Losartan 50mg", sub: "Dossier ready", col: "prep" },
            { id: "b", name: "Vitamin D3", sub: "Labels pending", col: "prep" },
            { id: "c", name: "Cetirizine syrup", sub: "Filed Sep 14", col: "review" },
            { id: "d", name: "Amoxicillin 500mg", sub: "Renewed", col: "ok" },
          ]}
        />
        <MiniTable
          title="Complaints and side-effects"
          grp="#fd4040"
          head="Due"
          rows={[
            ["CMP-031", "Crushed box", "kate", "Nov 25", "yellow", "Open"],
            ["AE-007", "Rash reported", "joshua", "Today", "red", "Due today"],
          ]}
        />
      </>
    ),
  },

  office: {
    nav: ["Work log", "Leave", "Forms", "Payslips"],
    on: 0,
    title: "My work log",
    action: "+ Add task",
    people: ["john", "jane"],
    init: { msg: "Logging today's work" },
    scripts: [
      [
        { to: "c0", click: 1, set: { c0: 1 }, wait: 650 },
        { to: "c1", click: 1, set: { c1: 1, msg: "2 of 3 tasks done today" }, wait: 1200 },
      ],
      [
        { wait0: 1900 },
        { to: "file", click: 1, set: { filed: 1, msg: "Leave filed for Dec 2, waiting for approval" }, wait: 800 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="Today" grp="#3e8e2d" cols="1.8fr 46px 0.8fr 80px" head={["", "Time", ""]}>
          {(
            [
              ["Encode supplier bills", "9:00–10:30", "c0"],
              ["Prepare delivery receipts", "10:30–12:00", "c1"],
              ["File October reports", "1:00–3:00", "c2"],
            ] as const
          ).map(([task, time, key]) => (
            <Row key={key}>
              <Name b={task} />
              <span><Av k="john" /></span>
              <span>{time}</span>
              <span><Btn t={key} ghost={!st[key]} done={st[key]}>{st[key] ? "Done" : "Mark done"}</Btn></span>
            </Row>
          ))}
        </Table>
        <Table title="My leave" grp="#5a6dff" cols="1.6fr 46px 0.9fr 1fr" head={["", "Days", ""]}>
          <Row>
            <Name b="Vacation" s="Dec 2 · 1 day" />
            <span><Av k="john" /></span>
            <span>1</span>
            <span><Btn t="file" done={st.filed}>{st.filed ? "Filed" : "File leave"}</Btn></span>
          </Row>
          <Row>
            <Name b="Payslip" s="Nov 1–15" />
            <span><Av k="jane" /></span>
            <span>—</span>
            <span><Chip tone="blue">Ready</Chip></span>
          </Row>
        </Table>
      </>
    ),
  },

  ceo: {
    nav: ["Decide", "Sales", "Scorecards", "Books"],
    on: 1,
    title: "The company",
    action: "Share report",
    people: ["angel", "jane"],
    init: { msg: "Reading live numbers from every workspace" },
    scripts: [
      [
        { to: "month", click: 1, set: { range: "month" }, wait: 1000 },
        { to: "bar6", fy: 0.25, set: { tip: 6 }, wait: 1300 },
      ],
      [
        { wait0: 2600 },
        { to: "action", click: 1, set: { msg: "Monthly report sent to the heads" }, wait: 1800 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Chart st={st} title="Sales by channel" week={[44, 57, 49, 70, 62, 79, 71]} month={[54, 61, 59, 68, 75, 83, 95]} tip="₱14.2M · best month" />
        <MiniTable
          title="Waiting on you"
          grp="#f36b21"
          head="Amount"
          rows={[
            ["Credit limit raise", "Santos Drugstore", "jane", "₱300k", "yellow", "Decide"],
            ["Price exception", "Metro Hospital", "angel", "−8%", "blue", "Review"],
          ]}
        />
      </>
    ),
  },

  books: {
    nav: ["Home", "Journals", "Banking", "Reports"],
    on: 2,
    title: "Bank reconciliation",
    action: "+ Journal",
    people: ["jane", "mark"],
    init: { msg: "Matching the bank statement" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 200 },
        { to: "match", click: 1, set: { matched: 1, msg: "Deposit matched to INV-1044" }, wait: 1700 },
      ],
      [
        { wait0: 1900 },
        { to: "post", click: 1, set: { posted: 1, msg: "Bank charge posted to expenses" }, wait: 1300 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="BDO statement · Nov" grp="#3e8e2d" cols="1.4fr 46px 0.9fr 0.85fr 88px" head={["By", "Amount", "Status", ""]}>
          <Row t="r0">
            <Name b="Deposit" s="Nov 21 · St. Luke's" />
            <span><Av k="jane" /></span>
            <span>₱48,200</span>
            <span>{st.matched ? <Chip tone="green">Matched</Chip> : <Chip tone="yellow">Unmatched</Chip>}</span>
            <span><Btn t="match" done={st.matched}>{st.matched ? "Matched" : "Match"}</Btn></span>
          </Row>
          <Row>
            <Name b="Bank charge" s="Nov 21 · Service fee" />
            <span><Av k="mark" /></span>
            <span>−₱150</span>
            <span>{st.posted ? <Chip tone="green">Posted</Chip> : <Chip tone="yellow">New</Chip>}</span>
            <span><Btn t="post" ghost done={st.posted}>{st.posted ? "Posted" : "Post"}</Btn></span>
          </Row>
          <Row>
            <Name b="Cheque 004512" s="Nov 20 · MedSupply" />
            <span><Av k="jane" /></span>
            <span>−₱96,000</span>
            <span><Chip tone="green">Matched</Chip></span>
            <span />
          </Row>
        </Table>
        <MiniTable
          title="Reports"
          grp="#5a6dff"
          head="Period"
          rows={[
            ["Profit and loss", "All branches", "jane", "Nov", "blue", "Live"],
            ["AR aging", "Customers", "mark", "Today", "yellow", "₱1.2M due"],
          ]}
        />
      </>
    ),
  },

  admin: {
    nav: ["People", "Settings", "Audit", "Data checks"],
    on: 0,
    title: "People and logins",
    action: "+ Add person",
    people: ["kate", "john"],
    init: { msg: "Setting up seats and logins" },
    scripts: [
      [
        { to: "r0", fx: 0.3, wait: 250 },
        { to: "seat", click: 1, set: { seat: 1, msg: "Ria given the seat MedRep · Makati" }, wait: 1700 },
      ],
      [
        { wait0: 1900 },
        { to: "check", click: 1, set: { checked: 1, msg: "Data checks: all 24 passed" }, wait: 1200 },
      ],
    ],
    View: ({ st }) => (
      <>
        <Table title="People" grp="#5a6dff" cols="1.6fr 46px 1fr 0.9fr 78px" head={["", "Seat", "Login", ""]}>
          <Row t="r0">
            <Name b="Ria Santos" s="New · joined today" />
            <span><Av k="angel" /></span>
            <span>{st.seat ? "MedRep · Makati" : "—"}</span>
            <span>{st.seat ? <Chip tone="green">Active</Chip> : <Chip tone="yellow">No seat</Chip>}</span>
            <span><Btn t="seat" done={st.seat}>{st.seat ? "Done" : "Give seat"}</Btn></span>
          </Row>
          <Row>
            <Name b="Mark" s="sales12" />
            <span><Av k="mark" /></span>
            <span>MedRep · Pasig</span>
            <span><Chip tone="green">Active</Chip></span>
            <span />
          </Row>
          <Row>
            <Name b="Joshua" s="disp3" />
            <span><Av k="joshua" /></span>
            <span>Dispatch</span>
            <span><Chip tone="green">Active</Chip></span>
            <span />
          </Row>
        </Table>
        <Table title="The audit" grp="#f36b21" cols="1.6fr 46px 0.9fr 1fr" head={["Who", "When", ""]}>
          <Row>
            <Name b="Approved SO-3412" s="Management" />
            <span><Av k="john" /></span>
            <span>10:42</span>
            <span><Chip tone="blue">Order</Chip></span>
          </Row>
          <Row>
            <Name b="Data checks" s="Every table" />
            <span><Av k="john" /></span>
            <span>{st.checked ? "Now" : "Yesterday"}</span>
            <span><Btn t="check" ghost done={st.checked}>{st.checked ? "All passed" : "Run checks"}</Btn></span>
          </Row>
        </Table>
      </>
    ),
  },
};

function Cursor({ c, p }: { c: { x: number; y: number; click: number; carry: string | null; flip?: boolean }; p: Person }) {
  return (
    <div
      className={`sd__cursor ${c.flip ? "is-flip" : ""}`}
      style={{ transform: `translate(${c.x}px, ${c.y}px)`, "--c": p.c, "--ci": p.ci ?? "#fff" } as CSSProperties}
    >
      <span className="sd__ptr" style={{ "--d": p.d } as CSSProperties}>
        <span key={c.click} className={`sd__ripple ${c.click ? "is-on" : ""}`} />
        <svg width="16" height="18" viewBox="0 0 18 20">
          <path d="M1 1l15 7.2-6.6 1.9-3.1 6.4z" fill={p.c} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span className="sd__tag">
          <span className="sd__face">{p.name[0]}</span>
          {p.name}
        </span>
        {c.carry ? <span className="sd__carry">{c.carry}</span> : null}
      </span>
    </div>
  );
}

/** The workspace's tile icon, sized by its box. */
function TileIcon({ workspaceKey, size }: { workspaceKey: string; size: number }) {
  const Drawn = TILE_ICONS[workspaceKey];
  return (
    <span aria-hidden="true" style={{ display: "grid", width: size, height: size, flex: "none" }}>
      {Drawn && <Drawn />}
    </span>
  );
}

/** The live board of one workspace; the same engine as the export's SystemDemo. */
export function WorkspaceDemo({ workspaceKey }: { workspaceKey: string }) {
  const scene = SCENES[workspaceKey] ?? SCENES.leads!;
  const rootRef = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<St>(scene.init);
  const [cycle, setCycle] = useState(0);
  const startCursors = () => scene.people.map((_, i) => ({ x: i ? 420 : 150, y: i ? 70 : 300, click: 0, carry: null as string | null, flip: false }));
  const [cur, setCur] = useState(startCursors);

  useEffect(() => {
    let dead = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const upd = (i: number, fn: (v: ReturnType<typeof startCursors>[number]) => Partial<ReturnType<typeof startCursors>[number]>) =>
      setCur((list) => list.map((v, j) => (j === i ? { ...v, ...fn(v) } : v)));

    // Where a target sits in the window, corrected for any scale on an ancestor.
    const posOf = (t: string, fx = 0.5, fy = 0.55) => {
      const root = rootRef.current;
      const el = root?.querySelector(`[data-t="${t}"]`);
      if (!root || !el) return null;
      const a = root.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const k = root.offsetWidth ? a.width / root.offsetWidth : 1;
      const x = (b.left - a.left + b.width * fx) / k;
      return { x, y: (b.top - a.top + b.height * fy) / k, flip: x > root.offsetWidth - 120 };
    };

    const run = async (steps: Step[], i: number) => {
      for (const s of steps) {
        if (s.wait0) await sleep(s.wait0);
        if (dead) return;
        if (s.to) {
          const p = posOf(s.to, s.fx, s.fy);
          if (p) upd(i, () => p);
          await sleep(s.move ?? 850);
        }
        if (dead) return;
        if (s.click) {
          upd(i, (v) => ({ click: v.click + 1 }));
          await sleep(180);
        }
        if ("carry" in s) upd(i, () => ({ carry: s.carry ?? null }));
        if (s.set) setSt((prev) => ({ ...prev, ...s.set }));
        if (s.type) {
          const [key, text] = s.type;
          for (let n = 0; n <= text.length; n++) {
            if (dead) return;
            setSt((prev) => ({ ...prev, [key]: text.slice(0, n) }));
            await sleep(30);
          }
        }
        await sleep(s.wait ?? 450);
      }
    };

    const loop = async () => {
      await sleep(750);
      while (!dead) {
        await Promise.all(scene.scripts.map((steps, i) => run(steps, i)));
        await sleep(2200);
        if (dead) return;
        // Start over, with the rows animating in again.
        setSt(scene.init);
        setCur((list) => list.map((v, i) => ({ ...startCursors()[i]!, click: v.click })));
        setCycle((n) => n + 1);
        await sleep(1100);
      }
    };
    void loop();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const View = scene.View;

  return (
    <div className="sd" ref={rootRef} aria-hidden="true">
      <div className="sd__header">
        <div className="sd__titlebar">
          <TileIcon workspaceKey={workspaceKey} size={20} />
          <h5>{scene.title}</h5>
          <span className="sd__live">
            <i /> Live
          </span>
          <span className="sd__team">
            {scene.people.map((k) => (
              <span key={k} className="sd__face sd__face--sm" style={{ "--c": person(k).c, "--ci": person(k).ci ?? "#fff" } as CSSProperties}>
                {person(k).name[0]}
              </span>
            ))}
          </span>
        </div>
        <div className="sd__tabs">
          {scene.nav.slice(0, 4).map((n, i) => (
            <span key={n} className={i === scene.on ? "is-on" : ""}>
              {n}
            </span>
          ))}
          <span className="sd__tab-add">+</span>
          <span className="sd__btn sd__action" data-t="action">
            {scene.action}
          </span>
        </div>
      </div>

      <div className="sd__main">
        <div className="sd__view" key={cycle}>
          <View st={st} />
        </div>
      </div>

      <div className="sd__caption">
        <span className="sd__caption-logo">
          <TileIcon workspaceKey={workspaceKey} size={16} />
        </span>
        <span key={st.msg}>{st.msg}</span>
      </div>

      {scene.people.map((k, i) => (
        <Cursor key={k} c={cur[i]!} p={person(k)} />
      ))}
    </div>
  );
}
