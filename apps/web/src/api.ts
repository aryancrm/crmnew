// The one way the screens talk to the API.

import type { ApiError } from "@2mg/api/types";
import { toastFor } from "./toast";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Who is at the keyboard on a desk's common screen (Aryan, 21 Nov): their name and PIN go with
 *  every change; forgotten after two idle minutes, so the next person is asked again. */
export type DeskActor = { id: number; name: string; pin: string };
let actor: DeskActor | null = null;
let forget: ReturnType<typeof setTimeout> | undefined;
const watchers = new Set<(one: DeskActor | null) => void>();
export function setDeskActor(one: DeskActor | null) {
  actor = one;
  clearTimeout(forget);
  if (one) forget = setTimeout(() => setDeskActor(null), 2 * 60 * 1000);
  for (const watch of watchers) watch(one);
}
export function watchDeskActor(watch: (one: DeskActor | null) => void) {
  watchers.add(watch);
  return () => void watchers.delete(watch);
}
/** Asks who is doing this (the desk screen's PIN box); null when they cancel. */
type Ask = (why: { message: string | null; personId?: number }) => Promise<DeskActor | null>;
let ask: Ask | null = null;
export function setDeskAsk(one: Ask | null) {
  ask = one;
}

export async function api<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    /** On a desk's screen, the person who must be doing this (Start is pressed by oneself). */
    asPerson?: number;
  } = {},
): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  if (method === "GET" || !ask) return once<T>(path, options, method);
  let message: string | null = null;
  if (options.asPerson && actor && actor.id !== options.asPerson) setDeskActor(null);
  if (options.asPerson && !actor) {
    const who = await ask({ message: null, personId: options.asPerson });
    if (!who) throw new ApiFailure(0, "cancelled", "Cancelled.");
    setDeskActor(who);
  }
  for (let tries = 0; ; tries += 1) {
    try {
      return await once<T>(path, options, method);
    } catch (error) {
      const pin = error instanceof ApiFailure && (error.code === "desk_pin" || (actor && error.field === "pin"));
      if (!pin || tries >= 3) throw error;
      message = error.code === "desk_pin" ? null : error.message;
      setDeskActor(null);
      const who = await ask({ message, personId: options.asPerson });
      if (!who) throw new ApiFailure(0, "cancelled", "Cancelled.");
      setDeskActor(who);
    }
  }
}

async function once<T>(
  path: string,
  options: { body?: unknown },
  method: string,
): Promise<T> {
  let response: Response;
  const form = options.body instanceof FormData;
  const who: Record<string, string> =
    actor && method !== "GET" ? { "x-desk-person": String(actor.id), "x-desk-pin": actor.pin } : {};
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      // A FormData body (a file upload) sets its own content type.
      headers: {
        ...(options.body === undefined || form ? {} : { "content-type": "application/json" }),
        ...who,
      },
      body:
        options.body === undefined
          ? undefined
          : form
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiFailure(
      0,
      "offline",
      "Can't reach the server. Check your connection and try again.",
    );
  }
  const data = (await response.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!response.ok || !data) {
    const error = data?.error;
    throw new ApiFailure(
      response.status,
      error?.code ?? "failed",
      error?.message ?? `The server answered ${response.status}.`,
      error?.field,
      error?.fields,
    );
  }
  toastFor(method, path);
  return data;
}
