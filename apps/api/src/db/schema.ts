// The tables as the code sees them. The database itself is made by the SQL files in
// ../../migrations; keep the two in step (the tests run against the migrated database).

import { bigint, boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: "number" });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const channel = pgTable("channel", {
  id: id(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  /** The Division its orders carry ("HOS"), set in the Admin panel. */
  division: text("division"),
  /** Out of use once nobody works in it: kept for its history, left out of the lists. */
  active: boolean("active").notNull().default(true),
});

export const area = pgTable("area", {
  id: id(),
  channelId: ref("channel_id").notNull(),
  name: text("name").notNull(),
  cities: text("cities").array().notNull().default([]),
});

export const person = pgTable("person", {
  id: id(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  role: text("role").notNull(),
  channelId: ref("channel_id"),
  areaId: ref("area_id"),
  reportsTo: ref("reports_to"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: at("locked_until"),
  lastSignInAt: at("last_sign_in_at"),
  active: boolean("active").notNull().default(true),
  createdAt: at("created_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: id(),
  tokenHash: text("token_hash").notNull(),
  personId: ref("person_id").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
  lastSeenAt: at("last_seen_at").notNull().defaultNow(),
  expiresAt: at("expires_at").notNull(),
  /** The CEO or Admin looking as this person (read only), on such a session. */
  viewedBy: ref("viewed_by"),
});
