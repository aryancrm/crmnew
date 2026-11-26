// Which company's app answers a request, when the server has several (COMPANIES=on).
//
// - Signing in: the domain after the @ in the login ID says the company ("hos1@getmeds.ph"). So
//   does a request to join (Sign up): the email it gives is on its company's domain.
// - After that: this browser remembers its company in a cookie ("org", its Org ID), set when a
//   sign-in succeeds. So a login ID typed without its domain ("hos1") is the remembered company's,
//   else the first company's (2MG Inc.): its people sign in as they always did.
// - Links a customer or a new person opens without signing in (a quotation, the welcome link)
//   carry their company's Org ID (`?org=`) when it isn't the first company.
// - Webhooks (Aryan, 26 Nov: "2MG and GetMeds each have their own Facebook pages, emails"):
//   Meta's call goes to the company that connected the page it is for (a page nobody connected
//   waits at the first company's, as before); a website calls its company's own address
//   (/webhooks/store/<Org ID>; the first company's websites keep /webhooks/store/2mg); the tender
//   robot is the first company's.
//
// The cookie only picks which company's database is asked: a session made in one company's
// database is unknown in every other, so changing the cookie opens nothing.

import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { rows } from "../db/index";
import { asCompany } from "./context";
import type { CompanyList, Running } from "./registry";

export const ORG_COOKIE = "org";
const YEAR = 365 * 24 * 60 * 60;
const SIGN_IN = new Set(["/api/auth/login", "/api/auth/login/code", "/api/auth/desk"]);
/** Asked by the email it sends: signing in, and asking to join. */
const BY_EMAIL = new Set(["/api/auth/login", "/api/auth/sign-up"]);
/** Opened from a link, without signing in: the link names its company. */
const LINKED = (path: string) => path.startsWith("/api/public/") || path.startsWith("/api/auth/welcome");
const ORG_ID = /^[1-9][0-9]{5}$/;
/** Meta's calls are small; anything bigger isn't read here (the first company's app answers it). */
const WEBHOOK_MAX = 1024 * 1024;

/** The email a sign-in or a request to join sends, without reading the body the app will read. */
async function typedEmail(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? "0") > 16 * 1024) return "";
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email : "";
  } catch {
    return "";
  }
}

const refuse = (c: Context, status: 403 | 503, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

/**
 * Which company connected each Facebook page, read from every company's own Channels and kept a
 * minute; read again at once (at most every five seconds) when a page isn't known yet.
 */
function pageOwners(list: CompanyList) {
  let known = new Map<string, string[]>();
  let readAt = 0;
  let reading: Promise<void> | null = null;
  const read = async () => {
    const next = new Map<string, string[]>();
    for (const one of list.all()) {
      const pages = await rows<{ key: string }>(
        one.db,
        sql`select key from channel_account where kind = 'messenger' and active`,
      ).catch(() => []);
      for (const page of pages) next.set(page.key, [...(next.get(page.key) ?? []), one.ref.orgId]);
    }
    known = next;
    readAt = Date.now();
  };
  return async (pages: string[]): Promise<Running[]> => {
    const age = Date.now() - readAt;
    if (age > 60_000 || (age > 5_000 && pages.some((page) => !known.has(page)))) {
      reading ??= read().finally(() => (reading = null));
      await reading;
    }
    const chosen = new Map<string, Running>();
    for (const page of pages) {
      const owners = (known.get(page) ?? []).map((orgId) => list.byOrgId(orgId)).filter((one): one is Running => !!one);
      // A page nobody connected waits at the first company's, where it always did.
      for (const one of owners.length ? owners : [list.home()]) chosen.set(one.ref.orgId, one);
    }
    return chosen.size ? [...chosen.values()] : [list.home()];
  };
}

/** The pages Meta's call is about (each entry's id), read from a copy of its body. */
function pagesIn(body: ArrayBuffer): string[] {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { entry?: { id?: unknown }[] };
    return [...new Set((parsed.entry ?? []).map((entry) => String(entry?.id ?? "")).filter(Boolean))];
  } catch {
    return [];
  }
}

export function companyRouter(list: CompanyList, options: { secure: boolean; control?: { fetch: (request: Request, env?: unknown) => Response | Promise<Response> } }): Hono {
  const router = new Hono();
  // The control panel answers for itself, apart from every company.
  const control = options.control;
  if (control) router.all("/api/control/*", (c) => control.fetch(c.req.raw, c.env));

  const ownersOf = pageOwners(list);
  const answer = (one: Running, request: Request, env: unknown) =>
    asCompany(one.ref, () => one.app.fetch(request, env));

  // Meta's webhook: the same call to each company that connected one of its pages (each checks
  // Meta's signature on the very same bytes and keeps only its own pages' messages).
  router.post("/webhooks/messenger", async (c) => {
    if (Number(c.req.header("content-length") ?? "0") > WEBHOOK_MAX) return answer(list.home(), c.req.raw, c.env);
    const body = await c.req.raw.arrayBuffer();
    if (body.byteLength > WEBHOOK_MAX) return c.json({ error: { code: "too_big", message: "Too big." } }, 413);
    const targets = await ownersOf(pagesIn(body));
    const answers: Response[] = [];
    for (const one of targets)
      answers.push(await answer(one, new Request(c.req.raw.url, { method: "POST", headers: c.req.raw.headers, body }), c.env));
    // A failure is passed on, so Meta sends it again (each company keeps an event once).
    return answers.find((one) => one.status >= 500) ?? answers.find((one) => one.status >= 400) ?? (answers[0] as Response);
  });

  router.all("*", async (c) => {
    const path = c.req.path;
    const remembered = getCookie(c, ORG_COOKIE);
    let chosen: Running | null = null;

    if (path.startsWith("/webhooks/store/")) {
      // A website's call: its company's Org ID in the address, else the first company's.
      chosen = list.byOrgId(path.split("/")[3]) ?? list.home();
    } else if (path.startsWith("/webhooks/")) chosen = list.home();
    else if (c.req.method === "POST" && BY_EMAIL.has(path)) {
      const typed = (await typedEmail(c.req.raw)).trim().toLowerCase();
      const domain = typed.includes("@") ? typed.slice(typed.lastIndexOf("@") + 1) : "";
      if (domain) {
        chosen = list.byDomain(domain);
        if (!chosen && (await list.isBrokenDomain(domain)))
          return refuse(c, 503, "company_unreachable", "Your company's data can't be reached right now. Try again in a few minutes.");
      }
    } else if (LINKED(path)) {
      const named = c.req.query("org");
      if (named && ORG_ID.test(named)) {
        if (list.brokenWhy(named))
          return refuse(c, 503, "company_unreachable", "This company's data can't be reached right now. Try again in a few minutes.");
        chosen = list.byOrgId(named);
      }
    }
    if (!chosen) {
      if (list.brokenWhy(remembered))
        return refuse(c, 503, "company_unreachable", "Your company's data can't be reached right now. Try again in a few minutes.");
      chosen = list.byOrgId(remembered) ?? list.home();
    }
    if (chosen.row.pausedAt && !path.startsWith("/webhooks/"))
      return refuse(c, 403, "company_paused", `${chosen.ref.name}'s account is paused. Ask Bishnoi One.`);

    const one = chosen;
    const response = await answer(one, c.req.raw, c.env);
    // A sign-in that worked (or waits for its code): this browser is this company's from now on.
    if (SIGN_IN.has(path) && response.status === 200 && remembered !== one.ref.orgId) {
      const out = new Response(response.body, response);
      out.headers.append(
        "set-cookie",
        `${ORG_COOKIE}=${one.ref.orgId}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`,
      );
      return out;
    }
    return response;
  });
  return router;
}
