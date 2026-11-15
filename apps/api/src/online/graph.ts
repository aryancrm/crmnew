// Meta's Graph API, the one way the server talks to Facebook: a page's name, a person's name,
// the page's conversations, sending a reply, subscribing the page to the webhook. Calls are
// spaced out a little and each has a deadline. On a developer's computer MESSENGER_SINK=1 answers
// them here instead (never online), and the tests put in their own.

import { randomUUID } from "node:crypto";

export type GraphAnswer<T> = { data: T | null; error: string | null; code: number | null };
export type Graph = {
  call<T>(
    method: "GET" | "POST",
    path: string,
    token: string,
    params?: Record<string, string>,
    json?: unknown,
  ): Promise<GraphAnswer<T>>;
  /** A file from Meta's short-lived link. */
  fetchFile(url: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
};

const MAX_FILE = 10 * 1024 * 1024;

function metaGraph(): Graph {
  let nextAt = 0;
  return {
    async call<T>(
      method: "GET" | "POST",
      path: string,
      token: string,
      params: Record<string, string> = {},
      json?: unknown,
    ): Promise<GraphAnswer<T>> {
      const slot = Math.max(nextAt, Date.now());
      nextAt = slot + 120;
      if (slot > Date.now()) await new Promise((resolve) => setTimeout(resolve, slot - Date.now()));
      const version = (process.env.MESSENGER_GRAPH_VERSION ?? "").trim();
      const url = new URL(
        `https://graph.facebook.com${/^v\d+(\.\d+)?$/.test(version) ? `/${version}` : ""}${path}`,
      );
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      try {
        const response = await fetch(url, {
          method,
          signal: AbortSignal.timeout(15_000),
          headers: {
            authorization: `Bearer ${token}`,
            ...(json === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        });
        const body = (await response.json().catch(() => ({}))) as T & {
          error?: { message?: string; code?: number; error_subcode?: number };
        };
        if (!response.ok || body.error) {
          const codes = body.error?.code
            ? ` [${[body.error.code, body.error.error_subcode].filter(Boolean).join("/")}]`
            : "";
          return {
            data: null,
            error: body.error?.message
              ? `${body.error.message}${codes}`
              : `Meta answered ${response.status}.`,
            code: body.error?.code ?? null,
          };
        }
        return { data: body, error: null, code: null };
      } catch (error) {
        const late = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        return {
          data: null,
          error: late ? "Meta didn't answer in time." : "Couldn't reach Meta.",
          code: null,
        };
      }
    },
    async fetchFile(url) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) return null;
        const size = Number(response.headers.get("content-length") ?? 0);
        if (size > MAX_FILE) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE) return null;
        return {
          bytes,
          mime:
            (response.headers.get("content-type") ?? "application/octet-stream")
              .split(";")[0]
              ?.trim() ?? "application/octet-stream",
        };
      } catch {
        return null;
      }
    },
  };
}

/** Names the stand-in answers for a Messenger id (a developer's test messages). */
export const sinkNames = new Map<string, string>();

/** A developer's stand-in: a token "test-<page id>" is that page; replies are taken and logged. */
export function sinkGraph(): Graph {
  return {
    async call<T>(
      method: "GET" | "POST",
      path: string,
      token: string,
      _params: Record<string, string> = {},
      json?: unknown,
    ) {
      const answer = (data: unknown): GraphAnswer<T> => ({
        data: data as T,
        error: null,
        code: null,
      });
      const named = method === "GET" ? sinkNames.get(path.slice(1)) : undefined;
      if (named)
        return answer({
          first_name: named.split(" ")[0],
          last_name: named.split(" ").slice(1).join(" "),
        });
      if (method === "GET" && path === "/me") {
        const id = token.startsWith("test-") ? token.slice(5) : "100000000000001";
        return answer({ id, name: `Test page ${id}` });
      }
      if (method === "POST" && path === "/me/messages") {
        console.log(
          `messenger (sink): to ${JSON.stringify((json as { recipient?: unknown })?.recipient)}: ${JSON.stringify((json as { message?: unknown })?.message)}`,
        );
        return answer({ message_id: `m_sink_${randomUUID()}` });
      }
      if (path.endsWith("/subscribed_apps")) return answer({ success: true });
      if (path.endsWith("/conversations")) return answer({ data: [] });
      return { data: null, error: "Not available on this computer (MESSENGER_SINK).", code: null };
    },
    async fetchFile() {
      // A test photo: a 1×1 PNG.
      return { bytes: Uint8Array.from(Buffer.from(SINK_PHOTO, "base64")), mime: "image/png" };
    },
  };
}

const SINK_PHOTO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

let current: Graph | null = null;

export function graph(): Graph {
  if (!current) {
    const sink = process.env.MESSENGER_SINK === "1" && process.env.NODE_ENV !== "production";
    current = sink ? sinkGraph() : metaGraph();
  }
  return current;
}

/** The tests' own Graph. */
export function useGraph(next: Graph | null): void {
  current = next;
}
