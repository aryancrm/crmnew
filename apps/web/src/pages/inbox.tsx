// The Inbox, laid out like Messenger (the old CRM's /inbox): the chats down the left (the ones
// waiting for us first, then by their newest message), the conversation in the middle, and who
// they are on the right with their case one click away. On a phone, one pane at a time.
// New email senders wait at the top for "Make enquiry" or "Not a customer".

import type { ChatSummary, HeldSender, InboxFilter, InboxList, LeadCase } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { avatarTone, initials } from "../look";
import { ChatPanel } from "../online/chat";
import { ROAD_BADGE } from "../online/parts";
import { count, PageState, Pill, Problem, timeLabel, useAction } from "../ui";

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs", label: "Needs reply" },
  { key: "mine", label: "Mine" },
];

/** "5 min" / "3 h" / "Nov 12", as a chat list says when. */
function when(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));
}

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") ?? "all") as InboxFilter;
  const account = params.get("account") ?? "";
  const open = Number(params.get("chat")) || null;
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const [senders, setSenders] = useState(false);
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== q) set({ q: typed.trim() });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const search = new URLSearchParams({ filter, account, q }).toString();
  const list = useQuery({
    queryKey: ["inbox", "list", search],
    queryFn: () => api<InboxList>(`/api/inbox?${search}`),
    placeholderData: (previous) => previous,
    refetchInterval: () => (document.visibilityState === "visible" ? 8_000 : false),
  });
  const data = list.data;
  if (!data) return <PageState query={list} what="the Inbox" />;
  const chat = data.chats.find((item) => item.leadId === open) ?? null;

  return (
    <div className="mx-auto flex h-[calc(100dvh-7.5rem)] max-w-screen-2xl flex-col lg:h-[calc(100dvh-5.5rem)]">
      <div
        className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${open ? "hidden lg:flex" : ""}`}
      >
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Inbox</h1>
          <span className="rounded-full bg-stone-200/75 px-2.5 py-0.5 text-xs font-semibold text-stone-600 tabular-nums">
            {count(data.counts.needs)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data.held > 0 && data.can.reply && (
            <button
              type="button"
              onClick={() => setSenders(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
            >
              <Mail className="size-3.5" /> New email senders ({data.held})
            </button>
          )}
          {data.can.manageChannels && (
            <Link
              to="/channels"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Settings2 className="size-3.5" /> Channels
            </Link>
          )}
        </div>
      </div>

      {data.accounts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-600">
          No Facebook page or mailbox is connected yet.
          {data.can.manageChannels ? (
            <Link to="/channels" className="ml-1 font-semibold text-emerald-700 hover:underline">
              Connect one
            </Link>
          ) : (
            " Ask the Admin to connect one."
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)_17rem]">
          {/* The chats */}
          <aside
            className={`min-h-0 flex-col border-slate-100 lg:flex lg:border-r ${open ? "hidden" : "flex"}`}
          >
            <div className="border-b border-slate-100 p-2.5">
              <div className="flex gap-1">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => set({ filter: item.key === "all" ? "" : item.key })}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${data.filter === item.key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {item.label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] tabular-nums ${data.filter === item.key ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}
                    >
                      {data.counts[item.key]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex min-w-0 gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-slate-400" />
                  <input
                    type="search"
                    aria-label="Search chats"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="Search"
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-2 pl-8 text-sm placeholder:text-slate-400 focus:border-brand focus:bg-white focus:outline-none"
                  />
                </div>
                {data.accounts.length > 1 && (
                  <label className="relative inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-white text-xs text-slate-600">
                    <span className="sr-only">Page or mailbox</span>
                    <select
                      value={account}
                      onChange={(event) => set({ account: event.target.value })}
                      className="h-8 max-w-[8rem] appearance-none rounded-lg bg-transparent pr-6 pl-2 outline-none"
                    >
                      <option value="">All channels</option>
                      {data.accounts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-slate-400" />
                  </label>
                )}
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {data.chats.length === 0 && (
                <li className="p-6 text-center text-sm text-slate-500">
                  {q ? "No chat matches." : "No conversation here."}
                </li>
              )}
              {data.chats.map((item) => (
                <ChatRow
                  key={item.leadId}
                  chat={item}
                  picked={item.leadId === open}
                  onOpen={() => set({ chat: String(item.leadId) })}
                />
              ))}
            </ul>
          </aside>

          {/* The conversation */}
          <section className={`min-h-0 flex-col ${open ? "flex" : "hidden lg:flex"}`}>
            {open ? (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                  <button
                    type="button"
                    aria-label="Back to the chats"
                    onClick={() => set({ chat: "" })}
                    className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">
                      {chat?.name ?? "Conversation"}
                    </div>
                    {chat?.patient && (
                      <div className="truncate text-[11px] text-slate-500">for {chat.patient}</div>
                    )}
                  </div>
                  <Link
                    to={`/leads/${open}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Open case <ExternalLink className="size-3" />
                  </Link>
                </div>
                <ChatPanel
                  key={open}
                  leadId={open}
                  unread={chat?.unread}
                  canWork={data.can.reply}
                  className="flex-1"
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
                Pick a chat on the left.
              </div>
            )}
          </section>

          {/* Who they are */}
          <aside className="hidden min-h-0 overflow-y-auto border-l border-slate-100 xl:block">
            {open ? <CaseFacts leadId={open} /> : null}
          </aside>
        </div>
      )}

      {senders && <HeldSendersDialog onClose={() => setSenders(false)} />}
    </div>
  );
}

function ChatRow({
  chat,
  picked,
  onOpen,
}: {
  chat: ChatSummary;
  picked: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2.5 text-left transition-colors ${picked ? "bg-emerald-50" : "hover:bg-slate-50"}`}
      >
        <span
          className={`relative flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarTone(chat.name)}`}
        >
          {initials(chat.name)}
          <span
            className={`absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full ring-2 ring-white ${chat.channel === "messenger" ? "bg-[#0084ff]" : "bg-slate-600"}`}
          >
            {chat.channel === "messenger" ? (
              <MessageCircle className="size-2.5 text-white" />
            ) : (
              <Mail className="size-2.5 text-white" />
            )}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span
              className={`truncate text-[13px] ${chat.unread ? "font-bold text-ink" : "font-semibold text-slate-800"}`}
            >
              {chat.name}
            </span>
            <span className="shrink-0 text-[10px] text-slate-400">{when(chat.lastMessageAt)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`truncate text-[12px] ${chat.unread ? "font-semibold text-slate-900" : "text-slate-500"}`}
            >
              {chat.lastMessage ?? ""}
            </span>
            {chat.unread && (
              <span className="size-2 shrink-0 rounded-full bg-[#0084ff]" aria-label="Unread" />
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
            {chat.awaitingReply && (
              <span className="rounded-full bg-sky-600 px-1.5 py-px font-semibold text-white">
                Needs reply
              </span>
            )}
            {chat.lost && (
              <span className="rounded-full bg-rose-100 px-1.5 py-px font-semibold text-rose-700">
                Lost
              </span>
            )}
            <span className="truncate">{chat.owner ?? "Unassigned"}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** Who they are and where their case stands, beside the conversation. */
function CaseFacts({ leadId }: { leadId: number }) {
  const lead = useQuery({
    queryKey: ["leads", "case", leadId],
    queryFn: () => api<LeadCase>(`/api/leads/${leadId}`),
  });
  if (!lead.data)
    return (
      <div className="p-4 text-xs text-slate-500">
        {lead.isError ? "Couldn't load the case." : "Loading…"}
      </div>
    );
  const { lead: info } = lead.data;
  const road = ROAD_BADGE[info.road];
  return (
    <div className="flex flex-col gap-3 p-4 text-[13px]">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-10 items-center justify-center rounded-xl text-sm font-bold ${avatarTone(info.name)}`}
        >
          {initials(info.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{info.name}</div>
          <div className="text-[11px] text-slate-500">{info.code}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={info.state === "lost" ? "bad" : "brand"}>
          {info.state === "lost" ? "Lost" : lead.data.step.label}
        </Pill>
        <span
          className={`rounded-full border px-2 py-px text-xs font-semibold ${road.bg} ${road.text} ${road.border}`}
        >
          {road.label}
        </span>
      </div>
      <div className="rounded-xl bg-slate-50 px-3 py-2 font-medium text-slate-800">
        {lead.data.next}
      </div>
      <dl className="flex flex-col gap-1.5 text-[12px]">
        {info.patientName && info.patientName !== info.name && (
          <div>
            <dt className="text-slate-500">Patient</dt>
            <dd>{info.patientName}</dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Phone</dt>
          <dd>
            {info.phone ? (
              <a
                href={`tel:${info.phone}`}
                className="inline-flex items-center gap-1 hover:text-emerald-700"
              >
                <Phone className="size-3" /> {info.phone}
              </a>
            ) : (
              <span className="text-slate-400">Not given yet</span>
            )}
          </dd>
        </div>
        {info.email && (
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="truncate">{info.email}</dd>
          </div>
        )}
        {(info.city || info.address) && (
          <div>
            <dt className="text-slate-500">Address</dt>
            <dd>{[info.address, info.city].filter(Boolean).join(", ")}</dd>
          </div>
        )}
        {info.request && (
          <div>
            <dt className="text-slate-500">Asked for</dt>
            <dd>{info.request}</dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Works it</dt>
          <dd>{info.assignedName ?? "Unassigned"}</dd>
        </div>
      </dl>
      {lead.data.unsorted.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {lead.data.unsorted.length} photo{lead.data.unsorted.length > 1 ? "s" : ""} from the chat
          to file on the case.
        </div>
      )}
      <Link
        to={`/leads/${leadId}`}
        className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
      >
        Open the case <ExternalLink className="size-3.5" />
      </Link>
      <div className="text-[11px] text-slate-400">Came in {timeLabel(info.firstContactAt)}</div>
    </div>
  );
}

/** Email from people the desk hasn't heard from: an enquiry, or not a customer. */
function HeldSendersDialog({ onClose }: { onClose: () => void }) {
  const held = useQuery({
    queryKey: ["inbox", "held"],
    queryFn: () => api<{ senders: HeldSender[] }>("/api/email-held"),
  });
  const action = useAction();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  async function decide(sender: HeldSender, what: "let-in" | "ignore") {
    setBusy(sender.id);
    let leadId: number | null = null;
    const done = await action.run(async () => {
      const answer = await api<{ leadId?: number | null }>(`/api/email-held/${sender.id}/${what}`, {
        body: {},
      });
      leadId = answer.leadId ?? null;
    });
    setBusy(null);
    await queries.invalidateQueries({ queryKey: ["inbox"] });
    await queries.invalidateQueries({ queryKey: ["leads"] });
    if (done && what === "let-in" && leadId) {
      onClose();
      navigate(`/inbox?chat=${leadId}`);
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New email senders"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-pop">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">New email senders</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <Problem message={action.problem?.message} />
          {!held.data && <div className="p-4 text-sm text-slate-500">Loading…</div>}
          {held.data?.senders.length === 0 && (
            <div className="p-4 text-center text-sm text-slate-500">No one is waiting.</div>
          )}
          <ul className="flex flex-col gap-2.5">
            {held.data?.senders.map((sender) => (
              <li key={sender.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ink">
                      {sender.name ?? sender.address}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {sender.address} · to {sender.mailbox}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {timeLabel(sender.at)}
                  </span>
                </div>
                <div className="mt-1.5 text-[12px] font-semibold text-slate-800">
                  {sender.subject || "(no subject)"}
                </div>
                <div className="line-clamp-2 text-[12px] text-slate-600">{sender.snippet}</div>
                {sender.count > 1 && (
                  <div className="mt-1 text-[11px] text-slate-500">{sender.count} emails</div>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => decide(sender, "let-in")}
                    className="rounded-[10px] bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {busy === sender.id ? "Working…" : "Make enquiry"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => decide(sender, "ignore")}
                    className="rounded-[10px] border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Not a customer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
