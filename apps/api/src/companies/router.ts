// Which company's app answers a request, when the server has several (COMPANIES=on).
//
// - Signing in: the domain after the @ in the login ID says the company ("hos1@getmeds.ph").
// - After that: this browser remembers its company in a cookie ("org", its Org ID), set when a
//   sign-in succeeds. So a login ID typed without its domain ("hos1") is the remembered company's,
//   else the first company's (2MG Inc.): its people sign in as they always did.
// - Webhooks (Meta, the websites, the tender robot) are the first company's, as before.
//
// The cookie only picks which company's database is asked: a session made in one company's
// database is unknown in every other, so changing the cookie opens nothing.

import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { asCompany } from "./context";
import type { CompanyList, Running } from "./registry";

export const ORG_COOKIE = "org";
const YEAR = 365 * 24 * 60 * 60;
const SIGN_IN = new Set(["/api/auth/login", "/api/auth/login/code"]);

/** The login ID a sign-in sends, without reading the body the company's app will read. */
async function typedLogin(request: Request): Promise<string> {
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

export function companyRouter(list: CompanyList, options: { secure: boolean; control?: { fetch: (request: Request, env?: unknown) => Response | Promise<Response> } }): Hono {
  const router = new Hono();
  // The control panel answers for itself, apart from every company.
  const control = options.control;
  if (control) router.all("/api/control/*", (c) => control.fetch(c.req.raw, c.env));

  router.all("*", async (c) => {
    const path = c.req.path;
    const remembered = getCookie(c, ORG_COOKIE);
    let chosen: Running | null = null;

    if (path.startsWith("/webhooks/")) chosen = list.home();
    else if (c.req.method === "POST" && path === "/api/auth/login") {
      const typed = (await typedLogin(c.req.raw)).trim().toLowerCase();
      const domain = typed.includes("@") ? typed.slice(typed.lastIndexOf("@") + 1) : "";
      if (domain) {
        chosen = list.byDomain(domain);
        if (!chosen && (await list.isBrokenDomain(domain)))
          return refuse(c, 503, "company_unreachable", "Your company's data can't be reached right now. Try again in a few minutes.");
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
    const response = await asCompany(one.ref, () => one.app.fetch(c.req.raw, c.env));
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
