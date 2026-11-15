// "Send to customer": the order's newest step for the customer, as in the old CRM. Email goes from
// the company's mailbox (the same email that goes on its own at each step, sent again); WhatsApp,
// SMS and Viber open the app on this phone or computer with the words ready (Viber can't take the
// words, so they are copied first); Messenger answers on the case's chat; Copy for anything else.
// Each send is written on the order (and its case), so the next person sees it went.

import type { CustomerUpdate } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Copy,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ApiFailure, api } from "../api";
import { Button, timeLabel } from "../ui";

/** A Philippine mobile number as the digits the apps want (63 9XX XXX XXXX); null for a landline
 *  or nothing, since WhatsApp, Viber and SMS need a mobile. */
export function phDigits(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("639")) return digits;
  if (digits.length === 11 && digits.startsWith("09")) return `63${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `63${digits}`;
  return null;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SendToCustomer({
  orderId,
  small,
  up,
}: {
  orderId: number;
  small?: boolean;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const queries = useQueryClient();
  const query = useQuery({
    queryKey: ["orders", "update", orderId],
    queryFn: () => api<{ update: CustomerUpdate | null }>(`/api/orders/${orderId}/update`),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const update = query.data?.update ?? null;
  const digits = phDigits(update?.phone ?? null);
  const refresh = () =>
    queries.invalidateQueries({
      predicate: (item) => item.queryKey[0] === "orders" || item.queryKey[0] === "leads",
    });
  const note = (via: string) =>
    api(`/api/orders/${orderId}/update/sent`, { body: { via } })
      .then(refresh)
      .catch(() => undefined);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setSaid(null);
    try {
      setSaid({ tone: "good", text: await work() });
    } catch (error) {
      setSaid({
        tone: "bad",
        text: error instanceof ApiFailure ? error.message : "That didn't go. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const email = () =>
    run(async () => {
      await api(`/api/orders/${orderId}/update/email`, { body: {} });
      await refresh();
      return `Emailed to ${update?.email}.`;
    });
  const messenger = () =>
    run(async () => {
      await api(`/api/leads/${update?.leadId}/reply`, { body: { text: update?.short ?? "" } });
      await note("messenger");
      return "Sent on Messenger.";
    });
  const viber = () =>
    run(async () => {
      const copied = await copy(update?.short ?? "");
      window.location.href = `viber://chat?number=%2B${digits}`;
      void note("viber");
      return copied ? "Words copied: paste them in Viber." : "Viber opened: type the words there.";
    });
  const copyText = () =>
    run(async () => {
      if (!(await copy(update?.short ?? "")))
        throw new ApiFailure(
          0,
          "copy",
          "This browser wouldn't copy. Select the words above instead.",
        );
      void note("copy");
      return "Copied.";
    });

  return (
    <div ref={box} className="relative inline-block text-left">
      <Button
        small={small}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setSaid(null);
        }}
      >
        <Send className="size-4" aria-hidden="true" /> Send to customer
        <ChevronDown className="size-3.5 text-slate-400" aria-hidden="true" />
      </Button>
      {open && (
        <div
          role="menu"
          className={`absolute left-0 z-30 w-80 sm:right-0 sm:left-auto max-w-[calc(100vw-2rem)] rounded-xl bg-white p-1.5 text-[13px] shadow-pop ${up ? "bottom-full mb-1" : "mt-1"}`}
        >
          {query.isPending ? (
            <div className="px-3 py-3 text-ink-2">Getting the words ready…</div>
          ) : query.isError ? (
            <div className="px-3 py-3 text-rose-700">
              Couldn't read the update.{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => query.refetch()}
              >
                Retry
              </button>
            </div>
          ) : !update ? (
            <div className="px-3 py-3 text-ink-2">
              Nothing to send yet: the customer hears once the order is confirmed.
            </div>
          ) : (
            <>
              <div className="border-b border-line-soft px-3 pt-1.5 pb-2.5">
                <div className="font-semibold">{update.title}</div>
                <p className="mt-1 max-h-32 overflow-y-auto text-xs whitespace-pre-line text-ink-2 select-text">
                  {update.short}
                </p>
              </div>
              <Item
                icon={<Mail className="size-4" />}
                label="Email"
                sub={
                  update.email
                    ? update.emailedAt
                      ? `Emailed ${timeLabel(update.emailedAt)} · send again`
                      : update.email
                    : "No email on file"
                }
                disabled={busy || !update.email}
                onClick={email}
              />
              <Item
                icon={<MessageCircle className="size-4" />}
                label="WhatsApp"
                sub={digits ? `+${digits}` : "No mobile number on file"}
                href={
                  digits
                    ? `https://wa.me/${digits}?text=${encodeURIComponent(update.short)}`
                    : undefined
                }
                onClick={() => {
                  void note("whatsapp");
                  setOpen(false);
                }}
                disabled={!digits}
              />
              <Item
                icon={<Phone className="size-4" />}
                label="Viber"
                sub={digits ? "Copies the words, then opens Viber" : "No mobile number on file"}
                disabled={busy || !digits}
                onClick={viber}
              />
              <Item
                icon={<MessageSquare className="size-4" />}
                label="SMS"
                sub={digits ? `+${digits}` : "No mobile number on file"}
                href={
                  digits ? `sms:+${digits}?&body=${encodeURIComponent(update.short)}` : undefined
                }
                onClick={() => {
                  void note("sms");
                  setOpen(false);
                }}
                disabled={!digits}
              />
              {update.messenger && update.leadId && (
                <Item
                  icon={<Send className="size-4" />}
                  label="Messenger"
                  sub="On the case's chat"
                  disabled={busy}
                  onClick={messenger}
                />
              )}
              <Item
                icon={<Copy className="size-4" />}
                label="Copy text"
                disabled={busy}
                onClick={copyText}
              />
              {said && (
                <div
                  role="status"
                  className={`mx-1.5 mt-1 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs ${
                    said.tone === "good"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-rose-50 text-rose-800"
                  }`}
                >
                  {said.tone === "good" && (
                    <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  {said.text}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  icon,
  label,
  sub,
  href,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  href?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="text-slate-500" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        {sub && <span className="block truncate text-xs text-ink-2">{sub}</span>}
      </span>
    </>
  );
  const shape = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left";
  if (href && !disabled)
    return (
      <a
        role="menuitem"
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel="noreferrer"
        onClick={onClick}
        className={`${shape} hover:bg-hover`}
      >
        {inner}
      </a>
    );
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`${shape} hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`}
    >
      {inner}
    </button>
  );
}
