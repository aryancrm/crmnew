// One visit, step by step (SEFMED's call, docs/PLAN.md 22): before you go (the client, the last
// five visits, orders, follow-ups, the doctor's prescribing list), 1 the call objective, 2 I'm here,
// 3 the call (met or not, products promoted with samples, prescribing, a hospital's or a firm's own
// answers), 4 the business (Add order, promotional or business, the outcome, productive or not),
// 5 Close the call (follow-up, next visit, feedback, remarks, photos). A closed call is shown as it
// was; the team lead judges a "not sure yet" or reopens it with why.

import type {
  CallDetails,
  CallProduct,
  CloseCallInput,
  Demand,
  FollowUpKind,
  Meeting,
  MissReason,
  Nature,
  Outcome,
  Productive,
  Reaction,
  VisitPage,
} from "@2mg/api/mr";
import {
  DEMAND_WORDS,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_WORDS,
  KIND_ONE,
  MEETING_WORDS,
  MEETINGS,
  MISS_REASONS,
  MISS_WORDS,
  NATURE_WORDS,
  NATURES,
  OBJECTIVE_WORDS,
  OBJECTIVES,
  OUTCOME_WORDS,
  OUTCOMES,
  PRODUCTIVE_WORDS,
  PRODUCTIVES,
  REACTION_WORDS,
  REACTIONS,
} from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, MapPin, Navigation, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { OrderBooking } from "./orders";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import {
  Choices,
  clockOf,
  dayWords,
  directions,
  distanceWords,
  FIELD,
  Label,
  MrHead,
  PlaceLink,
  StatePill,
  whereAmI,
} from "./parts";

const NEAR = 300;
const objectiveWords = (list: string[]) =>
  list.map((one) => OBJECTIVE_WORDS[one as keyof typeof OBJECTIVE_WORDS] ?? one).join(", ");

export function MrVisitPage() {
  const id = Number(useParams().id);
  const query = useQuery({ queryKey: ["mr", "visit", id], queryFn: () => api<VisitPage>(`/api/mr/visits/${id}`) });
  const data = query.data;
  if (!data) return <PageState query={query} what="the visit" />;
  const v = data.visit;
  const c = data.client;
  const planned = v.status === "planned";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-10">
      <MrHead
        title={c.name}
        back="/mr/visits"
        sub={`${KIND_ONE[c.kind]} · ${[c.code, c.specialty ?? c.detail, c.city].filter(Boolean).join(" · ")}`}
        actions={<StatePill visit={v} />}
      />
      <section className={`${CARD} grid gap-2 p-4 text-[13px] sm:grid-cols-2`}>
        <Fact label="Visit date">{dayWords(v.day)}{v.person.name ? ` · ${v.person.name}` : ""}</Fact>
        <Fact label="Address">{c.address || c.city || "—"}</Fact>
        {c.worksAt && <Fact label="Hospital">{c.worksAt.name}</Fact>}
        {c.phone && <Fact label="Contact">{c.phone}{c.contactPerson ? ` · ${c.contactPerson}` : ""}</Fact>}
        {(c.prefDays.length > 0 || c.prefTime) && <Fact label="Best day / time">{[c.prefDays.join(", "), c.prefTime].filter(Boolean).join(" · ")}</Fact>}
        {v.unplanned && <Fact label="Added on the day">{v.addedWhy}</Fact>}
        <div className="flex gap-3 sm:col-span-2">
          <a href={directions(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:underline">
            <Navigation size={14} /> Get directions
          </a>
          <Link to={`/mr/clients/${c.id}`} className="text-sm font-semibold text-sky-700 hover:underline">Client page</Link>
        </div>
      </section>

      {planned && data.can.work ? <WorkTheCall data={data} /> : <ClosedCall data={data} />}

      <LeadTools data={data} />

      <History data={data} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-slate-500 uppercase">{label}</div>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className={`${CARD} p-4`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <span className={`grid size-6 place-items-center rounded-full text-xs text-white ${done ? "bg-emerald-600" : "bg-sky-600"}`}>
          {done ? <Check size={13} /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Steps 1–5 for the MR working an open visit. */
function WorkTheCall({ data }: { data: VisitPage }) {
  const v = data.visit;
  const queries = useQueryClient();
  const action = useAction();
  const [objectives, setObjectives] = useState<string[]>(v.objectives);
  const [objectiveNote, setObjectiveNote] = useState(v.objectiveNote ?? "");
  const [partners, setPartners] = useState<number[]>(v.workingWith.map((one) => one.id));
  const [priority, setPriority] = useState<number | null>(v.priority);
  const [open, setOpen] = useState<"skip" | "move" | null>(null);
  const saved = v.objectives.length > 0;
  const refresh = () => queries.invalidateQueries({ queryKey: ["mr"] });
  const savePlan = () =>
    action.run(async () => {
      await api(`/api/mr/visits/${v.id}/plan`, { body: { objectives, objectiveNote: objectiveNote || null, priority, workingWith: partners } });
      await refresh();
    });
  const checkIn = () =>
    action.run(async () => {
      if (!saved || objectives.join() !== v.objectives.join())
        await api(`/api/mr/visits/${v.id}/plan`, { body: { objectives, objectiveNote: objectiveNote || null, priority, workingWith: partners } });
      const { place } = await whereAmI();
      await api(`/api/mr/visits/${v.id}/check-in`, { body: { place } });
      await refresh();
    });
  return (
    <>
      <Step n={1} title="Select call objective" done={saved}>
        <div className="flex flex-col gap-3">
          <Choices
            options={OBJECTIVES.map((key) => ({ key, label: OBJECTIVE_WORDS[key] }))}
            value={objectives as (typeof OBJECTIVES)[number][]}
            onChange={(next) => setObjectives(next)}
            many
          />
          <Label text="Call objective remark">
            <input className={FIELD} value={objectiveNote} onChange={(event) => setObjectiveNote(event.target.value)} placeholder="What you want from this call" />
          </Label>
          {data.partners.length > 0 && (
            <Label text="Working with">
              <Choices options={data.partners.map((one) => ({ key: String(one.id), label: one.name }))} value={partners.map(String)} onChange={(next) => setPartners(next.map(Number))} many />
            </Label>
          )}
          <Label text="Priority">
            <Choices
              options={[{ key: "1", label: "High" }, { key: "2", label: "Usual" }, { key: "3", label: "Low" }]}
              value={priority ? [String(priority)] : []}
              onChange={(next) => setPriority(next[0] ? Number(next[0]) : null)}
            />
          </Label>
          {!v.checkedInAt && (
            <div className="flex flex-wrap gap-2">
              <Button small disabled={action.busy || objectives.length === 0} onClick={savePlan}>Save</Button>
              {data.can.move && <Button small variant="quiet" onClick={() => setOpen("move")}>Reschedule</Button>}
              {data.can.skip && <Button small variant="quiet" onClick={() => setOpen("skip")}>Skip</Button>}
            </div>
          )}
        </div>
      </Step>

      <Step n={2} title="I'm here" done={Boolean(v.checkedInAt)}>
        {v.checkedInAt ? (
          <div className="text-[13px] text-slate-700">
            Checked in at {clockOf(v.checkedInAt)} · <PlaceLink place={v.checkInPlace} />
            {v.distanceM !== null ? (
              v.distanceM > NEAR ? (
                <span className="ml-1 rounded bg-rose-50 px-1 text-[11px] font-semibold text-rose-700">Away from the place · {distanceWords(v.distanceM)}</span>
              ) : (
                <span className="ml-1 rounded bg-emerald-50 px-1 text-[11px] font-semibold text-emerald-700">At the place</span>
              )
            ) : (
              <span className="ml-1 text-xs text-slate-400">{v.client.pinned ? "no place shared" : "place not pinned yet"}</span>
            )}
            {!v.client.pinned && v.checkInPlace && <PinButton visitId={v.id} />}
          </div>
        ) : data.can.checkIn ? (
          <Button variant="primary" className="w-full" disabled={action.busy || objectives.length === 0} onClick={checkIn}>
            <MapPin size={16} /> {action.busy ? "Taking your place…" : "I'M HERE"}
          </Button>
        ) : (
          <p className="text-sm text-slate-500">I'm here works on the visit's day, after Start working.</p>
        )}
        <Problem message={action.problem?.message} />
      </Step>

      {v.checkedInAt && <CallForm data={data} objectives={objectives} objectiveNote={objectiveNote} />}
      {open === "skip" && <SkipDialog visitId={v.id} onClose={() => setOpen(null)} />}
      {open === "move" && <MoveDialog visitId={v.id} day={v.day} onClose={() => setOpen(null)} />}
    </>
  );
}

function PinButton({ visitId }: { visitId: number }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <Button
      small
      variant="quiet"
      className="ml-2"
      disabled={action.busy}
      onClick={() =>
        action.run(async () => {
          await api(`/api/mr/visits/${visitId}/pin`, { body: {} });
          await queries.invalidateQueries({ queryKey: ["mr"] });
        })
      }
    >
      <MapPin size={13} /> Pin the place here
    </Button>
  );
}

type Line = CallProduct & { name: string };

/** Steps 3–5: the call, the business, Close the call. */
function CallForm({ data, objectives, objectiveNote }: { data: VisitPage; objectives: string[]; objectiveNote: string }) {
  const v = data.visit;
  const kind = data.client.kind;
  const queries = useQueryClient();
  const action = useAction();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [find, setFind] = useState("");
  const [prescribing, setPrescribing] = useState(data.prescribing.map(({ medicineId, name, prescribing: on, top5 }) => ({ medicineId, name, prescribing: on, top5 })));
  const [call, setCall] = useState<CallDetails>({});
  const [met, setMet] = useState("");
  const [nature, setNature] = useState<Nature | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [productive, setProductive] = useState<Productive | null>(null);
  const [chance, setChance] = useState("");
  const [chanceOn, setChanceOn] = useState("");
  const [followOn, setFollowOn] = useState("");
  const [followKind, setFollowKind] = useState<FollowUpKind>("visit");
  const [followWhat, setFollowWhat] = useState("");
  const [nextDay, setNextDay] = useState("");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const found = find.trim()
    ? data.medicines.filter((one) => one.name.toLowerCase().includes(find.trim().toLowerCase()) && !lines.some((line) => line.medicineId === one.id)).slice(0, 8)
    : [];
  const change = (id: number, patch: Partial<Line>) => setLines((all) => all.map((one) => (one.medicineId === id ? { ...one, ...patch } : one)));
  const close = () =>
    action.run(async () => {
      const { place } = await whereAmI();
      const body: CloseCallInput = {
        meeting: meeting as Meeting,
        objectives,
        objectiveNote: objectiveNote || null,
        products: lines.map(({ name: _name, ...line }) => line),
        prescribing: kind === "doctor" ? prescribing.map(({ medicineId, prescribing: on, top5 }) => ({ medicineId, prescribing: on, top5 })) : null,
        call: kind === "hospital" ? { ...call, met: met.split(",").map((one) => one.trim()).filter(Boolean) } : call,
        nature,
        outcome: outcome as Outcome,
        productive: productive as Productive,
        feedback: feedback || null,
        notes: notes || null,
        chanceAmount: outcome === "opportunity" && chance ? Math.round(Number(chance.replace(/[₱,\s]/g, "")) * 100) : null,
        chanceOn: outcome === "opportunity" && chanceOn ? chanceOn : null,
        followUp: followOn ? { on: followOn, kind: followKind, what: followWhat } : null,
        nextDay: nextDay || null,
        place,
      };
      await api(`/api/mr/visits/${v.id}/close`, { body });
      await queries.invalidateQueries({ queryKey: ["mr"] });
    });
  const isMet = meeting === "met";
  return (
    <>
      <Step n={3} title="The call">
        <div className="flex flex-col gap-4">
          <Label text="Did you meet them? *" error={action.at("meeting")}>
            <Choices options={MEETINGS.map((key) => ({ key, label: MEETING_WORDS[key] }))} value={meeting ? [meeting] : []} onChange={(next) => setMeeting(next[0] ?? null)} />
          </Label>
          {isMet && (
            <>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">{kind === "firm" ? "Products: stock and demand" : "Drugs promoted during this call"}</div>
                <input className={FIELD} value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find a medicine to add" />
                {found.length > 0 && (
                  <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {found.map((one) => (
                      <li key={one.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => {
                            setLines((all) => [...all, { medicineId: one.id, name: one.name, promoted: kind !== "firm", reaction: null }]);
                            setFind("");
                          }}
                        >
                          <Plus size={14} /> {one.name} {one.strength}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="mt-2 flex flex-col gap-2">
                  {lines.map((line) => (
                    <li key={line.medicineId} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{line.name}</span>
                        <button type="button" aria-label="Remove" onClick={() => setLines((all) => all.filter((one) => one.medicineId !== line.medicineId))} className="text-slate-400 hover:text-rose-600">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {kind !== "firm" && (
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={line.promoted} onChange={(event) => change(line.medicineId, { promoted: event.target.checked })} /> Promoted
                          </label>
                        )}
                        {kind === "doctor" && (
                          <label className="flex items-center gap-2 text-sm">
                            Sample qty
                            <input type="number" min={0} className={`${FIELD} h-8 w-24`} value={line.samples ?? ""} onChange={(event) => change(line.medicineId, { samples: event.target.value === "" ? null : Number(event.target.value) })} />
                          </label>
                        )}
                        {kind !== "firm" && (
                          <select className={`${FIELD} h-8`} value={line.reaction ?? ""} onChange={(event) => change(line.medicineId, { reaction: (event.target.value || null) as Reaction | null })}>
                            <option value="">How was it taken?</option>
                            {REACTIONS.map((key) => (
                              <option key={key} value={key}>{REACTION_WORDS[key]}</option>
                            ))}
                          </select>
                        )}
                        {kind !== "doctor" && (
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={Boolean(line.inStock)} onChange={(event) => change(line.medicineId, { inStock: event.target.checked })} /> In stock
                          </label>
                        )}
                        {kind !== "doctor" && (
                          <label className="flex items-center gap-2 text-sm">
                            Stock
                            <input type="number" min={0} className={`${FIELD} h-8 w-24`} value={line.stock ?? ""} onChange={(event) => change(line.medicineId, { stock: event.target.value === "" ? null : Number(event.target.value) })} />
                          </label>
                        )}
                        {kind === "firm" && (
                          <>
                            <label className="flex items-center gap-2 text-sm">
                              Sold this month
                              <input type="number" min={0} className={`${FIELD} h-8 w-24`} value={line.sold ?? ""} onChange={(event) => change(line.medicineId, { sold: event.target.value === "" ? null : Number(event.target.value) })} />
                            </label>
                            <select className={`${FIELD} h-8`} value={line.demand ?? ""} onChange={(event) => change(line.medicineId, { demand: (event.target.value || null) as Demand | null })}>
                              <option value="">Demand</option>
                              {(Object.keys(DEMAND_WORDS) as Demand[]).map((key) => (
                                <option key={key} value={key}>{DEMAND_WORDS[key]}</option>
                              ))}
                            </select>
                          </>
                        )}
                        <input className={`${FIELD} h-8`} value={line.competitor ?? ""} onChange={(event) => change(line.medicineId, { competitor: event.target.value })} placeholder="Competitor's brand (if any)" />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              {kind === "doctor" && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Prescribing drugs (this doctor's list: switch and top 5)</div>
                  <ul className="flex flex-col gap-1">
                    {prescribing.map((one) => (
                      <li key={one.medicineId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
                        <span>{one.name}</span>
                        <span className="flex items-center gap-3">
                          <label className="flex items-center gap-1"><input type="checkbox" checked={one.prescribing} onChange={(event) => setPrescribing((all) => all.map((row) => (row.medicineId === one.medicineId ? { ...row, prescribing: event.target.checked } : row)))} /> Prescribing</label>
                          <label className="flex items-center gap-1"><input type="checkbox" checked={one.top5} onChange={(event) => setPrescribing((all) => all.map((row) => (row.medicineId === one.medicineId ? { ...row, top5: event.target.checked } : row)))} /> Top 5</label>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <AddPrescribing
                    medicines={data.medicines.filter((one) => !prescribing.some((row) => row.medicineId === one.id))}
                    onAdd={(one) => setPrescribing((all) => [...all, { medicineId: one.id, name: one.name, prescribing: true, top5: false }])}
                  />
                </div>
              )}
              {kind === "hospital" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Label text="Doctors / people met (commas)"><input className={FIELD} value={met} onChange={(event) => setMet(event.target.value)} /></Label>
                  <Label text="Pharmacy"><input className={FIELD} value={call.pharmacy ?? ""} onChange={(event) => setCall({ ...call, pharmacy: event.target.value })} /></Label>
                  <Label text="Purchase department"><input className={FIELD} value={call.purchasing ?? ""} onChange={(event) => setCall({ ...call, purchasing: event.target.value })} /></Label>
                  <Label text="Institutional business chance"><input className={FIELD} value={call.institutional ?? ""} onChange={(event) => setCall({ ...call, institutional: event.target.value })} /></Label>
                </div>
              )}
              {kind === "firm" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Label text="Chemist met (remark)"><input className={FIELD} value={call.chemist ?? ""} onChange={(event) => setCall({ ...call, chemist: event.target.value })} /></Label>
                  <Label text="Outstanding payment"><input className={FIELD} value={call.money ?? ""} onChange={(event) => setCall({ ...call, money: event.target.value })} /></Label>
                  <Label text="Market feedback"><input className={FIELD} value={call.market ?? ""} onChange={(event) => setCall({ ...call, market: event.target.value })} /></Label>
                </div>
              )}
              <Label text="Competitors (what you saw / heard)">
                <input className={FIELD} value={call.competitors ?? ""} onChange={(event) => setCall({ ...call, competitors: event.target.value })} />
              </Label>
            </>
          )}
          <Label text="Client's feedback">
            <textarea className={`${FIELD} h-20 py-2`} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          </Label>
        </div>
      </Step>

      <Step n={4} title="Business" done={Boolean(data.order && data.order.status === "booked")}>
        <div className="flex flex-col gap-4">
          {data.order && data.order.status === "booked" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <b>{data.order.code}</b> booked · {peso(data.order.amount)} · {data.order.lines.length} medicines
            </div>
          ) : (
            data.can.book && (
              <button type="button" onClick={() => setBooking(true)} className="inline-flex w-fit items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600">
                <ShoppingCart size={16} /> Add order
              </button>
            )
          )}
          {isMet && (
            <Label text="Visit nature *" error={action.at("nature")}>
              <Choices options={NATURES.map((key) => ({ key, label: NATURE_WORDS[key] }))} value={nature ? [nature] : []} onChange={(next) => setNature(next[0] ?? null)} />
            </Label>
          )}
          <Label text="What came of it? *" error={action.at("outcome")}>
            <Choices options={OUTCOMES.map((key) => ({ key, label: OUTCOME_WORDS[key] }))} value={outcome ? [outcome] : []} onChange={(next) => setOutcome(next[0] ?? null)} />
          </Label>
          {outcome === "opportunity" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Label text="Business expected (₱) *" error={action.at("chanceAmount")}><input className={FIELD} inputMode="decimal" value={chance} onChange={(event) => setChance(event.target.value)} /></Label>
              <Label text="Expected by" error={action.at("chanceOn")}><input type="date" className={FIELD} value={chanceOn} onChange={(event) => setChanceOn(event.target.value)} /></Label>
            </div>
          )}
          <Label text="Was the call productive? *" error={action.at("productive")}>
            <Choices options={PRODUCTIVES.map((key) => ({ key, label: PRODUCTIVE_WORDS[key] }))} value={productive ? [productive] : []} onChange={(next) => setProductive(next[0] ?? null)} />
            <span className="text-[11px] text-slate-500">A meeting without an order can be productive. "Not sure yet" goes to your team lead.</span>
          </Label>
        </div>
      </Step>

      <Step n={5} title="Close the call">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Label text={`Follow-up date${outcome === "follow_up" ? " *" : ""}`} error={action.at("followUp")}>
              <input type="date" className={FIELD} value={followOn} onChange={(event) => setFollowOn(event.target.value)} />
            </Label>
            <Label text="Follow-up for">
              <select className={FIELD} value={followKind} onChange={(event) => setFollowKind(event.target.value as FollowUpKind)}>
                {FOLLOW_UP_KINDS.map((key) => (
                  <option key={key} value={key}>{FOLLOW_UP_WORDS[key]}</option>
                ))}
              </select>
            </Label>
            <Label text="Next action">
              <input className={FIELD} value={followWhat} onChange={(event) => setFollowWhat(event.target.value)} placeholder="Bring the study" />
            </Label>
          </div>
          <Label text="Plan the next visit on (optional)" error={action.at("nextDay")}>
            <input type="date" className={FIELD} value={nextDay} onChange={(event) => setNextDay(event.target.value)} />
          </Label>
          <Label text="Remarks (post-call information)">
            <textarea className={`${FIELD} h-20 py-2`} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Label>
          <Photos data={data} />
          <Problem message={action.general(["meeting", "nature", "outcome", "productive", "chanceAmount", "chanceOn", "followUp", "nextDay"])} />
          <Button variant="primary" className="w-full" disabled={action.busy || !meeting || !outcome || !productive || (isMet && !nature)} onClick={close}>
            <Check size={16} /> {action.busy ? "Closing…" : "Close the call"}
          </Button>
          <p className="text-center text-[11px] text-slate-500">Your phone's place and the time are kept when you close.</p>
        </div>
      </Step>
      {booking && (
        <Dialog title="Add order" onClose={() => setBooking(false)} wide>
          <OrderBooking client={data.client.id} visit={v.id} onDone={() => setBooking(false)} />
        </Dialog>
      )}
    </>
  );
}

function AddPrescribing({ medicines, onAdd }: { medicines: VisitPage["medicines"]; onAdd: (one: VisitPage["medicines"][number]) => void }) {
  const [find, setFind] = useState("");
  const found = find.trim() ? medicines.filter((one) => one.name.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div className="mt-1">
      <input className={`${FIELD} h-8`} value={find} onChange={(event) => setFind(event.target.value)} placeholder="Add a drug this doctor prescribes" />
      {found.map((one) => (
        <button key={one.id} type="button" className="block w-full px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => { onAdd(one); setFind(""); }}>
          + {one.name}
        </button>
      ))}
    </div>
  );
}

function Photos({ data }: { data: VisitPage }) {
  const queries = useQueryClient();
  const action = useAction();
  const v = data.visit;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-600">Photos ({v.files.length})</div>
      <div className="flex flex-wrap items-center gap-2">
        {v.files.map((one) => (
          <a key={one.id} href={`/api/mr/visits/${v.id}/files/${one.id}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-sky-700 hover:underline">
            {one.name}
          </a>
        ))}
        {data.can.close && (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-sky-400">
            <Camera size={14} /> Add a photo
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const body = new FormData();
                body.set("file", file);
                void action.run(async () => {
                  await api(`/api/mr/visits/${v.id}/files`, { body });
                  await queries.invalidateQueries({ queryKey: ["mr", "visit", v.id] });
                });
              }}
            />
          </label>
        )}
      </div>
      <Problem message={action.problem?.message} />
    </div>
  );
}

/** A closed (or skipped, missed) visit as it was. */
function ClosedCall({ data }: { data: VisitPage }) {
  const v = data.visit;
  const spent = v.checkedInAt && v.doneAt ? Math.round((Date.parse(v.doneAt) - Date.parse(v.checkedInAt)) / 60_000) : null;
  return (
    <section className={`${CARD} grid gap-3 p-4 text-[13px] sm:grid-cols-2`}>
      <Fact label="Call objective">{v.objectives.length ? objectiveWords(v.objectives) : "—"}{v.objectiveNote ? ` · ${v.objectiveNote}` : ""}</Fact>
      <Fact label="Working with">{v.workingWith.map((one) => one.name).join(", ") || "—"}</Fact>
      <Fact label="Check-in time">
        {v.checkedInAt ? clockOf(v.checkedInAt) : "—"} {v.checkInPlace && <PlaceLink place={v.checkInPlace} />}
        {v.distanceM !== null && v.distanceM > NEAR && <span className="ml-1 text-rose-700">({distanceWords(v.distanceM)} away)</span>}
      </Fact>
      <Fact label="Check-out time">
        {v.doneAt ? clockOf(v.doneAt) : "—"} {v.closedPlace && <PlaceLink place={v.closedPlace} />}
        {spent !== null && <span className={`ml-1 ${spent < 3 ? "font-semibold text-rose-700" : "text-slate-500"}`}>({spent} min at the call)</span>}
      </Fact>
      {v.status === "done" && (
        <>
          <Fact label="Meeting">{v.meeting ? MEETING_WORDS[v.meeting] : "—"}{v.nature ? ` · ${NATURE_WORDS[v.nature]}` : ""}</Fact>
          <Fact label="Outcome">
            {v.outcome ? OUTCOME_WORDS[v.outcome] : "—"}
            {v.chanceAmount ? ` · ${peso(v.chanceAmount)}${v.chanceOn ? ` by ${dayWords(v.chanceOn)}` : ""}` : ""}
          </Fact>
          <Fact label="Productive">
            {v.productive ? PRODUCTIVE_WORDS[v.productive] : "—"}
            {v.judged && <span className="text-slate-500"> · judged by {v.judged.by}{v.judged.note ? `: ${v.judged.note}` : ""}</span>}
          </Fact>
          <Fact label="Client's feedback">{v.feedback || "—"}</Fact>
          <Fact label="Remarks">{v.notes || "—"}</Fact>
          {v.nextDay && <Fact label="Next visit">{dayWords(v.nextDay)}</Fact>}
        </>
      )}
      {v.skipReason && <Fact label={v.status === "missed" ? "Why missed" : "Why skipped"}>{v.skipReason}</Fact>}
      {v.products.length > 0 && (
        <div className="sm:col-span-2">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Products</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {v.products.map((one) => (
              <li key={one.medicineId} className="rounded-lg bg-sky-50 px-2 py-1 text-xs text-sky-900">
                <b>{one.name}</b>
                {one.promoted ? " · promoted" : ""}
                {one.samples ? ` · ${one.samples} samples` : ""}
                {one.reaction ? ` · ${REACTION_WORDS[one.reaction]}` : ""}
                {one.stock !== null && one.stock !== undefined ? ` · stock ${one.stock}` : ""}
                {one.sold ? ` · sold ${one.sold}` : ""}
                {one.demand ? ` · demand ${DEMAND_WORDS[one.demand]}` : ""}
                {one.competitor ? ` · vs ${one.competitor}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(v.call.met?.length || v.call.pharmacy || v.call.purchasing || v.call.institutional || v.call.chemist || v.call.money || v.call.market || v.call.competitors) && (
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
          {v.call.met?.length ? <Fact label="People met">{v.call.met.join(", ")}</Fact> : null}
          {v.call.pharmacy && <Fact label="Pharmacy">{v.call.pharmacy}</Fact>}
          {v.call.purchasing && <Fact label="Purchase department">{v.call.purchasing}</Fact>}
          {v.call.institutional && <Fact label="Institutional chance">{v.call.institutional}</Fact>}
          {v.call.chemist && <Fact label="Chemist met">{v.call.chemist}</Fact>}
          {v.call.money && <Fact label="Outstanding payment">{v.call.money}</Fact>}
          {v.call.market && <Fact label="Market feedback">{v.call.market}</Fact>}
          {v.call.competitors && <Fact label="Competitors">{v.call.competitors}</Fact>}
        </div>
      )}
      {data.order && (
        <Fact label="Order booked">
          <Link to={`/mr/orders?focus=${data.order.id}`} className="text-sky-700 hover:underline">
            {data.order.code} · {peso(data.order.amount)}
          </Link>
          {data.order.status === "cancelled" ? " (cancelled)" : ""}
        </Fact>
      )}
      {v.files.length > 0 && (
        <Fact label="Photos">
          {v.files.map((one) => (
            <a key={one.id} href={`/api/mr/visits/${v.id}/files/${one.id}`} target="_blank" rel="noreferrer" className="mr-2 text-sky-700 hover:underline">{one.name}</a>
          ))}
        </Fact>
      )}
    </section>
  );
}

/** The team lead's buttons on a closed call: judge a "not sure yet", reopen for a correction. */
function LeadTools({ data }: { data: VisitPage }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  const [reopening, setReopening] = useState(false);
  if (!data.can.judge && !data.can.reopen) return null;
  const v = data.visit;
  const refresh = () => queries.invalidateQueries({ queryKey: ["mr"] });
  return (
    <section className={`${CARD} flex flex-col gap-3 border-amber-200 bg-amber-50/40 p-4`}>
      <h2 className="text-sm font-bold text-slate-900">Team lead</h2>
      {data.can.judge && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-700">{v.person.name} wasn't sure this call was productive. Your call:</span>
          <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} placeholder="A word (optional)" />
          <div className="flex gap-2">
            <Button small variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/visits/${v.id}/judge`, { body: { productive: "yes", note: note || null } }); await refresh(); })}>Productive</Button>
            <Button small disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/visits/${v.id}/judge`, { body: { productive: "no", note: note || null } }); await refresh(); })}>Not productive</Button>
          </div>
        </div>
      )}
      {data.can.reopen &&
        (reopening ? (
          <div className="flex flex-col gap-2">
            <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What needs correcting? *" />
            <div className="flex gap-2">
              <Button small variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/visits/${v.id}/reopen`, { body: { note } }); setReopening(false); await refresh(); })}>Reopen the call</Button>
              <Button small variant="quiet" onClick={() => setReopening(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button small className="w-fit" onClick={() => setReopening(true)}>Reopen for a correction</Button>
        ))}
      <Problem message={action.problem?.message} />
    </section>
  );
}

/** The last five visits, follow-ups, orders and the visit's own changes. */
function History({ data }: { data: VisitPage }) {
  return (
    <div className="grid gap-4">
      <section className={`${CARD} p-4`}>
        <h2 className="mb-2 text-sm font-bold text-slate-900">Last five visits</h2>
        {data.history.length === 0 && <p className="text-sm text-slate-500">First visit.</p>}
        <ul className="flex flex-col gap-2">
          {data.history.map((one) => (
            <li key={one.id} className="rounded-xl border border-slate-200 p-3 text-[13px]">
              <div className="flex justify-between gap-2">
                <b>{dayWords(one.day)}</b>
                <span className="text-slate-500">{one.person}</span>
              </div>
              <div className="text-slate-600">
                Check-in {one.checkedInAt ? clockOf(one.checkedInAt) : "—"} · Check-out {one.doneAt ? clockOf(one.doneAt) : "—"}
              </div>
              <div>Call objective: {objectiveWords(one.objectives) || "—"}{one.objectiveNote ? ` · ${one.objectiveNote}` : ""}</div>
              {one.meeting && <div>{MEETING_WORDS[one.meeting]}{one.outcome ? ` · ${OUTCOME_WORDS[one.outcome]}` : ""}</div>}
              <div className="text-slate-600">Client's feedback: {one.feedback || "—"}</div>
              {one.status !== "done" && <div className="text-rose-700">{one.status === "missed" ? "Missed" : "Skipped"}</div>}
            </li>
          ))}
        </ul>
      </section>
      {data.followUps.length > 0 && (
        <section className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Open follow-ups</h2>
          <ul className="text-[13px]">
            {data.followUps.map((one) => (
              <li key={one.id}>{dayWords(one.dueOn)} · {FOLLOW_UP_WORDS[one.kind]}: {one.what} <span className="text-slate-500">({one.by})</span></li>
            ))}
          </ul>
        </section>
      )}
      {data.visit.changes.length > 0 && (
        <section className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">What happened to this visit</h2>
          <ul className="text-[13px] text-slate-700">
            {data.visit.changes.map((one) => (
              <li key={`${one.what}-${one.at}`}>
                {clockOf(one.at)} {dayWords(one.at.slice(0, 10))} · {one.by}: {one.what}
                {one.fromDay ? ` from ${dayWords(one.fromDay)}` : ""}
                {one.toDay ? ` to ${dayWords(one.toDay)}` : ""}
                {one.note ? ` · ${one.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SkipDialog({ visitId, onClose }: { visitId: number; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [reason, setReason] = useState<MissReason | null>(null);
  const [note, setNote] = useState("");
  return (
    <Dialog title="Skip this visit" onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Choices options={MISS_REASONS.map((key) => ({ key, label: MISS_WORDS[key] }))} value={reason ? [reason] : []} onChange={(next) => setReason(next[0] ?? null)} />
        <Label text={reason === "other" ? "Say why *" : "A word (optional)"} error={action.at("note")}>
          <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
        </Label>
        <Problem message={action.general(["note"])} />
        <Button variant="primary" disabled={!reason || action.busy} onClick={() => action.run(async () => { await api(`/api/mr/visits/${visitId}/skip`, { body: { reason, note: note || null } }); await queries.invalidateQueries({ queryKey: ["mr"] }); onClose(); })}>
          Skip
        </Button>
      </div>
    </Dialog>
  );
}

function MoveDialog({ visitId, day, onClose }: { visitId: number; day: string; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [to, setTo] = useState(day);
  const [why, setWhy] = useState("");
  return (
    <Dialog title="Reschedule this visit" onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Label text="New day" error={action.at("day")}><input type="date" className={FIELD} value={to} onChange={(event) => setTo(event.target.value)} /></Label>
        <Label text="Why (needed once your plan is approved)" error={action.at("why")}><input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} /></Label>
        <Problem message={action.general(["day", "why"])} />
        <Button variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/visits/${visitId}/move`, { body: { day: to, why: why || null } }); await queries.invalidateQueries({ queryKey: ["mr"] }); onClose(); })}>
          Reschedule
        </Button>
      </div>
    </Dialog>
  );
}
