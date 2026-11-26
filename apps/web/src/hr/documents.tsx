// HR's documents (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov): certificates of
// employment, clearances, memos and notices to explain, each numbered on its company's letterhead.
// HR's list and the New document form; the paper itself (outside the frame so it prints clean),
// where the person acknowledges or answers and each desk signs its part of a clearance; and each
// person's own "My documents".

import type { ClearanceDesk, HrDocKind, HrDocList, HrDocPage, HrDocRow, HrPeople, MyDocuments } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Printer, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, Dialog, Field, INPUT, manilaDay, PageHead, PageState, Panel, Pill, Problem, useAction } from "../ui";
import { LetterheadBlock, PaperFoot, PaperPage, SignerBoxes } from "./paper";

const TONE: Record<HrDocRow["status"], "good" | "warn" | "plain" | "bad"> = {
  issued: "plain",
  waiting: "warn",
  received: "good",
  answered: "good",
  cleared: "good",
  void: "bad",
};

/** Today in Manila, and a day some days on (the notice's answer-by day). */
const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const daysOn = (day: string, by: number) => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
};

function DocTable({ rows, showPerson = true }: { rows: HrDocRow[]; showPerson?: boolean }) {
  const navigate = useNavigate();
  if (!rows.length) return <div className="px-4 py-6 text-center text-sm text-slate-500">None yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="px-4 py-2">No.</th>
            <th className="px-3 py-2">Document</th>
            {showPerson && <th className="px-3 py-2">Person</th>}
            <th className="px-3 py-2">Issued</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((one) => (
            <tr key={one.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => navigate(`/hr/documents/${one.id}`)}>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold">
                <Link to={`/hr/documents/${one.id}`} onClick={(event) => event.stopPropagation()} className="hover:text-brand">
                  {one.code}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <div className="font-medium text-slate-900">{one.title}</div>
                {one.subject && <div className="text-xs text-slate-500">{one.subject}</div>}
              </td>
              {showPerson && (
                <td className="px-3 py-2.5">
                  <div>{one.name}</div>
                  <div className="text-xs text-slate-500">{[one.employeeCode, one.company.toUpperCase()].filter(Boolean).join(" · ")}</div>
                </td>
              )}
              <td className="px-3 py-2.5 text-xs text-slate-600">
                {manilaDay(one.issuedAt)}
                <div>{one.issuedBy}</div>
              </td>
              <td className="px-3 py-2.5">
                <Pill tone={TONE[one.status]}>{one.statusWords}</Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** HR's list of papers, with New document. */
export function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const person = Number(params.get("person")) || null;
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [making, setMaking] = useState(params.get("new") === "1");
  const query = useQuery({
    queryKey: ["hr", "documents", person, kind, q],
    queryFn: () =>
      api<HrDocList>(
        `/api/hr/documents?${new URLSearchParams({ ...(person ? { person: String(person) } : {}), ...(kind ? { kind } : {}), ...(q ? { q } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the documents" />;
  const forName = person ? data.rows.find((one) => one.personId === person)?.name : null;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="Documents"
        sub="Certificates of employment, clearances, memos and notices to explain: each numbered, on its company's letterhead, never deleted."
        actions={
          data.can.issue && (
            <Button variant="primary" onClick={() => setMaking(true)}>
              <FilePlus2 size={15} /> New document
            </Button>
          )
        }
      />
      <Panel
        title={forName ? `${forName}'s documents` : "Every document"}
        count={data.rows.length}
        actions={
          <>
            {person && (
              <Button small onClick={() => setParams({})}>
                Show everyone's
              </Button>
            )}
            <select className={`${INPUT} h-8 w-auto`} aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">Every kind</option>
              {data.kinds.map((one) => (
                <option key={one.key} value={one.key}>
                  {one.label}
                </option>
              ))}
            </select>
            <label className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                className={`${INPUT} h-8 w-56 pl-8`}
                placeholder="Name, number or subject"
                aria-label="Search documents"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </label>
          </>
        }
      >
        <DocTable rows={data.rows} />
      </Panel>
      {making && <NewDocument personId={person} kinds={data.kinds} onClose={() => setMaking(false)} />}
    </div>
  );
}

const SUBJECT_LABEL: Record<HrDocKind, string | null> = {
  coe: "What it is for (a bank loan, a visa…)",
  coe_pay: "What it is for (a bank loan, a visa…)",
  clearance: null,
  memo: "Subject",
  nte: "Subject (what happened)",
};

function NewDocument({
  personId,
  kinds,
  onClose,
}: {
  personId: number | null;
  kinds: HrDocList["kinds"];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const people = useQuery({ queryKey: ["hr", "people", "all"], queryFn: () => api<HrPeople>("/api/hr/people") });
  const today = manilaToday();
  const [value, setValue] = useState({
    kind: "coe" as HrDocKind,
    personId: personId ? String(personId) : "",
    subject: "",
    body: "",
    replyBy: daysOn(today, 5),
  });
  const set = (key: keyof typeof value) => (event: { target: { value: string } }) =>
    setValue({ ...value, [key]: event.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const made = await api<{ id: number }>("/api/hr/documents", {
        body: {
          kind: value.kind,
          personId: Number(value.personId) || 0,
          subject: value.subject || null,
          body: value.kind === "memo" || value.kind === "nte" ? value.body || null : null,
          replyBy: value.kind === "nte" ? value.replyBy : null,
        },
      });
      await queries.invalidateQueries({ queryKey: ["hr", "documents"] });
      navigate(`/hr/documents/${made.id}`);
    });
  }
  const subjectLabel = SUBJECT_LABEL[value.kind];
  return (
    <Dialog title="New document" sub="It gets its number when you issue it, and stays on record." onClose={onClose} busy={action.busy} wide>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Document" error={action.at("kind")}>
            {(props) => (
              <select {...props} className={INPUT} value={value.kind} onChange={set("kind")}>
                {kinds.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="For" error={action.at("personId")}>
            {(props) => (
              <select {...props} className={INPUT} value={value.personId} onChange={set("personId")}>
                <option value="">Pick the person…</option>
                {(people.data?.rows ?? []).map((one) => (
                  <option key={one.personId} value={one.personId}>
                    {one.name}
                    {one.employeeCode ? ` · ${one.employeeCode}` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {value.kind === "coe_pay" && (
          <p className="text-xs text-slate-500">It prints their monthly salary and allowance as on their record today.</p>
        )}
        {value.kind === "clearance" && (
          <p className="text-xs text-slate-500">
            Their immediate superior, Finance, Inventory and the Admin each sign their part (each is told); HR signs last.
          </p>
        )}
        {subjectLabel && (
          <Field label={subjectLabel} error={action.at("subject")}>
            {(props) => <input {...props} className={INPUT} maxLength={200} value={value.subject} onChange={set("subject")} />}
          </Field>
        )}
        {(value.kind === "memo" || value.kind === "nte") && (
          <Field label="What it says (a blank line starts a new paragraph)" error={action.at("body")}>
            {(props) => <textarea {...props} className={`${INPUT} min-h-40`} maxLength={8000} value={value.body} onChange={set("body")} />}
          </Field>
        )}
        {value.kind === "nte" && (
          <Field label="Answer in writing by" error={action.at("replyBy")}>
            {(props) => (
              <input {...props} type="date" className={`${INPUT} w-48`} min={today} max={daysOn(today, 30)} value={value.replyBy} onChange={set("replyBy")} />
            )}
          </Field>
        )}
        <Problem message={action.general(["kind", "personId", "subject", "body", "replyBy"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Issuing…" : "Issue"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** One paper, as it prints, with what this person may do on it above it. */
export function DocumentPaperPage() {
  const { id } = useParams();
  const queries = useQueryClient();
  const query = useQuery({ queryKey: ["hr", "document", id], queryFn: () => api<HrDocPage>(`/api/hr/documents/${id}`) });
  const [box, setBox] = useState<null | "void" | "reply" | ClearanceDesk>(null);
  const action = useAction();
  const paper = query.data;
  if (!paper)
    return (
      <div className="p-6">
        <PageState query={query} what="the document" />
      </div>
    );
  const refresh = async () => {
    await queries.invalidateQueries({ queryKey: ["hr", "document", id] });
    await queries.invalidateQueries({ queryKey: ["hr", "documents"] });
  };
  const acknowledge = () =>
    action.run(async () => {
      await api(`/api/hr/documents/${paper.id}/acknowledge`, { body: {} });
      await refresh();
    });
  return (
    <PaperPage
      actions={
        <>
          <Button onClick={() => window.history.back()}>Back</Button>
          {paper.can.acknowledge && (
            <Button variant="primary" disabled={action.busy} onClick={acknowledge}>
              I received it
            </Button>
          )}
          {paper.can.reply && <Button onClick={() => setBox("reply")}>Write my explanation</Button>}
          {paper.can.sign.map((desk) => (
            <Button key={desk} variant="primary" onClick={() => setBox(desk)}>
              Sign {paper.clearance?.find((one) => one.desk === desk)?.label ?? desk}'s part
            </Button>
          ))}
          {paper.can.void && (
            <Button variant="danger" onClick={() => setBox("void")}>
              Void
            </Button>
          )}
          <Button variant={paper.can.acknowledge || paper.can.sign.length ? "plain" : "primary"} onClick={() => window.print()}>
            <Printer size={15} /> Print or save as PDF
          </Button>
          <div className="basis-full">
            <Problem message={action.problem?.message} />
          </div>
        </>
      }
    >
      <LetterheadBlock
        letterhead={paper.letterhead}
        title={paper.title}
        code={paper.code}
        sub={paper.void ? "VOID" : `Issued ${paper.issuedOn} · ${paper.statusWords}`}
      />
      {paper.void && (
        <div className="rounded border-2 border-rose-600 px-3 py-2 text-center font-bold text-rose-700 uppercase">
          Void · {paper.void.reason} · {manilaDay(paper.void.at)}, {paper.void.by}
        </div>
      )}
      {paper.fields.length > 0 && (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 border-b border-slate-300 pb-3">
          {paper.fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="font-semibold text-slate-600">{field.label}</dt>
              <dd className={field.label === "Subject" ? "font-semibold" : ""}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {paper.kind === "clearance" && (
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
          {[
            ["Name", paper.person.name],
            ["Employee ID", paper.person.employeeCode],
            ["Position", paper.person.position],
            ["Department", paper.person.department],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold text-slate-600">{label}</dt>
              <dd className="border-b border-slate-300">{value || " "}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-3 leading-relaxed">
        {paper.paragraphs.map((text, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the paragraphs are fixed as issued.
          <p key={index} className="whitespace-pre-wrap">
            {text}
          </p>
        ))}
      </div>
      {paper.clearance && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {["Desk", "Signed by", "Date", "Still owed / note"].map((cell) => (
                <th key={cell} className="border border-slate-400 bg-slate-50 px-2 py-1 text-left">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paper.clearance.map((one) => (
              <tr key={one.desk}>
                <td className="border border-slate-400 px-2 py-1 font-semibold">{one.label}</td>
                <td className="border border-slate-400 px-2 py-1">{one.signer ?? "—"}</td>
                <td className="border border-slate-400 px-2 py-1">{one.at ? manilaDay(one.at) : "—"}</td>
                <td className="border border-slate-400 px-2 py-1 whitespace-pre-wrap">{one.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {paper.kind === "nte" && (
        <section className="rounded border border-slate-300 p-3">
          <div className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Employee's explanation</div>
          {paper.reply ? (
            <>
              <p className="mt-1 whitespace-pre-wrap">{paper.reply.text}</p>
              <div className="mt-1 text-xs text-slate-500">Written {manilaDay(paper.reply.at)}</div>
            </>
          ) : (
            <p className="mt-1 h-24 text-slate-400">Not answered yet.</p>
          )}
        </section>
      )}
      <SignerBoxes signers={paper.signers} />
      <PaperFoot letterhead={paper.letterhead} />
      {box === "void" && <VoidBox id={paper.id} onClose={() => setBox(null)} onDone={refresh} />}
      {box === "reply" && <ReplyBox id={paper.id} replyBy={paper.replyBy} onClose={() => setBox(null)} onDone={refresh} />}
      {box && box !== "void" && box !== "reply" && (
        <SignBox
          id={paper.id}
          desk={box}
          label={paper.clearance?.find((one) => one.desk === box)?.label ?? box}
          onClose={() => setBox(null)}
          onDone={refresh}
        />
      )}
    </PaperPage>
  );
}

function TextBox({
  title,
  sub,
  label,
  field,
  button,
  required,
  path,
  extra = {},
  onClose,
  onDone,
}: {
  title: string;
  sub?: string;
  label: string;
  field: string;
  button: string;
  required?: boolean;
  path: string;
  extra?: Record<string, unknown>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const action = useAction();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      await action.run(async () => {
        await api(path, { body: { ...extra, [field]: text.trim() || null } });
        await onDone();
      })
    )
      onClose();
  }
  return (
    <Dialog title={title} sub={sub} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={label} error={action.at(field)}>
          {(props) => (
            <textarea {...props} required={required} className={`${INPUT} min-h-28`} value={text} onChange={(event) => setText(event.target.value)} />
          )}
        </Field>
        <Problem message={action.general([field])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : button}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const VoidBox = ({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => Promise<void> }) => (
  <TextBox
    title="Void this document"
    sub="It stays on record, marked void, with your reason. Its number is never used again."
    label="Why it is void"
    field="reason"
    button="Void it"
    required
    path={`/api/hr/documents/${id}/void`}
    onClose={onClose}
    onDone={onDone}
  />
);

const ReplyBox = ({
  id,
  replyBy,
  onClose,
  onDone,
}: {
  id: number;
  replyBy: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) => (
  <TextBox
    title="My explanation"
    sub={`${replyBy ? `Due by ${replyBy}. ` : ""}It is sent once and kept on the notice; HR is told.`}
    label="What happened, in your words"
    field="reply"
    button="Send my explanation"
    required
    path={`/api/hr/documents/${id}/acknowledge`}
    onClose={onClose}
    onDone={onDone}
  />
);

const SignBox = ({
  id,
  desk,
  label,
  onClose,
  onDone,
}: {
  id: number;
  desk: ClearanceDesk;
  label: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) => (
  <TextBox
    title={`Sign ${label}'s part`}
    sub="Sign once they have nothing left to return or settle with your desk. Your signature goes on the clearance."
    label="Anything still owed, or a note (optional)"
    field="note"
    button="Sign"
    path={`/api/hr/documents/${id}/sign`}
    extra={{ desk }}
    onClose={onClose}
    onDone={onDone}
  />
);

/** Each person's own papers, and the clearances waiting for their desk. */
export function MyDocumentsPage() {
  const query = useQuery({ queryKey: ["hr", "documents", "mine"], queryFn: () => api<MyDocuments>("/api/hr/documents/mine") });
  const data = query.data;
  if (!data) return <PageState query={query} what="your documents" />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHead title="My documents" sub="The papers HR issued to you: certificates, memos, notices and your clearance." />
      {data.toSign.length > 0 && (
        <Panel title="Clearances waiting for your sign-off" count={data.toSign.length}>
          <DocTable rows={data.toSign} />
        </Panel>
      )}
      <Panel title="Issued to me" count={data.rows.length}>
        <DocTable rows={data.rows} showPerson={false} />
      </Panel>
    </div>
  );
}
