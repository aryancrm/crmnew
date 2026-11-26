// More than one account on one browser (26 Nov: "like Google: add an account with its own login, then
// switch"): adding keeps the account in use, switching needs no password, each account is only
// what its own login opened, a plain sign-in starts the browser afresh, and signing out signs
// every account out.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Me } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;

/** One browser: its cookies, kept as a browser keeps them (by name; a past expiry removes one). */
function browser() {
  const jar = new Map<string, string>();
  const take = (response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attrs] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const gone = attrs.some((one) => /max-age=0\b/i.test(one) || /expires=Thu, 01 Jan 1970/i.test(one));
      if (gone || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return {
    jar,
    get: async (path: string) => take(await app.request(path, { headers: { cookie: cookie() } })),
    post: async (path: string, body: unknown = {}) =>
      take(
        await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookie() },
          body: JSON.stringify(body),
        }),
      ),
  };
}
const signIn = (one: ReturnType<typeof browser>, name: string, add = false) =>
  one.post("/api/auth/login", { email: `${name}@2mg.test`, password: PASSWORD, ...(add ? { add: true } : {}) });
const meOf = async (one: ReturnType<typeof browser>) => ((await (await one.get("/api/me")).json()) as { me: Me }).me;
type Accounts = { accounts: { id: number; name: string; current: boolean }[]; max: number };
const accountsOf = async (one: ReturnType<typeof browser>) => (await (await one.get("/api/auth/accounts")).json()) as Accounts;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
});

describe("more than one account on one browser", () => {
  it("adds an account with its own login, keeps the one in use, and switches without a password", async () => {
    const one = browser();
    expect((await signIn(one, "ryan")).status).toBe(200);
    expect((await accountsOf(one)).accounts.map((a) => a.name)).toEqual(["Ryan"]);

    // A wrong password adds nothing and keeps Ryan in use.
    const wrong = await one.post("/api/auth/login", { email: "daniel@2mg.test", password: "not-it", add: true });
    expect(wrong.status).toBe(401);
    expect((await meOf(one)).name).toBe("Ryan");

    expect((await signIn(one, "daniel", true)).status).toBe(200);
    expect((await meOf(one)).name).toBe("Daniel");
    const both = await accountsOf(one);
    expect(both.accounts.map((a) => [a.name, a.current])).toEqual([["Daniel", true], ["Ryan", false]]);

    const ryan = both.accounts.find((a) => a.name === "Ryan");
    expect((await one.post("/api/auth/switch", { personId: ryan?.id })).status).toBe(200);
    expect((await meOf(one)).name).toBe("Ryan");
    expect((await accountsOf(one)).accounts.map((a) => [a.name, a.current])).toEqual([["Ryan", true], ["Daniel", false]]);

    // Adding the same account again keeps one of it.
    expect((await signIn(one, "daniel", true)).status).toBe(200);
    expect((await accountsOf(one)).accounts.map((a) => a.name).sort()).toEqual(["Daniel", "Ryan"]);

    // Only an account signed in here: no switching to someone who isn't.
    const [naresh] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'naresh@2mg.test'`);
    expect((await one.post("/api/auth/switch", { personId: naresh?.id })).status).toBe(404);
  });

  it("removes one account from the browser; removing the one in use opens the next", async () => {
    const one = browser();
    await signIn(one, "ryan");
    await signIn(one, "daniel", true);
    await signIn(one, "sarla", true);
    const ids = Object.fromEntries((await accountsOf(one)).accounts.map((a) => [a.name, a.id]));
    // Ryan, not in use: removed, and his session is over on the server.
    const ryanToken = (one.jar.get("sid_more") ?? "").split(",");
    expect((await one.post("/api/auth/accounts/remove", { personId: ids.Ryan })).status).toBe(200);
    expect((await accountsOf(one)).accounts.map((a) => a.name)).toEqual(["Sarla", "Daniel"]);
    for (const token of ryanToken) {
      const who = await app.request("/api/me", { headers: { cookie: `sid=${token}` } });
      if (who.status === 200) expect(((await who.json()) as { me: Me }).me.name).not.toBe("Ryan");
    }
    // Sarla, in use: signed out, and Daniel opens.
    const out = await one.post("/api/auth/accounts/remove", { personId: ids.Sarla });
    expect(((await out.json()) as { me: Me }).me.name).toBe("Daniel");
    expect((await meOf(one)).name).toBe("Daniel");
    expect((await accountsOf(one)).accounts.map((a) => a.name)).toEqual(["Daniel"]);
    // The last one: signed out, nobody left.
    await one.post("/api/auth/accounts/remove", { personId: ids.Daniel });
    expect((await one.get("/api/me")).status).toBe(401);
  });

  it("a plain sign-in starts the browser afresh; signing out signs every account out", async () => {
    const one = browser();
    await signIn(one, "ryan");
    await signIn(one, "sarla", true);
    expect((await accountsOf(one)).accounts).toHaveLength(2);
    // Someone signs in plainly (the sign-in page, not Add account): only them.
    await signIn(one, "fiona");
    expect((await accountsOf(one)).accounts.map((a) => a.name)).toEqual(["Fiona"]);

    await signIn(one, "ryan", true);
    const kept = { ...Object.fromEntries(one.jar) };
    expect((await one.post("/api/auth/logout")).status).toBe(200);
    expect((await one.get("/api/me")).status).toBe(401);
    // Their sessions are over on the server too, not only forgotten by this browser.
    for (const token of [kept.sid, ...(kept.sid_more ?? "").split(",")].filter(Boolean)) {
      const stolen = await app.request("/api/me", { headers: { cookie: `sid=${token}` } });
      expect(stolen.status).toBe(401);
    }
  });
});
