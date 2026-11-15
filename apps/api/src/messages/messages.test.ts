import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type {
  Me,
  MessageAddressBook,
  MessageThread,
  MessageThreads,
  NotificationList,
  OrgTree,
} from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const people: Record<string, number> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const write = async (who: string, body: unknown) => {
  const response = await send(who, "/api/messages", body);
  return {
    status: response.status,
    threadId: ((await response.json()) as { threadId?: number }).threadId,
  };
};
const unitId = async (name: string) =>
  (await read<OrgTree>("naresh", "/api/org")).units.find((unit) => unit.name === name)?.id;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "daniel", "ryan", "sarla", "vanessa", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    people[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

describe("messages", () => {
  it("one person to another keeps one conversation, read when opened", async () => {
    const first = await write("ryan", {
      to: { kind: "person", personId: people.daniel },
      body: "Sir, Olivarez wants 30 days.",
    });
    expect(first.status).toBe(201);
    const list = await read<MessageThreads>("daniel", "/api/messages");
    expect(list.unread).toBe(1);
    expect(list.threads[0]).toMatchObject({ kind: "direct", title: "Ryan", unread: 1 });
    const opened = await read<MessageThread>("daniel", `/api/messages/${first.threadId}`);
    expect(opened.messages.map((message) => message.body)).toEqual([
      "Sir, Olivarez wants 30 days.",
    ]);
    expect((await read<MessageThreads>("daniel", "/api/messages")).unread).toBe(0);
    expect(
      (
        await send("daniel", `/api/messages/${first.threadId}`, {
          body: "Ok, put it in the order.",
        })
      ).status,
    ).toBe(200);
    const again = await write("ryan", {
      to: { kind: "person", personId: people.daniel },
      body: "Done.",
    });
    expect(again.threadId).toBe(first.threadId);
    expect(
      (await read<MessageThread>("ryan", `/api/messages/${first.threadId}`)).messages,
    ).toHaveLength(3);
    // Nobody else reads it.
    expect((await get("sarla", `/api/messages/${first.threadId}`)).status).toBe(404);
  });

  it("a lead writes to their team and announces to it; the team can't answer an announcement", async () => {
    const ncr1 = await unitId("NCR 1");
    const book = await read<MessageAddressBook>("daniel", "/api/messages/people");
    expect(book.units.map((unit) => unit.name)).toContain("NCR 1");
    expect(book.can).toMatchObject({ everyone: false, announce: true });
    const team = await write("daniel", {
      to: { kind: "unit", unitId: ncr1 },
      body: "Meeting at 9 tomorrow.",
    });
    expect(team.status).toBe(201);
    const shown = await read<MessageThread>("ryan", `/api/messages/${team.threadId}`);
    expect(shown).toMatchObject({ kind: "group", title: "NCR 1", can: { reply: true } });
    expect(shown.people.map((person) => person.name).sort()).toEqual(["Daniel", "Ryan"]);
    const bell = await read<NotificationList>("ryan", "/api/notifications");
    expect(bell.rows.some((item) => item.title === "Daniel wrote to your team")).toBe(true);

    const news = await write("daniel", {
      to: { kind: "unit", unitId: ncr1 },
      announcement: true,
      title: "New price list",
      body: "From Monday the hospital prices change.",
    });
    expect(news.status).toBe(201);
    const before = await read<MessageThread>("daniel", `/api/messages/${news.threadId}`);
    expect(before.people.find((person) => person.name === "Ryan")?.read).toBe(false);
    const seen = await read<MessageThread>("ryan", `/api/messages/${news.threadId}`);
    expect(seen).toMatchObject({
      kind: "announcement",
      title: "New price list",
      can: { reply: false },
    });
    expect((await send("ryan", `/api/messages/${news.threadId}`, { body: "Noted" })).status).toBe(
      403,
    );
    const after = await read<MessageThread>("daniel", `/api/messages/${news.threadId}`);
    expect(after.people.find((person) => person.name === "Ryan")?.read).toBe(true);
  });

  it("keeps who may write to whom", async () => {
    const ncr1 = await unitId("NCR 1");
    const hospital = await unitId("Hospital Division");
    // A MedRep writes to their own team, but doesn't announce, nor write to everyone or another team.
    expect(
      (await write("ryan", { to: { kind: "unit", unitId: ncr1 }, body: "Who has Imatinib?" }))
        .status,
    ).toBe(201);
    expect(
      (await write("ryan", { to: { kind: "unit", unitId: ncr1 }, announcement: true, body: "x" }))
        .status,
    ).toBe(403);
    expect(
      (await write("ryan", { to: { kind: "unit", unitId: hospital }, body: "x" })).status,
    ).toBe(403);
    expect((await write("ryan", { to: { kind: "everyone" }, body: "x" })).status).toBe(403);
    // A head writes to the whole division under them.
    expect(
      (
        await write("vanessa", {
          to: { kind: "unit", unitId: hospital },
          announcement: true,
          body: "Good month.",
        })
      ).status,
    ).toBe(201);
    // A few people picked.
    const few = await write("sarla", {
      to: { kind: "people", personIds: [people.fiona, people.daniel] },
      title: "Olivarez",
      body: "Please check.",
    });
    expect(few.status).toBe(201);
    expect(
      (await read<MessageThread>("fiona", `/api/messages/${few.threadId}`)).people,
    ).toHaveLength(3);
  });

  it("the CEO announces to everyone", async () => {
    const all = await write("naresh", {
      to: { kind: "everyone" },
      announcement: true,
      title: "Holiday",
      body: "Office closed on the 30th.",
    });
    expect(all.status).toBe(201);
    const thread = await read<MessageThread>("naresh", `/api/messages/${all.threadId}`);
    expect(thread.to).toBe("Everyone");
    expect(thread.people.length).toBeGreaterThan(8);
    const bell = await read<NotificationList>("fiona", "/api/notifications");
    expect(bell.rows.some((item) => item.title === "Announcement from Naresh")).toBe(true);
  });
});
