// Messages between the people of the company, instead of email between departments: the
// conversations on the left (announcements, teams, people), the one open on the right as chat
// bubbles with a box to answer, and New message: to one person, to a team, to a few people, or
// (the CEO, the Admin) to everyone, as a chat or as an announcement they only read. An
// announcement says who has seen it. One pane at a time on a phone.

import type {
  MessageAddressBook,
  MessageThread,
  MessageThreadRow,
  MessageThreads,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Eye, Megaphone, PenSquare, Search, Send, User, Users } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { Button, Dialog, PageState, Problem, useAction } from "../ui";
import { type UpdatesBox, UpdatesList, unreadIn, useUpdates } from "../updates";
import { EmptyState, NoInvoicesArt, NoResults } from "../no-results";

const FIELD =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none";

type Filter = "all" | "announcement" | "group" | "direct";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "announcement", label: "Announcements" },
  { key: "group", label: "Teams" },
  { key: "direct", label: "People" },
];

const KIND_ICON = {
  announcement: { icon: Megaphone, tone: "bg-amber-50 text-amber-700" },
  group: { icon: Users, tone: "bg-sky-50 text-sky-700" },
  direct: { icon: User, tone: "bg-emerald-50 text-emerald-700" },
} as const;

/** "9:41", "Yesterday", "Nov 12". */
function when(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const days = Math.floor(
    (today.setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return at.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** The three boxes of Messages: what needs you, the news, and the conversations. */
const BOXES = [
  { key: "important", label: "Needs you" },
  { key: "updates", label: "Updates" },
  { key: "chats", label: "Chats" },
] as const;

export function MessagesPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const box = (BOXES.find((one) => one.key === params.get("box"))?.key ?? "chats") as
    | UpdatesBox
    | "chats";
  const news = useUpdates();
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  const [writing, setWriting] = useState(false);
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["messages"],
    queryFn: () => api<MessageThreads>("/api/messages"),
    refetchInterval: () => (document.visibilityState === "visible" ? 20_000 : false),
  });
  if (!list.data) return <PageState query={list} what="your messages" />;
  const words = find.trim().toLowerCase();
  const threads = list.data.threads.filter(
    (thread) =>
      (filter === "all" || thread.kind === filter) &&
      (!words ||
        `${thread.title} ${thread.to} ${thread.last?.body ?? ""}`.toLowerCase().includes(words)),
  );

  return (
    <div className="-mx-4 -mt-6 -mb-24 flex h-[calc(100dvh-3.5rem)] md:-mx-8 md:-mb-10">
      <aside
        className={`flex w-full flex-col border-r border-slate-200 bg-white md:w-80 md:shrink-0 lg:w-96 ${id ? "hidden md:flex" : "flex"}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Messages</h1>
          <Button small variant="primary" onClick={() => setWriting(true)}>
            <PenSquare className="size-4" /> New
          </Button>
        </div>
        <div className="mx-4 mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {BOXES.map((one) => {
            const count =
              one.key === "chats"
                ? list.data.threads.reduce((sum, thread) => sum + thread.unread, 0)
                : unreadIn(news.data, one.key);
            return (
              <button
                key={one.key}
                type="button"
                onClick={() => {
                  if (id) navigate(one.key === "chats" ? "/messages" : `/messages?box=${one.key}`);
                  else setParams(one.key === "chats" ? {} : { box: one.key });
                }}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  box === one.key
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {one.label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] tabular-nums ${one.key === "important" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {box !== "chats" && <div className="h-2" />}
        {box !== "chats" && <UpdatesList box={box} />}
        {box === "chats" && (
          <>
            <label className="relative mx-4 mt-3 flex items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-slate-400" />
              <input
                value={find}
                onChange={(event) => setFind(event.target.value)}
                placeholder="Find a conversation"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none"
              />
            </label>
            <div className="flex gap-1 overflow-x-auto px-4 pt-3 pb-2 [scrollbar-width:none]">
              {FILTERS.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  onClick={() => setFilter(one.key)}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${filter === one.key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {one.label}
                </button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto pb-24 md:pb-4">
              {threads.length === 0 && (
                <li>
                  {list.data.threads.length ? (
                    <NoResults size={72} title="Nothing here.">Try another filter, or clear the search.</NoResults>
                  ) : (
                    <EmptyState art={<NoInvoicesArt size={72} />} title="No message yet.">
                      Write the first one with New.
                    </EmptyState>
                  )}
                </li>
              )}
              {threads.map((thread) => (
                <ThreadItem key={thread.id} thread={thread} open={String(thread.id) === id} />
              ))}
            </ul>
          </>
        )}
      </aside>
      <section className={`min-w-0 flex-1 flex-col bg-slate-50 ${id ? "flex" : "hidden md:flex"}`}>
        {id ? (
          <ThreadView key={id} id={id} />
        ) : (
          <div className="m-auto max-w-sm px-6 text-center text-sm text-slate-500">
            <Megaphone className="mx-auto mb-3 size-10 text-slate-300" />
            {box === "important"
              ? "What waits on you: an order sent back, a request to decide, a team announcement. Open one to act on it."
              : box === "updates"
                ? "The news of your orders and team: approved, shipped, delivered, answered."
                : "Talk to anyone in the company here instead of email: one person, your team, or an announcement for everyone."}
          </div>
        )}
      </section>
      {writing && (
        <NewMessage
          onClose={() => setWriting(false)}
          onSent={(threadId) => {
            setWriting(false);
            navigate(`/messages/${threadId}`);
          }}
        />
      )}
    </div>
  );
}

function ThreadItem({ thread, open }: { thread: MessageThreadRow; open: boolean }) {
  const kind = KIND_ICON[thread.kind];
  const Icon = kind.icon;
  return (
    <li>
      <Link
        to={`/messages/${thread.id}`}
        className={`flex items-start gap-3 border-l-2 px-4 py-3 ${open ? "border-emerald-600 bg-emerald-50/60" : "border-transparent hover:bg-slate-50"}`}
      >
        <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${kind.tone}`}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-sm ${thread.unread ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}
            >
              {thread.title}
            </span>
            {thread.last && (
              <span className="shrink-0 text-[11px] text-slate-400">{when(thread.last.at)}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-xs ${thread.unread ? "text-slate-800" : "text-slate-500"}`}
            >
              {thread.last
                ? `${thread.kind === "direct" ? "" : `${thread.last.by}: `}${thread.last.body}`
                : thread.to}
            </span>
            {thread.unread > 0 && (
              <span className="grid min-w-5 place-items-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white tabular-nums">
                {thread.unread}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

function ThreadView({ id }: { id: string }) {
  const queries = useQueryClient();
  const me = useMe().data;
  const action = useAction();
  const [text, setText] = useState("");
  const [seen, setSeen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const thread = useQuery({
    queryKey: ["messages", id],
    queryFn: () => api<MessageThread>(`/api/messages/${id}`),
    refetchInterval: () => (document.visibilityState === "visible" ? 10_000 : false),
  });
  const count = thread.data?.messages.length ?? 0;
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: "end" });
    // Opening it read it: the list's unread count follows.
    queries.invalidateQueries({ queryKey: ["messages"], exact: true });
  }, [count, queries]);
  if (!thread.data) return <PageState query={thread} what="the conversation" />;
  const data = thread.data;
  const kind = KIND_ICON[data.kind];
  const Icon = kind.icon;
  const others = data.people.filter((person) => person.id !== me?.id);
  const read = others.filter((person) => person.read).length;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!text.trim()) return;
    const sent = await action.run(() => api(`/api/messages/${id}`, { body: { body: text } }));
    if (sent) {
      setText("");
      await queries.invalidateQueries({ queryKey: ["messages"] });
    }
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link
          to="/messages"
          className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${kind.tone}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-slate-900">{data.title}</h2>
          <p className="truncate text-xs text-slate-500">
            {data.kind === "announcement"
              ? `Announcement by ${data.createdBy} · to ${data.to}`
              : data.kind === "direct"
                ? "Direct message"
                : `To ${data.to}`}
          </p>
        </div>
        {data.kind !== "direct" && (
          <button
            type="button"
            onClick={() => setSeen((now) => !now)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            <Eye className="size-4" /> Seen by {read} of {others.length}
          </button>
        )}
      </header>
      {seen && (
        <div className="max-h-48 overflow-y-auto border-b border-slate-200 bg-white px-4 py-2">
          <ul className="grid gap-1 text-xs sm:grid-cols-2">
            {data.people
              .filter((person) => person.id !== me?.id)
              .map((person) => (
                <li key={person.id} className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${person.read ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  <span className="truncate text-slate-700">{person.name}</span>
                  <span className="truncate text-slate-400">{person.title}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {data.messages.map((message, n) => {
            const before = data.messages[n - 1];
            const first = !before || before.byId !== message.byId;
            if (data.kind === "announcement")
              return (
                <article
                  key={message.id}
                  className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-amber-800">
                    <Megaphone className="size-3.5" /> {message.by} · {when(message.at)}
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-slate-800">{message.body}</p>
                </article>
              );
            return (
              <div
                key={message.id}
                className={`flex flex-col ${message.mine ? "items-end" : "items-start"}`}
              >
                {first && !message.mine && data.kind !== "direct" && (
                  <span className="mb-0.5 ml-2 text-[11px] font-semibold text-slate-500">
                    {message.by}
                  </span>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm sm:max-w-[70%] ${
                    message.mine
                      ? "rounded-br-md bg-emerald-600 text-white"
                      : "rounded-bl-md bg-white text-slate-800"
                  }`}
                  title={new Date(message.at).toLocaleString("en-PH")}
                >
                  {message.body}
                  <span
                    className={`mt-0.5 block text-right text-[10px] ${message.mine ? "text-emerald-100" : "text-slate-400"}`}
                  >
                    {when(message.at)}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
      </div>
      {data.can.reply ? (
        <form
          onSubmit={submit}
          className="border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder={
                data.kind === "announcement" ? "Add to your announcement…" : "Write a message…"
              }
              className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={action.busy || !text.trim()}
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          </div>
          <Problem message={action.problem?.message} />
        </form>
      ) : (
        <div className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
          An announcement is read here; to answer, write to {data.createdBy} with New.
        </div>
      )}
    </>
  );
}

type To = "person" | "unit" | "people" | "everyone";

function NewMessage({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (threadId: number) => void;
}) {
  const action = useAction();
  const book = useQuery({
    queryKey: ["messages", "people"],
    queryFn: () => api<MessageAddressBook>("/api/messages/people"),
  });
  const [to, setTo] = useState<To>("person");
  const [personId, setPersonId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [find, setFind] = useState("");
  const [announce, setAnnounce] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const data = book.data;
  const choices: { key: To; label: string }[] = [
    { key: "person", label: "One person" },
    ...(data?.units.length ? [{ key: "unit" as To, label: "A team" }] : []),
    { key: "people", label: "A few people" },
    ...(data?.can.everyone ? [{ key: "everyone" as To, label: "Everyone" }] : []),
  ];
  const mayAnnounce = (to === "unit" && data?.can.announce) || to === "everyone";
  const words = find.trim().toLowerCase();
  const people = (data?.people ?? []).filter(
    (person) =>
      !words ||
      `${person.name} ${person.title ?? ""} ${person.login ?? ""} ${person.team ?? ""}`
        .toLowerCase()
        .includes(words),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    let threadId = 0;
    const target =
      to === "person"
        ? { kind: "person", personId: Number(personId) }
        : to === "unit"
          ? { kind: "unit", unitId: Number(unitId) }
          : to === "people"
            ? { kind: "people", personIds: picked }
            : { kind: "everyone" };
    const done = await action.run(async () => {
      threadId = (
        await api<{ threadId: number }>("/api/messages", {
          body: {
            to: target,
            announcement: mayAnnounce ? announce : false,
            title: title || null,
            body,
          },
        })
      ).threadId;
    });
    if (done) onSent(threadId);
  }

  return (
    <Dialog
      title="New message"
      sub="Instead of email: it reaches them here and on their bell."
      onClose={onClose}
      busy={action.busy}
      wide
    >
      {!data ? (
        <PageState query={book} what="who you can write to" />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
            {choices.map((one) => (
              <button
                key={one.key}
                type="button"
                onClick={() => {
                  setTo(one.key);
                  setAnnounce(one.key === "everyone");
                }}
                className={`rounded-md px-3 py-1.5 ${to === one.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {one.label}
              </button>
            ))}
          </div>
          {to === "person" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">To *</span>
              <select
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                className={FIELD}
                required
              >
                <option value="">Pick someone…</option>
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.title ? ` — ${person.title}` : ""}
                    {person.team ? ` · ${person.team}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {to === "unit" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">Team *</span>
              <select
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
                className={FIELD}
                required
              >
                <option value="">Pick the team…</option>
                {data.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({unit.people} people, everyone under it too)
                  </option>
                ))}
              </select>
            </label>
          )}
          {to === "people" && (
            <div className="flex flex-col gap-2">
              <input
                value={find}
                onChange={(event) => setFind(event.target.value)}
                placeholder="Find people…"
                className={FIELD}
              />
              <ul className="max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                {people.map((person) => (
                  <li key={person.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={picked.includes(person.id)}
                        onChange={(event) =>
                          setPicked((now) =>
                            event.target.checked
                              ? [...now, person.id]
                              : now.filter((one) => one !== person.id),
                          )
                        }
                        className="size-4 accent-emerald-600"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                        {person.name}
                      </span>
                      <span className="truncate text-xs text-slate-400">
                        {[person.title, person.team].filter(Boolean).join(" · ")}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <span className="text-xs text-slate-500">{picked.length} picked</span>
            </div>
          )}
          {to === "everyone" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              Everyone in the company gets it, on Messages and on their bell.
            </p>
          )}
          {mayAnnounce && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={announce}
                onChange={(event) => setAnnounce(event.target.checked)}
                className="mt-0.5 size-4 accent-emerald-600"
              />
              <span>
                <b>Announcement</b>: they read it and you see who has; they don't reply.
              </span>
            </label>
          )}
          {(to === "people" || announce) && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">Subject</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={FIELD}
                placeholder="New price list from Monday"
              />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Message *</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              required
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
            />
          </label>
          <Problem message={action.problem?.message} />
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button onClick={onClose} disabled={action.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={action.busy}>
              <Send className="size-4" />{" "}
              {action.busy ? "Sending…" : announce ? "Announce" : "Send"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
