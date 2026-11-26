// One conversation, as the old CRM's chat: their messages grey on the left, ours Messenger-blue
// on the right, the desk's notes small in the middle, photos inline, "Seen" under the last of
// ours they read; a box at the bottom that answers them (or writes a note for the team).
// It reads itself again every few seconds while it is open.

import type { ChatLine, ChatThread } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Mail, MessageCircle, Send, StickyNote } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Problem, timeLabel, useAction } from "../ui";
import { EmptyState, NoInvoicesArt } from "../no-results";

export function useThread(leadId: number) {
  return useQuery({
    queryKey: ["leads", "thread", leadId],
    queryFn: () => api<ChatThread>(`/api/leads/${leadId}/thread`),
    refetchInterval: () => (document.visibilityState === "visible" ? 5_000 : false),
  });
}

/** The conversation and its reply box; `unread` marks it seen once it is on screen. */
export function ChatPanel({
  leadId,
  unread,
  canWork,
  className = "",
}: {
  leadId: number;
  unread?: boolean;
  canWork: boolean;
  className?: string;
}) {
  const thread = useThread(leadId);
  const queries = useQueryClient();
  const end = useRef<HTMLDivElement>(null);
  const count = thread.data?.lines.length ?? 0;
  const before = useRef(0);
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: "end" });
    // A new line can change the case too (a photo to file, a lost case open again): read it again.
    if (before.current && count !== before.current)
      void queries.invalidateQueries({ queryKey: ["leads", "case", leadId] });
    before.current = count;
  }, [count, leadId, queries]);
  useEffect(() => {
    if (!unread || !canWork) return;
    void api(`/api/leads/${leadId}/seen`, { body: {} }).then(() =>
      queries.invalidateQueries({ queryKey: ["inbox"] }),
    );
  }, [leadId, unread, canWork, queries]);

  if (!thread.data)
    return (
      <div className={`flex items-center justify-center p-6 text-sm text-slate-500 ${className}`}>
        {thread.isError ? "Couldn't load the conversation." : "Loading the conversation…"}
      </div>
    );
  const data = thread.data;
  const lastSeenOurs = data.readAt
    ? [...data.lines]
        .reverse()
        .find((line) => line.direction === "out" && line.at <= (data.readAt as string))?.id
    : undefined;
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
        {data.channel === "messenger" ? (
          <MessageCircle className="size-3.5 text-[#0084ff]" />
        ) : (
          <Mail className="size-3.5 text-slate-500" />
        )}
        <span className="truncate">
          {data.channel === "messenger"
            ? `Messenger · ${data.account}`
            : `${data.address} · to ${data.account}`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {data.lines.length === 0 && (
          <EmptyState art={<NoInvoicesArt size={72} />} title="No message yet.">
            Their messages and ours show here as they come in.
          </EmptyState>
        )}
        <ol className="flex flex-col gap-2">
          {data.lines.map((line) => (
            <Line key={line.id} line={line} seen={line.id === lastSeenOurs} />
          ))}
        </ol>
        <div ref={end} />
      </div>
      {canWork && <Composer data={data} />}
    </div>
  );
}

function Line({ line, seen }: { line: ChatLine; seen: boolean }) {
  if (line.kind === "note")
    return (
      <li className="mx-auto max-w-[85%] rounded-lg bg-amber-50 px-2.5 py-1.5 text-center text-[11px] text-amber-900">
        <span className="font-semibold">{line.by ?? "Note"}:</span> {line.text}
        <span className="ml-1 text-amber-700/70">· {timeLabel(line.at)}</span>
      </li>
    );
  const ours = line.direction === "out";
  return (
    <li className={`flex flex-col ${ours ? "items-end" : "items-start"}`}>
      <div
        className={`relative max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${ours ? "rounded-br-md bg-[#0084ff] text-white" : "rounded-bl-md bg-stone-100 text-ink"}`}
      >
        {line.subject && (
          <div
            className={`mb-1 text-[11px] font-semibold ${ours ? "text-white/80" : "text-slate-500"}`}
          >
            {line.subject}
          </div>
        )}
        {line.text && <div className="whitespace-pre-wrap break-words">{line.text}</div>}
        {line.files.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {line.files.map((file, index) =>
              file.missing ? (
                <span
                  key={`missing-${index}`}
                  className={`rounded-lg px-2 py-1 text-[11px] ${ours ? "bg-white/20" : "bg-white text-slate-500"}`}
                >
                  A file didn't come through
                </span>
              ) : file.mime?.startsWith("image/") ? (
                <a
                  key={file.fileId}
                  href={`/api/lead-files/${file.fileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg"
                >
                  <img
                    src={`/api/lead-files/${file.fileId}`}
                    alt={file.name ?? "Photo"}
                    loading="lazy"
                    className="h-28 w-auto max-w-[200px] object-cover"
                  />
                </a>
              ) : (
                <a
                  key={file.fileId}
                  href={`/api/lead-files/${file.fileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${ours ? "bg-white/20" : "bg-white"}`}
                >
                  <FileText className="size-3.5" /> {file.name ?? "File"}
                </a>
              ),
            )}
          </div>
        )}
        {line.reaction && (
          <span className="absolute -bottom-2.5 -left-1 rounded-full bg-white px-1 text-xs shadow">
            {line.reaction}
          </span>
        )}
      </div>
      <div className="mt-0.5 px-1 text-[10px] text-slate-400">
        {ours ? `${line.by ?? "From Facebook"} · ` : ""}
        {timeLabel(line.at)}
        {seen && " · Seen"}
      </div>
    </li>
  );
}

function Composer({ data }: { data: ChatThread }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState(!data.can.reply);
  const action = useAction();
  const queries = useQueryClient();
  const replying = !note && data.can.reply;
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (!body) return;
    const done = await action.run(async () => {
      await api(replying ? `/api/leads/${data.leadId}/reply` : `/api/leads/${data.leadId}/note`, {
        body: replying ? { text: body } : { message: body },
      });
    });
    if (done) {
      setText("");
      await queries.invalidateQueries({ queryKey: ["leads"] });
      await queries.invalidateQueries({ queryKey: ["inbox"] });
    }
  }
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };
  return (
    <form onSubmit={send} className="border-t border-slate-100 p-2.5">
      {!data.can.reply && data.can.why && (
        <div className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          {data.can.why}
        </div>
      )}
      <div className="mb-1.5 flex gap-1">
        <button
          type="button"
          disabled={!data.can.reply}
          onClick={() => setNote(false)}
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${replying ? "bg-[#0084ff]/10 text-[#0062bd]" : "text-slate-500 hover:bg-slate-100 disabled:opacity-40"}`}
        >
          {data.channel === "messenger" ? "Reply on Messenger" : "Reply by email"}
        </button>
        <button
          type="button"
          onClick={() => setNote(true)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${!replying ? "bg-amber-100 text-amber-900" : "text-slate-500 hover:bg-slate-100"}`}
        >
          <StickyNote className="size-3" /> Note for the team
        </button>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          aria-label={replying ? "Your reply" : "Your note"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keys}
          rows={2}
          placeholder={
            replying
              ? "Write a reply… (Enter sends, Shift+Enter for a new line)"
              : "Write a note only the team sees…"
          }
          className={`min-h-10 flex-1 resize-none rounded-xl border px-3 py-2 text-[13px] focus:outline-none focus:ring-2 ${replying ? "border-slate-200 focus:border-[#0084ff] focus:ring-[#0084ff]/15" : "border-amber-200 bg-amber-50/40 focus:ring-amber-200"}`}
        />
        <button
          type="submit"
          aria-label={replying ? "Send the reply" : "Add the note"}
          disabled={action.busy || !text.trim()}
          className={`grid size-10 shrink-0 place-items-center rounded-xl text-white disabled:opacity-40 ${replying ? "bg-[#0084ff] hover:bg-[#0070d8]" : "bg-amber-600 hover:bg-amber-700"}`}
        >
          <Send className="size-4" />
        </button>
      </div>
      <div className="mt-1.5">
        <Problem message={action.problem?.message} />
      </div>
    </form>
  );
}
