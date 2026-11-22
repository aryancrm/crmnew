// A person's own profile and their account's security. The password-checking routes sit under
// /api/auth/, where the known-browser cookie goes (auth/guard.ts).

import { eq } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { deviceCookie, type passwordGuard } from "../auth/guard";
import { endOtherSessions } from "../auth/sessions";
import { confirmSetup, renewRecovery, startSetup, turnOff, twoStepOn, useCode } from "../auth/two-step";
import type { Database } from "../db/index";
import { person } from "../db/schema";
import { allow, type Env, idParam, readBody, Refusal } from "../http";
import type { ApiError } from "../types";
import { accountEvent } from "./events";
import { ownOnly, PHOTO_MAX_BYTES, profileOf, readPhoto, removePhoto, saveContact, savePersonal, savePhoto } from "./profile";

const optional = (max: number) => z.string().max(max).nullable();
const password = z.string().min(1, "Enter your password.").max(200);
const code = z.string().trim().min(6, "Enter the code.").max(24);

export function accountRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
  passwordRight: ReturnType<typeof passwordGuard>,
) {
  /** Their own password, counted and locked as at the sign-in. */
  async function checkPassword(c: Context<Env>, typed: string) {
    const me = c.get("me");
    const [row] = await db.select().from(person).where(eq(person.id, me.id)).limit(1);
    if (!row) throw new Refusal(401, "signed_out", "Sign in first.");
    if (!(await passwordRight(row, typed, getCookie(c, deviceCookie(row.id)))))
      throw new Refusal(400, "invalid", "That isn't your password.", "password");
  }

  app.get("/api/me/profile", signedIn, async (c) => {
    const profile = await profileOf(db, c.get("me"), c.get("token"));
    c.header("cache-control", "no-store");
    return c.json(profile);
  });

  app.post("/api/me/profile/personal", signedIn, async (c) => {
    const input = await readBody(
      c,
      z.object({
        firstName: z.string().max(200),
        middleName: optional(200),
        lastName: z.string().max(200),
        suffix: optional(10),
        birthDate: z.string().max(10),
      }),
    );
    await savePersonal(db, c.get("me"), input);
    return c.json({ ok: true });
  });

  app.post("/api/me/profile/contact", signedIn, async (c) => {
    const input = await readBody(
      c,
      z.object({
        mobile: optional(30),
        personalEmail: optional(200),
        address: optional(400),
        emergencyName: optional(120),
        emergencyPhone: optional(30),
        emergencyRelation: optional(60),
      }),
    );
    await saveContact(db, c.get("me"), input);
    return c.json({ ok: true });
  });

  const photoLimit = bodyLimit({
    maxSize: PHOTO_MAX_BYTES,
    onError: (c) =>
      c.json({ error: { code: "too_large", message: "Choose a photo under 8 MB.", field: "photo" } } satisfies ApiError, 413),
  });
  app.post("/api/me/photo", signedIn, photoLimit, async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File)) throw new Refusal(400, "invalid", "Choose a photo.", "photo");
    return c.json({ id: await savePhoto(db, c.get("me"), new Uint8Array(await file.arrayBuffer())) });
  });

  app.post("/api/me/photo/remove", signedIn, async (c) => {
    await removePhoto(db, c.get("me"));
    return c.json({ ok: true });
  });

  app.get("/api/people/:id/photo/:photoId", signedIn, async (c) => {
    const photo = await readPhoto(db, idParam(c), idParam(c, "photoId"));
    return c.body(photo.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": photo.mime,
      "x-content-type-options": "nosniff",
      // The address changes with the picture.
      "cache-control": "private, max-age=86400",
    });
  });

  app.post("/api/auth/two-step/start", signedIn, async (c) => {
    const me = c.get("me");
    ownOnly(me);
    const input = await readBody(c, z.object({ password }));
    await checkPassword(c, input.password);
    const setup = await startSetup(db, me.id, me.email ?? me.name);
    c.header("cache-control", "no-store");
    return c.json(setup);
  });

  app.post("/api/auth/two-step/confirm", signedIn, async (c) => {
    const me = c.get("me");
    ownOnly(me);
    const input = await readBody(c, z.object({ code }));
    const codes = await confirmSetup(db, me.id, input.code);
    // Whoever was in before this with the password alone is out.
    await endOtherSessions(db, me.id, c.get("token"));
    c.header("cache-control", "no-store");
    return c.json({ codes });
  });

  app.post("/api/auth/two-step/off", signedIn, async (c) => {
    const me = c.get("me");
    ownOnly(me);
    const input = await readBody(c, z.object({ password, code }));
    await checkPassword(c, input.password);
    await useCode(db, me.id, input.code);
    await turnOff(db, me.id, me.id);
    return c.json({ ok: true });
  });

  app.post("/api/auth/two-step/recovery", signedIn, async (c) => {
    const me = c.get("me");
    ownOnly(me);
    const input = await readBody(c, z.object({ password, code }));
    await checkPassword(c, input.password);
    await useCode(db, me.id, input.code);
    const codes = await renewRecovery(db, me.id);
    c.header("cache-control", "no-store");
    return c.json({ codes });
  });

  // For a lost phone with no recovery code left. The Admin proves it is them first.
  app.post("/api/auth/two-step/reset/:id", signedIn, async (c) => {
    const me = c.get("me");
    allow(me, ["admin"], "reset two-step sign-in");
    const target = idParam(c);
    if (target === me.id) throw new Refusal(400, "invalid", "Turn your own off from your profile.");
    const input = await readBody(c, z.object({ password, code: z.string().max(24).nullish() }));
    await checkPassword(c, input.password);
    if (await twoStepOn(db, me.id)) {
      if (!input.code?.trim()) throw new Refusal(400, "code_needed", "Enter the code from your own app.", "code");
      await useCode(db, me.id, input.code);
    }
    if (!(await turnOff(db, target, me.id))) throw new Refusal(409, "not_now", "Their two-step sign-in isn't on.");
    return c.json({ ok: true });
  });

  app.post("/api/auth/sessions/end-others", signedIn, async (c) => {
    const me = c.get("me");
    ownOnly(me);
    await endOtherSessions(db, me.id, c.get("token"));
    await accountEvent(db, me.id, me.id, "devices");
    return c.json({ ok: true });
  });
}
