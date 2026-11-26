// Sign up, the Admin confirms, an email says they're in. The form is open to anyone, so:
//   - asking makes no account, grants nothing and sends no email (nothing to flood an inbox with);
//   - its answer is the same for a known email and a new one, so it doesn't tell who works here;
//   - it takes no password: the acceptance email's link sets it, so only whoever reads that inbox
//     gets in, whoever typed the address;
//   - the seat the Admin gives decides the role (never CEO or Admin this way);
//   - the link works once, for three days, and a password given meanwhile ends it.

import { createHash, randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { hashPassword, passwordProblem } from "../auth/password";
import { ownWorkspace, workspaceByKey } from "../auth/workspaces";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import { sendFromMailbox } from "../online/email";
import { addPerson, loginDomain, seatLoginOf } from "../org/service";
import type { Role } from "../people/roles";
import type { Me, OrgPersonInput, SignUpInput, SignUpList, SignUpRow, SignUpSent, WelcomeInfo } from "../types";
import { accountEvent } from "./events";
import { folded, namePart, PHONE, shownName, SUFFIXES } from "./profile";

/** What can be asked for. The CEO's, the Admin's and Books aren't. */
export const SIGN_UP_DEPARTMENTS = [
  "sales",
  "leads",
  "heads",
  "management",
  "finance",
  "dispatch",
  "inventory",
  "online",
  "hr",
  "regulatory",
  "office",
] as const;
const NOT_BY_SIGN_UP: readonly string[] = ["ceo", "admin"];
// The proxy's word on who is asking can be made up, so the limits are on the whole form.
export const PER_HOUR = 40;
export const MOST_WAITING = 500;
const LINK_HOURS = 72;
// Plain ASCII only: no look-alike letters in an address the Admin reads, and no line breaks in a mail's header.
const EMAIL = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_+-])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Anyone's: only a request is written. Says nothing about who exists. */
export async function askToJoin(db: Database, input: SignUpInput): Promise<void> {
  const first = namePart(input.firstName, "firstName", "first name");
  if (!first) throw new Refusal(400, "invalid", "Enter your first name.", "firstName");
  const last = namePart(input.lastName, "lastName", "last name");
  if (!last) throw new Refusal(400, "invalid", "Enter your last name.", "lastName");
  const middle = namePart(input.middleName, "middleName", "middle name");
  const suffix = input.suffix || null;
  if (suffix && !(SUFFIXES as readonly string[]).includes(suffix))
    throw new Refusal(400, "invalid", "Pick a suffix from the list.", "suffix");
  const email = input.email.trim().toLowerCase();
  if (email.length > 120 || !EMAIL.test(email))
    throw new Refusal(400, "invalid", "Type your email, like juan@gmail.com.", "email");
  const phone = input.phone.trim();
  if (!PHONE.test(phone))
    throw new Refusal(400, "invalid", "Type your mobile number, like 0917 555 0101.", "phone");
  if (!(SIGN_UP_DEPARTMENTS as readonly string[]).includes(input.department))
    throw new Refusal(400, "invalid", "Pick your department.", "department");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sign-up'))`);
    const [load] = await rows<{ hour: number; waiting: number }>(
      tx,
      sql`select (select count(*) from sign_up where created_at > now() - interval '1 hour')::int as hour,
          (select count(*) from sign_up where status = 'pending')::int as waiting`,
    );
    if ((load?.hour ?? 0) >= PER_HOUR || (load?.waiting ?? 0) >= MOST_WAITING)
      throw new Refusal(429, "busy", "Too many sign-ups right now. Try again later, or ask HR.");
    // Asking again changes nothing: someone else can't rewrite the request that is waiting.
    const made = await rows(
      tx,
      sql`insert into sign_up (first_name, middle_name, last_name, name_suffix, email, phone, department)
        values (${first}, ${middle}, ${last}, ${suffix}, ${email}, ${phone}, ${input.department})
        on conflict (email) where status = 'pending' do nothing returning id`,
    );
    if (!made.length) return;
    // Once an hour, and never in a stranger's words.
    await notify(tx, {
      to: await peopleIn(tx, ["admin"]),
      kind: "account",
      title: "New sign-ups are waiting for you",
      body: "Confirm who they are, then accept or decline.",
      link: "/admin/sign-ups",
      key: `sign-up-${new Date().toISOString().slice(0, 13)}`,
    });
  });
}

function adminOnly(me: Me): void {
  allow(me, ["admin"], "confirm sign-ups");
  if (me.viewedBy) throw new Refusal(403, "private", "Sign-ups are confirmed on the Admin's own login.");
}

export async function waitingCount(db: Database, me: Me): Promise<number> {
  adminOnly(me);
  const [found] = await rows<{ n: number }>(db, sql`select count(*)::int as n from sign_up where status = 'pending'`);
  return found?.n ?? 0;
}

export async function signUpList(db: Database, me: Me): Promise<SignUpList> {
  adminOnly(me);
  const time = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  const found = await rows<Omit<SignUpRow, "name" | "departmentLabel" | "sameName">>(
    db,
    sql`select s.id::int as id, s.first_name as "firstName", s.middle_name as "middleName", s.last_name as "lastName",
        s.name_suffix as suffix, s.email, s.phone, s.department, s.status,
        ${time(sql`s.created_at`)} as "createdAt", ${time(sql`s.decided_at`)} as "decidedAt", b.name as "decidedBy", s.decline_reason as reason,
        ${time(sql`s.emailed_at`)} as "emailedAt", s.email_problem as "emailProblem",
        case
          when s.status <> 'accepted' then null
          when not p.active then 'left'
          when not p.password_pending then 'ready'
          when lower(p.email) is distinct from s.email then 'expired'
          when s.link_hash is null or s.link_expires_at <= now() or s.link_password <> p.password_hash then 'expired'
          else 'waiting'
        end as account,
        (select x.name from person x where lower(x.email) = s.email and x.id is distinct from s.person_id limit 1) as "knownAs"
      from sign_up s left join person b on b.id = s.decided_by left join person p on p.id = s.person_id
      where s.status = 'pending' or s.id in (select id from sign_up where status <> 'pending' order by decided_at desc limit 200)
      order by s.status = 'pending' desc, case when s.status = 'pending' then s.created_at end, s.decided_at desc`,
  );
  const colleagues = await rows<{ name: string; first: string | null; last: string | null }>(
    db,
    sql`select name, first_name as first, last_name as last from person where active`,
  );
  const [mailbox] = await rows<{ address: string }>(
    db,
    sql`select key as address from channel_account where kind = 'email' and active order by id limit 1`,
  );
  return {
    mailFrom: mailbox?.address ?? null,
    rows: found.map((row) => {
      const name = shownName({ first: row.firstName, middle: row.middleName, last: row.lastName, suffix: row.suffix });
      const names = new Set([folded(name), folded(`${row.firstName}${row.lastName}`)]);
      const same =
        row.status === "pending"
          ? colleagues.find(
              (one) => names.has(folded(one.name)) || (one.first && one.last && names.has(folded(`${one.first}${one.last}`))),
            )
          : undefined;
      return {
        ...row,
        name,
        departmentLabel: workspaceByKey(row.department)?.label ?? row.department,
        sameName: same?.name ?? null,
      };
    }),
  };
}

// ---- the link and its email

async function newLink(tx: Runner, signUpId: number, personId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.execute(
    sql`update sign_up set link_hash = ${sha(token)}, link_expires_at = now() + make_interval(hours => ${LINK_HOURS}::int),
        link_password = (select password_hash from person where id = ${personId}), link_used_at = null,
        emailed_at = null, email_problem = null
      where id = ${signUpId}`,
  );
  return token;
}

const NO_MAILBOX = "No mailbox is connected, so nothing was sent. Connect one under Online pages & mail.";

/** Emails the acceptance. Only when it didn't go does the Admin get the link to pass on. */
async function sendAccepted(db: Database, webUrl: string, signUpId: number, token: string): Promise<SignUpSent> {
  const [to] = await rows<{ first: string; email: string }>(
    db,
    sql`select first_name as first, email from sign_up where id = ${signUpId}`,
  );
  if (!to) throw new Refusal(404, "not_found", "No such sign-up.");
  // After #, so it stays out of the servers' logs. The address is the server's own setting, never the request's.
  const link = `${webUrl.replace(/\/+$/, "")}/welcome#${token}`;
  let problem: string | null = null;
  try {
    const sent = await sendFromMailbox(db, {
      to: to.email,
      subject: "Your Bishnoi One account is accepted",
      text: [
        `Hi ${to.first},`,
        "",
        "Your Bishnoi One account has been accepted and can be used.",
        "",
        "Set your password to start:",
        link,
        "",
        `The link works once, for ${LINK_HOURS / 24} days. After that you sign in with ${to.email} and your password at ${webUrl}/login.`,
        "",
        "If you didn't sign up, don't open the link: just ignore this email.",
        "",
        "Bishnoi One",
      ].join("\n"),
    });
    if (!sent) problem = NO_MAILBOX;
  } catch (error) {
    problem = `The email didn't go. ${error instanceof Error ? error.message : ""}`.trim().slice(0, 400);
  }
  await db.execute(
    sql`update sign_up set emailed_at = case when ${problem === null} then now() end, email_problem = ${problem} where id = ${signUpId}`,
  );
  return { email: to.email, emailed: problem === null, problem, link: problem === null ? null : link };
}

export async function acceptSignUp(
  db: Database,
  me: Me,
  id: number,
  job: Omit<OrgPersonInput, "name" | "email" | "phone" | "password">,
  webUrl: string,
): Promise<SignUpSent> {
  adminOnly(me);
  const [asked] = await rows<{
    first: string;
    middle: string | null;
    last: string;
    suffix: string | null;
    email: string;
    phone: string;
    status: string;
  }>(
    db,
    sql`select first_name as first, middle_name as middle, last_name as last, name_suffix as suffix, email, phone, status
      from sign_up where id = ${id}`,
  );
  if (!asked) throw new Refusal(404, "not_found", "No such sign-up.");
  if (asked.status !== "pending") throw new Refusal(409, "not_now", "That sign-up was decided already.");

  let token = "";
  await addPerson(db, me, { ...job, name: shownName(asked), email: asked.email, phone: asked.phone }, async (tx, made) => {
    if (NOT_BY_SIGN_UP.includes(made.module))
      throw new Refusal(400, "invalid", "A CEO or Admin login isn't given by sign-up. Add them from Teams & people.", "module");
    // An address shaped like a seat's login would be typed into that seat's sign-in.
    const asSeat = seatLoginOf(asked.email);
    if (asSeat) {
      const taken = await rows(
        tx,
        sql`select id from seat where active and lower(login) = ${asSeat} and id <> ${made.seatId}`,
      );
      if (taken.length) throw new Refusal(409, "taken", `${asked.email} is another seat's login ID.`, "email");
    }
    const claimed = await rows(
      tx,
      sql`update sign_up set status = 'accepted', decided_at = now(), decided_by = ${me.id}, person_id = ${made.personId}
        where id = ${id} and status = 'pending' returning id`,
    );
    if (!claimed.length) throw new Refusal(409, "not_now", "That sign-up was decided already.");
    // No way in until the link sets a password.
    await tx.execute(
      sql`update person set password_pending = true, must_change_password = false, first_name = ${asked.first},
          middle_name = ${asked.middle}, last_name = ${asked.last}, name_suffix = ${asked.suffix}
        where id = ${made.personId}`,
    );
    await tx.execute(sql`update employee set personal_email = ${asked.email} where person_id = ${made.personId}`);
    await accountEvent(tx, made.personId, me.id, "accepted");
    token = await newLink(tx, id, made.personId);
  });
  // After it is kept: a slow mail server holds no lock, and a failed email doesn't undo the account.
  return sendAccepted(db, webUrl, id, token);
}

export async function resendAccepted(db: Database, me: Me, id: number, webUrl: string): Promise<SignUpSent> {
  adminOnly(me);
  const token = await db.transaction(async (tx) => {
    const [found] = await rows<{ personId: number }>(
      tx,
      sql`select p.id::int as "personId" from sign_up s join person p on p.id = s.person_id
        where s.id = ${id} and s.status = 'accepted' and p.active and p.password_pending and lower(p.email) = s.email for update`,
    );
    if (!found) throw new Refusal(409, "not_now", "A link can't be sent: the account has a password, isn't active, or its email was changed. Give a new password from Teams & people if needed.");
    return newLink(tx, id, found.personId);
  });
  return sendAccepted(db, webUrl, id, token);
}

export async function declineSignUp(db: Database, me: Me, id: number, reason: string | null): Promise<void> {
  adminOnly(me);
  const done = await rows(
    db,
    sql`update sign_up set status = 'declined', decided_at = now(), decided_by = ${me.id}, decline_reason = ${reason?.trim() || null}
      where id = ${id} and status = 'pending' returning id`,
  );
  if (!done.length) throw new Refusal(409, "not_now", "That sign-up was decided already.");
}

// ---- the person, from the email's link

const deadLink = () =>
  new Refusal(
    409,
    "link_dead",
    "This link doesn't work any more: it was used, replaced or is over three days old. Ask your administrator to send it again.",
  );

async function linkOwner(db: Runner, token: string) {
  const [found] = await rows<{ first: string; email: string; role: Role; personId: number }>(
    db,
    sql`select s.first_name as first, p.email, p.role, p.id::int as "personId"
      from sign_up s join person p on p.id = s.person_id
      where s.link_hash = ${sha(token)} and s.link_expires_at > now()
        and p.active and p.password_pending and p.password_hash = s.link_password and lower(p.email) = s.email`,
  );
  if (!found) throw deadLink();
  return found;
}

export async function welcomeInfo(db: Database, token: string): Promise<WelcomeInfo> {
  const who = await linkOwner(db, token);
  const [seat] = await rows<{ login: string }>(
    db,
    sql`select s.login from seat_holder h join seat s on s.id = h.seat_id and s.active and s.login is not null
      where h.person_id = ${who.personId} and h.kind = 'holder' and h.ends_on is null
        and h.starts_on <= (now() at time zone 'Asia/Manila')::date
      order by h.id limit 1`,
  );
  return {
    firstName: who.first,
    email: who.email,
    seatLogin: seat ? `${seat.login}@${loginDomain()}` : null,
    department: ownWorkspace(who.role)?.key ?? null,
  };
}

export async function setFirstPassword(db: Database, token: string, password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new Refusal(400, "invalid", problem, "password");
  // The link is looked at first: a made-up one costs no password hashing.
  await linkOwner(db, token);
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [done] = await rows<{ id: number }>(
      tx,
      sql`update person p set password_hash = ${hash}, password_pending = false, must_change_password = false,
          failed_logins = 0, locked_until = null
        from sign_up s
        where s.person_id = p.id and s.link_hash = ${sha(token)} and s.link_expires_at > now()
          and p.active and p.password_pending and p.password_hash = s.link_password and lower(p.email) = s.email
        returning p.id::int as id`,
    );
    if (!done) throw deadLink();
    await tx.execute(
      sql`update sign_up set link_hash = null, link_password = null, link_used_at = now() where person_id = ${done.id}`,
    );
    await accountEvent(tx, done.id, done.id, "password_set");
  });
}
