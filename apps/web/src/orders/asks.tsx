// Asking up (Aryan, 17 Nov): Management asks the MedRep's Team Lead, or the Business Mentor (the
// head of the division), for a yes on the order; that person answers Yes or No with a word right
// here; it comes back to Management, which decides. Shown on the order to whoever reads it.

import type { OrderAsk, OrderDetail } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button, Dialog, Field, INPUT, Problem, timeLabel, useAction } from "../ui";

function AskLine({ ask }: { ask: OrderAsk }) {
  return (
    <li className="flex flex-col gap-0.5 text-[13px]">
      <span>
        <b>{ask.askedBy}</b> asked <b>{ask.askedTo}</b> ({ask.asWhoLabel}): {ask.question}
        <span className="text-[11px] text-slate-500"> · {timeLabel(ask.askedAt)}</span>
      </span>
      {ask.answer === null ? (
        <span className="text-[12px] text-amber-700">Waiting for {ask.askedTo}'s answer</span>
      ) : (
        <span className={`text-[12px] font-semibold ${ask.answer ? "text-good" : "text-bad"}`}>
          {ask.askedTo}: {ask.answer ? "Yes" : "No"}
          {ask.answerNote ? ` — ${ask.answerNote}` : ""}
        </span>
      )}
    </li>
  );
}

/** The order's questions up the line: Management asks; the one asked answers. */
export function AskUpBox({ data }: { data: OrderDetail }) {
  const [asking, setAsking] = useState<"team_lead" | "business_mentor" | null>(null);
  const [answering, setAnswering] = useState<{ ask: OrderAsk; yes: boolean } | null>(null);
  const mine = data.asks.filter((ask) => ask.mine);
  const up = data.askUp;
  if (!data.asks.length && !(up && (up.teamLead || up.mentor))) return null;
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/50 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircleQuestion className="size-4 text-violet-700" aria-hidden="true" />
        <span className="text-[13px] font-semibold text-slate-900">Ask up the line</span>
        {up?.teamLead && (
          <Button small onClick={() => setAsking("team_lead")}>
            Ask {up.teamLead.name} (Team Lead)
          </Button>
        )}
        {up?.mentor && (
          <Button small onClick={() => setAsking("business_mentor")}>
            Ask {up.mentor.name} (Business Mentor)
          </Button>
        )}
      </div>
      {data.asks.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {data.asks.map((ask) => (
            <AskLine key={ask.id} ask={ask} />
          ))}
        </ul>
      )}
      {mine.map((ask) => (
        <div key={ask.id} className="mt-2 flex flex-wrap items-center gap-2 border-t border-violet-200 pt-2">
          <span className="text-[13px] font-semibold text-violet-900">Your answer:</span>
          <Button small variant="primary" onClick={() => setAnswering({ ask, yes: true })}>
            Yes
          </Button>
          <Button small variant="danger" onClick={() => setAnswering({ ask, yes: false })}>
            No
          </Button>
        </div>
      ))}
      {asking && up && (
        <AskDialog
          orderId={data.order.id}
          to={asking}
          name={(asking === "team_lead" ? up.teamLead?.name : up.mentor?.name) ?? ""}
          onClose={() => setAsking(null)}
        />
      )}
      {answering && (
        <AnswerDialog ask={answering.ask} yes={answering.yes} onClose={() => setAnswering(null)} />
      )}
    </section>
  );
}

function AskDialog({
  orderId,
  to,
  name,
  onClose,
}: {
  orderId: number;
  to: "team_lead" | "business_mentor";
  name: string;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const action = useAction();
  const queries = useQueryClient();
  async function save() {
    if (
      await action.run(async () => {
        await api(`/api/orders/${orderId}/ask`, { body: { to, question } });
      })
    ) {
      await queries.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`Ask ${name}`}
      sub={`${to === "team_lead" ? "The MedRep's Team Lead" : "The division's Business Mentor"} answers Yes or No on their screen.`}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-4">
        <Field label="What are you asking?" error={action.at("question")}>
          {(field) => (
            <textarea
              {...field}
              className={`${INPUT} min-h-24`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="e.g. 12% below the list for this hospital: yes?"
              autoFocus
            />
          )}
        </Field>
        <Problem message={action.general(["question"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Close
          </Button>
          <Button variant="primary" onClick={save} disabled={action.busy || !question.trim()}>
            {action.busy ? "Sending…" : "Ask"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AnswerDialog({ ask, yes, onClose }: { ask: OrderAsk; yes: boolean; onClose: () => void }) {
  const [note, setNote] = useState("");
  const action = useAction();
  const queries = useQueryClient();
  async function save() {
    if (
      await action.run(async () => {
        await api(`/api/order-asks/${ask.id}/answer`, { body: { yes, note: note.trim() || null } });
      })
    ) {
      await queries.invalidateQueries();
      onClose();
    }
  }
  return (
    <Dialog
      title={`${yes ? "Yes" : "No"} to ${ask.askedBy}`}
      sub={ask.question}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-4">
        <Field label={yes ? "A word (optional)" : "Why not"} error={action.at("note")}>
          {(field) => (
            <textarea
              {...field}
              className={`${INPUT} min-h-20`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Problem message={action.general(["note"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Close
          </Button>
          <Button variant={yes ? "primary" : "danger"} onClick={save} disabled={action.busy}>
            {yes ? "Answer Yes" : "Answer No"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
