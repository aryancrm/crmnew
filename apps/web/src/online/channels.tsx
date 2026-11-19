// Channels (the Admin and the CEO): the Facebook pages and mailboxes the Online desk reads, how
// their reading goes, and connecting one. A token or a password goes to the server once and is
// never shown again.

import type { ChannelStatus, ChannelsData } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Globe, Mail, MessageCircle, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import {
  Button,
  Field,
  INPUT,
  PageHead,
  PageState,
  Pill,
  Problem,
  timeLabel,
  useAction,
} from "../ui";

const PRESETS: { key: string; label: string; imapHost: string; smtpHost: string }[] = [
  {
    key: "google",
    label: "Gmail / Google Workspace",
    imapHost: "imap.gmail.com",
    smtpHost: "smtp.gmail.com",
  },
  { key: "zoho", label: "Zoho Mail", imapHost: "imap.zoho.com", smtpHost: "smtp.zoho.com" },
  {
    key: "zoho_in",
    label: "Zoho Mail (India)",
    imapHost: "imap.zoho.in",
    smtpHost: "smtp.zoho.in",
  },
  { key: "other", label: "Another provider", imapHost: "", smtpHost: "" },
];

export function ChannelsPage() {
  const query = useQuery({
    queryKey: ["channels"],
    queryFn: () => api<ChannelsData>("/api/channels"),
    refetchInterval: 30_000,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the channels" />;
  const active = data.channels.filter((channel) => channel.active);
  const gone = data.channels.filter((channel) => !channel.active);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHead title="Channels" />
      {(data.sink.messenger || data.sink.mail) && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          This computer answers{" "}
          {[data.sink.messenger && "Meta", data.sink.mail && "the mail servers"]
            .filter(Boolean)
            .join(" and ")}{" "}
          itself: nothing reaches Facebook or a real mailbox.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {active.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-500">
            No page or mailbox connected yet.
          </div>
        )}
        {active.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} />
        ))}
        {data.unrouted.map((page) => (
          <div
            key={page.page}
            className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-900"
          >
            {page.count} message{page.count > 1 ? "s" : ""} came for Facebook page {page.page},
            which isn't connected: connect it and they come in.
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ConnectPage webhook={data.webhook} />
        <ConnectMailbox />
        <ConnectWebsite path={data.webhook.websitePath} />
      </div>

      {gone.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-xs font-semibold text-slate-500">Disconnected</h2>
          <ul className="flex flex-col gap-1 text-[13px] text-slate-600">
            {gone.map((channel) => (
              <li key={channel.id}>
                {channel.kind === "messenger" ? "Facebook page" : "Mailbox"} {channel.name} (
                {channel.key}) — connect it again to read it.
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChannelCard({ channel }: { channel: ChannelStatus }) {
  const action = useAction();
  const queries = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);
  async function run(
    path: string,
    body: unknown = {},
    done?: (answer: Record<string, unknown>) => string | null,
  ) {
    let answer: Record<string, unknown> = {};
    const ok = await action.run(async () => {
      answer = await api<Record<string, unknown>>(path, { body });
    });
    if (ok) setSaid(done ? done(answer) : null);
    await queries.invalidateQueries({ queryKey: ["channels"] });
    await queries.invalidateQueries({ queryKey: ["inbox"] });
  }
  const tone = channel.syncError || channel.failed ? "border-rose-200" : "border-slate-200";
  return (
    <section className={`rounded-2xl border bg-white p-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid size-10 place-items-center rounded-xl ${channel.kind === "messenger" ? "bg-[#0084ff]/10 text-[#0084ff]" : channel.kind === "website" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
          >
            {channel.kind === "messenger" ? (
              <MessageCircle className="size-5" />
            ) : channel.kind === "website" ? (
              <Globe className="size-5" />
            ) : (
              <Mail className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">{channel.name}</div>
            <div className="truncate text-xs text-slate-500">
              {channel.kind === "messenger"
                ? `Facebook page ${channel.key}`
                : channel.kind === "website"
                  ? `Website ${channel.key}`
                  : channel.key}{" "}
              · connected {timeLabel(channel.connectedAt)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            small
            disabled={action.busy}
            onClick={() =>
              run(`/api/channels/${channel.id}/pull`, {}, (answer) =>
                channel.kind === "website"
                  ? `${Number(answer.landed ?? 0)} update${Number(answer.landed) === 1 ? "" : "s"} sent to the website.`
                  : `Read now: ${Number(answer.landed ?? 0)} new.`,
              )
            }
          >
            <RefreshCw className="size-3.5" />{" "}
            {channel.kind === "website" ? "Send updates now" : "Read now"}
          </Button>
          {channel.kind === "website" && (
            <Button
              small
              disabled={action.busy}
              onClick={() =>
                run(
                  `/api/channels/${channel.id}/secret`,
                  {},
                  (answer) =>
                    `New secret (shown once): ${String(answer.secret)} — put it in the website's CRM_WEBHOOK_SECRET; the old one stopped working.`,
                )
              }
            >
              New secret
            </Button>
          )}
          {channel.failed > 0 && (
            <Button
              small
              disabled={action.busy}
              onClick={() => run(`/api/channels/${channel.id}/retry`, {}, () => "Tried again.")}
            >
              Retry failed ({channel.failed})
            </Button>
          )}
          <Button
            small
            variant="danger"
            disabled={action.busy}
            onClick={() => run(`/api/channels/${channel.id}/disconnect`)}
          >
            Disconnect
          </Button>
        </div>
      </div>
      {channel.website ? (
        <WebsiteDetails channel={channel} run={run} busy={action.busy} />
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
          {channel.syncError ? (
            <Pill tone="bad">Reading failed</Pill>
          ) : (
            <Pill tone="good">Reading</Pill>
          )}
          <span>Last read {channel.syncedAt ? timeLabel(channel.syncedAt) : "not yet"}</span>
          {channel.waiting > 0 && <span>· {channel.waiting} waiting to be worked</span>}
          {channel.held > 0 && (
            <span>
              · {channel.held} new sender{channel.held > 1 ? "s" : ""} waiting in the Inbox
            </span>
          )}
        </div>
      )}
      {channel.syncError && !channel.website && (
        <div className="mt-2 flex items-start gap-1.5 text-[12px] text-rose-700">
          <CircleAlert className="mt-px size-3.5 shrink-0" /> {channel.syncError}
        </div>
      )}
      {channel.kind === "email" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-slate-600">New senders:</span>
          {(
            [
              ["screen", "Wait for the desk"],
              ["all", "Open a case at once"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={action.busy || channel.intake === key}
              onClick={() => run(`/api/channels/${channel.id}/intake`, { intake: key })}
              className={`rounded-lg border px-2.5 py-1 font-semibold ${channel.intake === key ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {said && <div className="mt-2 text-[12px] font-medium text-emerald-700">{said}</div>}
      <div className="mt-2">
        <Problem message={action.problem?.message} />
      </div>
    </section>
  );
}

function ConnectPage({ webhook }: { webhook: ChannelsData["webhook"] }) {
  const [token, setToken] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    let answer: { name?: string; subscribeError?: string | null } = {};
    const ok = await action.run(async () => {
      answer = await api(`/api/channels/messenger`, { body: { token } });
    });
    if (ok) {
      setToken("");
      setSaid(
        answer.subscribeError
          ? `${answer.name} connected, but Meta didn't subscribe it to the webhook: ${answer.subscribeError}`
          : `${answer.name} connected.`,
      );
      await queries.invalidateQueries({ queryKey: ["channels"] });
    }
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <MessageCircle className="size-4 text-[#0084ff]" /> Connect a Facebook page
      </h2>
      <Field label="Page access token" error={action.at("token")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        )}
      </Field>
      <div className="text-[12px] text-slate-500">
        Meta's webhook calls {webhook.path} on this server.
        {!webhook.secretSet && (
          <span className="text-rose-700">
            {" "}
            MESSENGER_APP_SECRET isn't set, so the webhook refuses every call.
          </span>
        )}
        {!webhook.verifyTokenSet && (
          <span className="text-rose-700"> MESSENGER_VERIFY_TOKEN isn't set.</span>
        )}
      </div>
      <Problem message={action.general(["token"])} />
      {said && <div className="text-[12px] font-medium text-emerald-700">{said}</div>}
      <div>
        <Button type="submit" variant="primary" small disabled={action.busy || !token.trim()}>
          {action.busy ? "Checking…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

function ConnectMailbox() {
  const [preset, setPreset] = useState("google");
  const [form, setForm] = useState({
    address: "",
    name: "",
    user: "",
    password: "",
    imapHost: "imap.gmail.com",
    imapPort: "993",
    smtpHost: "smtp.gmail.com",
    smtpPort: "465",
    relayUrl: "",
  });
  const [said, setSaid] = useState<string | null>(null);
  const action = useAction();
  const queries = useQueryClient();
  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }));
  function pick(key: string) {
    setPreset(key);
    const found = PRESETS.find((item) => item.key === key);
    if (found && key !== "other")
      set({ imapHost: found.imapHost, smtpHost: found.smtpHost, imapPort: "993", smtpPort: "465" });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await api(`/api/channels/email`, {
        body: {
          address: form.address,
          name: form.name || null,
          user: form.user || null,
          password: form.password,
          imapHost: form.imapHost,
          imapPort: Number(form.imapPort),
          smtpHost: form.smtpHost,
          smtpPort: Number(form.smtpPort),
          relayUrl: form.relayUrl.trim() || null,
        },
      });
    });
    if (ok) {
      setSaid(`${form.address} connected. New emails are read from now on.`);
      set({ password: "" });
      await queries.invalidateQueries({ queryKey: ["channels"] });
    }
  }
  const fields = [
    "address",
    "name",
    "user",
    "password",
    "imapHost",
    "imapPort",
    "smtpHost",
    "smtpPort",
    "relayUrl",
  ];
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Mail className="size-4 text-slate-600" /> Connect a mailbox
      </h2>
      <Field label="Provider">
        {(field) => (
          <select
            {...field}
            className={INPUT}
            value={preset}
            onChange={(event) => pick(event.target.value)}
          >
            {PRESETS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Address" error={action.at("address")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              type="email"
              value={form.address}
              onChange={(event) => set({ address: event.target.value })}
            />
          )}
        </Field>
        <Field label="Name on our emails" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="2MG Inc."
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="App password" error={action.at("password")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            type="password"
            autoComplete="off"
            value={form.password}
            onChange={(event) => set({ password: event.target.value })}
          />
        )}
      </Field>
      {preset === "google" && (
        <div className="-mt-1 text-[12px] text-slate-500">
          Made at myaccount.google.com/apppasswords (2-Step Verification on). The account's normal
          password doesn't work.
        </div>
      )}
      <Field label="Send through the Google script (optional)" error={action.at("relayUrl")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            placeholder="https://script.google.com/macros/s/…/exec"
            value={form.relayUrl}
            onChange={(event) => set({ relayUrl: event.target.value })}
          />
        )}
      </Field>
      <div className="-mt-1 text-[12px] text-slate-500">
        The server's plan blocks mail ports: emails go out through this Google Apps Script web app,
        running as the mailbox's own account.
      </div>
      {preset === "other" && (
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label="IMAP server" error={action.at("imapHost")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={form.imapHost}
                onChange={(event) => set({ imapHost: event.target.value })}
              />
            )}
          </Field>
          <Field label="Port" error={action.at("imapPort")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                inputMode="numeric"
                value={form.imapPort}
                onChange={(event) => set({ imapPort: event.target.value })}
              />
            )}
          </Field>
          <Field label="SMTP server" error={action.at("smtpHost")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={form.smtpHost}
                onChange={(event) => set({ smtpHost: event.target.value })}
              />
            )}
          </Field>
          <Field label="Port" error={action.at("smtpPort")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                inputMode="numeric"
                value={form.smtpPort}
                onChange={(event) => set({ smtpPort: event.target.value })}
              />
            )}
          </Field>
          <Field label="Sign-in name (if not the address)" error={action.at("user")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={form.user}
                onChange={(event) => set({ user: event.target.value })}
              />
            )}
          </Field>
        </div>
      )}
      <Problem message={action.general(fields)} />
      {said && <div className="text-[12px] font-medium text-emerald-700">{said}</div>}
      <div>
        <Button
          type="submit"
          variant="primary"
          small
          disabled={action.busy || !form.address || !form.password}
        >
          {action.busy ? "Checking the mailbox…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

/** The website's stock link (the old CRM's catalogue push): its catalogue address, when the
 *  medicines last went, and what went wrong. */
function StockLink({
  channelId,
  catalog,
  run,
  busy,
}: {
  channelId: number;
  catalog: NonNullable<ChannelStatus["website"]>["catalog"];
  run: (
    path: string,
    body?: unknown,
    done?: (answer: Record<string, unknown>) => string | null,
  ) => Promise<void>;
  busy: boolean;
}) {
  const [url, setUrl] = useState(catalog.url ?? "");
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800">Stock link</span>
        {!catalog.url ? (
          <Pill>Off</Pill>
        ) : catalog.error ? (
          <Pill tone="bad">Not taken</Pill>
        ) : (
          <Pill tone="good">On</Pill>
        )}
        {catalog.sentAt && (
          <span>
            Medicines last sent {timeLabel(catalog.sentAt)}
            {catalog.sent ? ` (${catalog.sent})` : ""}
          </span>
        )}
      </div>
      {catalog.error && <span className="text-rose-700">{catalog.error}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="The website's catalogue address"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.2mginc.com/api/crm/catalog"
          className="h-8 min-w-64 flex-1 rounded-lg border border-slate-300 px-2.5 text-[12px]"
        />
        <Button
          small
          disabled={busy || url.trim() === (catalog.url ?? "")}
          onClick={() =>
            run(`/api/channels/${channelId}/catalog`, { url }, () =>
              url.trim() ? "Stock link on: what changes goes every ten minutes." : "Stock link off.",
            )
          }
        >
          Save
        </Button>
      </div>
      <span className="text-[11px] text-slate-500">
        Each medicine with its prices and the pieces on the shelf goes to the website, as the old
        CRM sent it; only what changed, every ten minutes, and with Send updates now.
      </span>
    </div>
  );
}

/** What a website did lately: its last call, orders the CRM left for a person, statuses it refused. */
function WebsiteDetails({
  channel,
  run,
  busy,
}: {
  channel: ChannelStatus;
  run: (
    path: string,
    body?: unknown,
    done?: (answer: Record<string, unknown>) => string | null,
  ) => Promise<void>;
  busy: boolean;
}) {
  const web = channel.website;
  if (!web) return null;
  return (
    <div className="mt-3 flex flex-col gap-2.5 text-[12px] text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        {web.lastCall?.outcome === "failed" ? (
          <Pill tone="bad">Last call failed</Pill>
        ) : web.lastCall ? (
          <Pill tone="good">Sending orders</Pill>
        ) : (
          <Pill>No call yet</Pill>
        )}
        {web.lastCall && (
          <span>
            Last call {timeLabel(web.lastCall.at)} · {web.lastCall.event}
          </span>
        )}
        <span>
          · {web.orders} order{web.orders === 1 ? "" : "s"}
        </span>
      </div>
      <StockLink channelId={channel.id} catalog={web.catalog} run={run} busy={busy} />
      {web.noCase.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="mb-1 font-semibold text-amber-900">Orders with no case</div>
          <ul className="flex flex-col gap-1.5">
            {web.noCase.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{row.ref}</span> · {row.status}
                  {row.placedAt ? ` · placed ${timeLabel(row.placedAt)}` : ""}
                  {row.note && <span className="block text-[11px] text-amber-800">{row.note}</span>}
                </span>
                <Button
                  small
                  disabled={busy}
                  onClick={() =>
                    run(
                      `/api/web-orders/${row.id}/open-case`,
                      {},
                      () => `${row.ref} has a case now.`,
                    )
                  }
                >
                  Open a case
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {web.pushFailing.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <div className="mb-1 font-semibold text-rose-900">Updates the website didn't take</div>
          <ul className="flex flex-col gap-1.5">
            {web.pushFailing.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{row.ref}</span> · {row.status}: {row.error}
                </span>
                <Button
                  small
                  disabled={busy}
                  onClick={() =>
                    run(`/api/web-orders/${row.id}/push`, {}, () => `${row.ref} sent again.`)
                  }
                >
                  Try again
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {web.refusals.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold text-rose-700">
            Calls the CRM couldn't take ({web.refusals.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {web.refusals.map((row, index) => (
              <li key={`${row.at}-${index}`}>
                {timeLabel(row.at)} · {row.event}
                {row.ref ? ` ${row.ref}` : ""}: {row.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A website (any number of them): its own secret, shown once, for its CRM settings. */
function ConnectWebsite({ path }: { path: string }) {
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  // The secret the website has now (from the old CRM), to keep it working unchanged.
  const [secret, setSecret] = useState("");
  const [made, setMade] = useState<{ key: string; secret: string; kept: boolean } | null>(null);
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    let answer: { key: string; secret: string; kept: boolean } = { key: "", secret: "", kept: false };
    const ok = await action.run(async () => {
      answer = await api(`/api/channels/website`, { body: { name, site, secret: secret.trim() || null } });
    });
    if (ok) {
      setMade(answer);
      setName("");
      setSite("");
      setSecret("");
      await queries.invalidateQueries({ queryKey: ["channels"] });
    }
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Globe className="size-4 text-emerald-700" /> Connect a website
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="2MG website"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Address (or the short name it sends)" error={action.at("site")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="https://www.2mginc.com"
              value={site}
              onChange={(event) => setSite(event.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <Field label="Its secret now (optional)" error={action.at("secret")}>
          {(field) => (
            <input
              {...field}
              type="password"
              autoComplete="off"
              className={INPUT}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          )}
        </Field>
        <p className="text-[11px] text-slate-500">
          A website moving over from the old CRM: paste its CRM_WEBHOOK_SECRET and it keeps working
          as it is. Left empty, a new one is made.
        </p>
      </div>
      <Problem message={action.general(["name", "site", "secret"])} />
      {made && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
          <div className="font-semibold">
            {made.kept
              ? `Connected as ${made.key}, with the secret it has: only its address changes.`
              : `Connected as ${made.key}. Put these in the website's settings; the secret isn't shown again.`}
          </div>
          <div className="mt-1 break-all font-mono">
            CRM_WEBHOOK_URL={window.location.origin}
            {path}
          </div>
          {!made.kept && <div className="break-all font-mono">CRM_WEBHOOK_SECRET={made.secret}</div>}
        </div>
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          small
          disabled={action.busy || !name.trim() || !site.trim()}
        >
          {action.busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}
