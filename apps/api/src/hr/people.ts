// HR's people: every person's employee record beside their login and seat, new joiners added by
// HR into a vacant seat with the login email and password HR made for them (HR hands them over;
// the system sends nothing), and leaving (the record is kept). HR, the CEO and the Admin keep
// records; pay, bank and government IDs are theirs and the person's own.

import { accountEvent } from "../account/events";
import { COMPANY_CODES } from "../companies";
import { careerOf, changeSentence, changesOf, hrEvent } from "./events";
import { placesOf, townOnList } from "./holidays";
import { type SQL, sql } from "drizzle-orm";
import { hashPassword, passwordProblem } from "../auth/password";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, type Runner } from "../inventory/service";
import {
  change,
  EMAIL,
  fillSeat,
  fillSeatLogins,
  LOGIN_DOMAIN,
  type MoveKind,
  personLeaves,
  refuseIfPromised,
  seatLoginOf,
  seatRow,
} from "../org/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import type {
  CivilStatus,
  Classification,
  Company,
  Gender,
  WorkArrangement,
  HrLoginInput,
  HrPeople,
  HrPerson,
  HrPersonRow,
  HrRecordInput,
  JoinerForm,
  JoinerInput,
  LoginState,
  Me,
  PersonStage,
} from "../types";

/** Who sees people's records and pay: HR, the CEO and the Admin. */
export const HR_ROLES: Role[] = ["hr", "ceo", "admin"];
/** Who does HR's work (adds joiners, keeps records, logins, leaving): HR, with the Admin as its
 *  backup. The CEO reads. */
export const HR_WRITE_ROLES: Role[] = ["hr", "admin"];
const COMPANIES: readonly Company[] = COMPANY_CODES;
const CLASSES: Classification[] = ["probationary", "regular", "part_time", "intern"];
const PHONE = /^\+?[0-9][0-9 -]{6,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a record still lacks, for HR's to-do and the person's first sign-in. */
const MISSING = sql`array_remove(array[
    case when e.employee_code is null then 'employee ID' end,
    case when e.mobile is null then 'mobile' end,
    case when e.address is null then 'address' end,
    case when e.emergency_name is null then 'emergency contact' end,
    case when e.sss is null then 'SSS' end,
    case when e.philhealth is null then 'PhilHealth' end,
    case when e.pagibig is null then 'Pag-IBIG' end,
    case when e.tin is null then 'TIN' end
  ], null)`;

/** Everyone has a record: people added before HR's records (or by the demo) get one. */
export async function ensureRecords(db: Runner): Promise<void> {
  await db.execute(
    sql`insert into employee (person_id, status, hire_date, position, mobile)
      select p.id, case when p.active then 'active' else 'left' end,
        -- Hired the day they first held a seat, else the day they were added.
        coalesce((select min(h.starts_on) from seat_holder h where h.person_id = p.id),
          (p.created_at at time zone 'Asia/Manila')::date), p.title, p.phone
      from person p where not exists (select 1 from employee e where e.person_id = p.id)`,
  );
}

const stageOf = (active: boolean, status: string, hireDate: string, today: string): PersonStage =>
  !active || status === "left" ? "left" : hireDate > today ? "joining" : "active";

const loginOf = (active: boolean, used: boolean): LoginState =>
  !active ? "off" : used ? "ready" : "new";

/** When the person last signed in (never the CEO's or Admin's look as them). */
const LAST_USED = sql`p.last_sign_in_at`;

/** The person's seat today, or the one they are joining. */
const seatLateral = (today: string) => sql`left join lateral (
    select s.id::int as id, s.title, s.login, u.name as team, a.name as area, h.starts_on
    from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
      left join area a on a.id = s.area_id
    where h.person_id = p.id and h.kind = 'holder' and (h.ends_on is null or h.ends_on >= ${today}::date)
    order by h.starts_on, h.id limit 1) seat on true`;

/** What they sign in with: the email HR gave them, else their seat's login ID. */
const loginIdOf = (seatLogin: string | null, email: string | null) =>
  email ?? (seatLogin ? `${seatLogin}@${LOGIN_DOMAIN}` : null);

export async function hrPeople(
  db: Database,
  me: Me,
  filter: { q?: string | null; stage?: string | null } = {},
): Promise<HrPeople> {
  allow(me, HR_ROLES, "see people's records");
  await ensureRecords(db);
  const today = todayManila();
  const found = await rows<{
    personId: number;
    name: string;
    role: Role;
    active: boolean;
    email: string | null;
    status: string;
    employeeCode: string | null;
    company: Company;
    position: string | null;
    hireDate: string;
    classification: Classification;
    team: string | null;
    seatLogin: string | null;
    used: boolean;
    missing: string[];
  }>(
    db,
    sql`select p.id::int as "personId", p.name, p.role, p.active, p.email, e.status, e.employee_code as "employeeCode",
        e.company, coalesce(e.position, p.title) as position, to_char(e.hire_date, 'YYYY-MM-DD') as "hireDate",
        e.classification, seat.team, seat.login as "seatLogin",
        ${LAST_USED} is not null as used,
        ${MISSING} as missing
      from person p join employee e on e.person_id = p.id ${seatLateral(today)}
      where p.role <> 'admin'
      order by p.name`,
  );
  const all: HrPersonRow[] = found.map((one) => ({
    personId: one.personId,
    name: one.name,
    employeeCode: one.employeeCode,
    company: one.company,
    position: one.position,
    team: one.team,
    role: one.role,
    roleLabel: ROLE_LABEL[one.role],
    stage: stageOf(one.active, one.status, one.hireDate, today),
    login: loginOf(one.active, one.used),
    loginId: loginIdOf(one.seatLogin, one.email),
    hireDate: one.hireDate,
    classification: one.classification,
    missing: one.missing,
  }));
  const words = clean(filter.q)?.toLowerCase();
  const rowsOut = all.filter((one) => {
    if (
      words &&
      !`${one.name} ${one.employeeCode ?? ""} ${one.position ?? ""} ${one.team ?? ""}`
        .toLowerCase()
        .includes(words)
    )
      return false;
    if (filter.stage === "left") return one.stage === "left";
    if (filter.stage === "joining") return one.stage === "joining";
    if (filter.stage === "missing") return one.stage !== "left" && one.missing.length > 0;
    if (filter.stage === "all") return true;
    return one.stage !== "left";
  });
  return {
    rows: rowsOut,
    counts: {
      all: all.length,
      active: all.filter((one) => one.stage !== "left").length,
      joining: all.filter((one) => one.stage === "joining").length,
      left: all.filter((one) => one.stage === "left").length,
      missing: all.filter((one) => one.stage !== "left" && one.missing.length > 0).length,
    },
    can: { add: HR_WRITE_ROLES.includes(me.role) },
  };
}

/** One person's record: HR, the CEO and the Admin see all of it; a person their own, pay too. */
export async function hrPerson(db: Database, me: Me, personId: number): Promise<HrPerson> {
  const hr = HR_ROLES.includes(me.role);
  const works = HR_WRITE_ROLES.includes(me.role);
  if (!hr && me.id !== personId)
    throw new Refusal(403, "not_allowed", "Only HR sees other people's records.");
  await ensureRecords(db);
  const today = todayManila();
  const [one] = await rows<{
    personId: number;
    name: string;
    role: Role;
    active: boolean;
    email: string | null;
    lastSignIn: string | null;
    status: string;
    company: Company;
    employeeCode: string | null;
    classification: Classification;
    position: string | null;
    department: string | null;
    hireDate: string;
    regularizedOn: string | null;
    leftOn: string | null;
    leftReason: string | null;
    mobile: string | null;
    personalEmail: string | null;
    birthDate: string | null;
    address: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    emergencyRelation: string | null;
    gender: Gender | null;
    civilStatus: CivilStatus | null;
    citizenship: string | null;
    spouseName: string | null;
    fatherName: string | null;
    motherName: string | null;
    education: string | null;
    school: string | null;
    course: string | null;
    workArrangement: WorkArrangement | null;
    workTown: string | null;
    workProvince: string | null;
    companyPhone: string | null;
    issuedEquipment: string | null;
    jobDescription: string | null;
    salary: number | null;
    allowance: number | null;
    bankName: string | null;
    bankAccount: string | null;
    sss: string | null;
    philhealth: string | null;
    pagibig: string | null;
    tin: string | null;
    noSss: boolean;
    noPhilhealth: boolean;
    noPagibig: boolean;
    noTax: boolean;
    seatId: number | null;
    seatTitle: string | null;
    seatLogin: string | null;
    team: string | null;
    area: string | null;
    missing: string[];
  }>(
    db,
    sql`select p.id::int as "personId", p.name, p.role, p.active, p.email,
        to_char(${LAST_USED} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastSignIn",
        e.status, e.company, e.employee_code as "employeeCode", e.classification, coalesce(e.position, p.title) as position,
        e.department, to_char(e.hire_date, 'YYYY-MM-DD') as "hireDate", to_char(e.regularized_on, 'YYYY-MM-DD') as "regularizedOn",
        to_char(e.left_on, 'YYYY-MM-DD') as "leftOn", e.left_reason as "leftReason", e.mobile, e.personal_email as "personalEmail",
        to_char(e.birth_date, 'YYYY-MM-DD') as "birthDate", e.address, e.emergency_name as "emergencyName",
        e.emergency_phone as "emergencyPhone", e.emergency_relation as "emergencyRelation",
        e.gender, e.civil_status as "civilStatus", e.citizenship, e.spouse_name as "spouseName",
        e.father_name as "fatherName", e.mother_name as "motherName", e.education, e.school, e.course,
        e.work_arrangement as "workArrangement", e.work_town as "workTown", e.work_province as "workProvince",
        e.company_phone as "companyPhone",
        e.issued_equipment as "issuedEquipment", e.job_description as "jobDescription",
        e.salary, e.allowance, e.bank_name as "bankName", e.bank_account as "bankAccount", e.sss, e.philhealth, e.pagibig, e.tin,
        e.no_sss as "noSss", e.no_philhealth as "noPhilhealth", e.no_pagibig as "noPagibig", e.no_tax as "noTax",
        seat.id as "seatId", seat.title as "seatTitle", seat.login as "seatLogin", seat.team, seat.area,
        ${MISSING} as missing
      from person p join employee e on e.person_id = p.id ${seatLateral(today)}
      where p.id = ${personId}`,
  );
  if (!one) throw new Refusal(404, "not_found", "No such person.");
  const [history, boss, career, schedule] = await Promise.all([
    rows<HrPerson["history"][number]>(
      db,
      sql`select s.title, u.name as team, to_char(h.starts_on, 'YYYY-MM-DD') as "from",
          to_char(h.ends_on, 'YYYY-MM-DD') as "to", h.end_reason as why
        from seat_holder h join seat s on s.id = h.seat_id join org_unit u on u.id = s.unit_id
        where h.person_id = ${personId} and h.kind = 'holder' order by h.starts_on desc, h.id desc`,
    ),
    // Whom they report to: the person the company tree puts above them.
    rows<{ name: string }>(
      db,
      sql`select b.name from person p join person b on b.id = p.reports_to and b.active where p.id = ${personId}`,
    ),
    careerOf(db, personId),
    // Their work schedule: the one HR gave them, else the company's default.
    rows<{ id: number | null; name: string; start: string; end: string; days: number[] }>(
      db,
      sql`select p.schedule_id::int as id, w.name, to_char(w.starts, 'HH24:MI') as start,
          to_char(w.ends, 'HH24:MI') as "end", w.days
        from person p join work_schedule w on w.id = coalesce(p.schedule_id,
          (select id from work_schedule where is_default and active limit 1))
        where p.id = ${personId}`,
    ),
  ]);
  const channel = one.seatId
    ? ((
        await rows<{ name: string }>(
          db,
          sql`with recursive up as (select u.id, u.parent_id, u.channel_id from seat s join org_unit u on u.id = s.unit_id where s.id = ${one.seatId}
              union all select o.id, o.parent_id, o.channel_id from org_unit o join up on o.id = up.parent_id)
            -- The target sheet's channel of the seat (CLIDP, MD Telesales…); PAP and a seat with none: the first channel's name.
            select case when c.code = 'PAP' then c.name else coalesce(seat_division(${one.seatId}), c.name) end as name
            from up join channel c on c.id = up.channel_id limit 1`,
        )
      )[0]?.name ?? null)
    : null;
  const pay = hr || me.id === personId;
  const holidayPlace = (await placesOf(db, [personId])).get(personId) ?? null;
  return {
    personId: one.personId,
    name: one.name,
    role: one.role,
    roleLabel: ROLE_LABEL[one.role],
    stage: stageOf(one.active, one.status, one.hireDate, today),
    login: loginOf(one.active, Boolean(one.lastSignIn)),
    loginId: loginIdOf(one.seatLogin, one.email),
    lastSignIn: one.lastSignIn,
    seat: one.seatId
      ? {
          id: one.seatId,
          title: one.seatTitle ?? "",
          team: one.team ?? "",
          channel,
          area: one.area,
          boss: boss[0]?.name ?? null,
        }
      : null,
    history,
    record: {
      company: one.company,
      employeeCode: one.employeeCode,
      classification: one.classification,
      position: one.position,
      department: one.department,
      hireDate: one.hireDate,
      regularizedOn: one.regularizedOn,
      leftOn: one.leftOn,
      leftReason: one.leftReason,
      mobile: one.mobile,
      personalEmail: one.personalEmail,
      birthDate: one.birthDate,
      address: one.address,
      emergencyName: one.emergencyName,
      emergencyPhone: one.emergencyPhone,
      emergencyRelation: one.emergencyRelation,
      gender: one.gender,
      civilStatus: one.civilStatus,
      citizenship: one.citizenship,
      spouseName: one.spouseName,
      fatherName: one.fatherName,
      motherName: one.motherName,
      education: one.education,
      school: one.school,
      course: one.course,
      workArrangement: one.workArrangement,
      workTown: one.workTown,
      workProvince: one.workProvince,
      holidayPlace,
      companyPhone: one.companyPhone,
      issuedEquipment: one.issuedEquipment,
      jobDescription: one.jobDescription,
      salary: pay ? one.salary : null,
      allowance: pay ? one.allowance : null,
      bankName: pay ? one.bankName : null,
      bankAccount: pay ? one.bankAccount : null,
      sss: pay ? one.sss : null,
      philhealth: pay ? one.philhealth : null,
      pagibig: pay ? one.pagibig : null,
      tin: pay ? one.tin : null,
      payExempt: pay
        ? { sss: one.noSss, philhealth: one.noPhilhealth, pagibig: one.noPagibig, tax: one.noTax }
        : null,
    },
    missing: one.missing,
    career,
    can: {
      edit: works,
      login: works && one.active && one.role !== "ceo" && one.role !== "admin",
      leave: works && one.active && me.id !== one.personId && one.role !== "ceo",
      // Marked as left by mistake, or back after leaving (the hub couldn't reactivate anyone).
      back: works && !one.active,
      schedule: works && one.active && one.role !== "admin",
    },
    schedule: schedule[0] ?? { id: null, name: "Office hours", start: "07:00", end: "16:00", days: [1, 2, 3, 4, 5, 6] },
  };
}

/** The vacant seats a joiner can take: nobody in them now and nobody joining them. */
export async function joinerForm(db: Database, me: Me): Promise<JoinerForm> {
  allow(me, HR_WRITE_ROLES, "add new joiners");
  const today = todayManila();
  const seats = await rows<JoinerForm["seats"][number]>(
    db,
    sql`select s.id::int as id, s.title, u.name as team, a.name as area,
        (with recursive up as (select o.id, o.parent_id, o.channel_id from org_unit o where o.id = s.unit_id
            union all select o.id, o.parent_id, o.channel_id from org_unit o join up on o.id = up.parent_id)
          select c.code from up join channel c on c.id = up.channel_id limit 1) as channel
      from seat s join org_unit u on u.id = s.unit_id and u.active left join area a on a.id = s.area_id
      where s.active and s.module not in ('ceo', 'admin') and not exists (
        select 1 from seat_holder h join person p on p.id = h.person_id and p.active
        where h.seat_id = s.id and h.kind = 'holder' and (h.ends_on is null or h.ends_on >= ${today}::date))
      order by u.name, s.title`,
  );
  return { today, seats };
}

const text = (value: string | null | undefined) => clean(value) ?? null;

/** The email a person signs in with: an address nobody else has, and never another seat's
 *  login ID (that one signs in whoever sits there). */
async function checkLoginEmail(
  tx: Runner,
  typed: string | null | undefined,
  personId: number | null,
  seatId: number | null,
): Promise<string> {
  const email = clean(typed)?.toLowerCase() ?? "";
  if (!EMAIL.test(email))
    throw new Refusal(
      400,
      "invalid",
      "Type the email they sign in with, like juan@2mginc.com.",
      "loginEmail",
    );
  const [used] = await rows<{ name: string; active: boolean }>(
    tx,
    sql`select name, active from person where lower(email) = ${email} and id <> ${personId ?? 0}`,
  );
  if (used)
    throw new Refusal(
      409,
      "taken",
      used.active
        ? `${email} is ${used.name}'s login already.`
        : `${email} was ${used.name}'s login: use another one.`,
      "loginEmail",
    );
  const seatLogin = seatLoginOf(email);
  if (seatLogin && email.includes("@")) {
    const [seat] = await rows<{ id: number; title: string }>(
      tx,
      sql`select id::int as id, title from seat where active and lower(login) = ${seatLogin}`,
    );
    if (seat && seat.id !== seatId)
      throw new Refusal(
        409,
        "taken",
        `${email} is the login of the seat "${seat.title}".`,
        "loginEmail",
      );
  }
  return email;
}

function checkPassword(password: string | null | undefined): string {
  const typed = password ?? "";
  if (!typed) throw new Refusal(400, "invalid", "Type the password you give them.", "password");
  const problem = passwordProblem(typed);
  if (problem) throw new Refusal(400, "invalid", problem, "password");
  return typed;
}

/** HR adds a new joiner into a vacant seat, with the login email and password HR made for them. */
export async function addJoiner(
  db: Database,
  me: Me,
  input: JoinerInput,
): Promise<{ personId: number; loginEmail: string }> {
  allow(me, HR_WRITE_ROLES, "add new joiners");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Refusal(400, "invalid", "Type their full name.", "name");
  const mobile = input.mobile.trim();
  if (!PHONE.test(mobile))
    throw new Refusal(400, "invalid", "Type their mobile number, like 0917 555 0101.", "mobile");
  if (!COMPANIES.includes(input.company))
    throw new Refusal(400, "invalid", "Pick the company.", "company");
  if (!CLASSES.includes(input.classification))
    throw new Refusal(400, "invalid", "Pick how they are employed.", "classification");
  const today = todayManila();
  if (!DAY.test(input.startsOn))
    throw new Refusal(400, "invalid", "Pick their first day.", "startsOn");
  if (input.startsOn < addDays(today, -31) || input.startsOn > addDays(today, 90))
    throw new Refusal(
      400,
      "invalid",
      "Their first day is within the last month or the next three months.",
      "startsOn",
    );
  for (const [field, value] of [
    ["salary", input.salary],
    ["allowance", input.allowance],
  ] as const)
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0))
      throw new Refusal(400, "invalid", "Type the monthly amount in pesos.", field);
  // HR hands over a one-time password; the joiner chooses their own at the first sign-in.
  const password = checkPassword(input.password);
  const code = text(input.employeeCode)?.toUpperCase() ?? null;
  const hash = await hashPassword(password);

  return change(db, async (tx) => {
    const seat = await seatRow(tx, input.seatId, today);
    if (seat.holderId)
      throw new Refusal(409, "taken", `${seat.holder} sits in "${seat.title}" already.`, "seatId");
    await refuseIfPromised(tx, seat.id, today);
    if (seat.module === "ceo" || seat.module === "admin")
      throw new Refusal(400, "invalid", "That seat isn't filled through HR.", "seatId");
    const loginEmail = await checkLoginEmail(tx, input.loginEmail, null, seat.id);
    if (code) {
      const [taken] = await rows<{ name: string }>(
        tx,
        sql`select p.name from employee e join person p on p.id = e.person_id
          where e.company = ${input.company} and upper(e.employee_code) = ${code}`,
      );
      if (taken)
        throw new Refusal(409, "taken", `Employee ID ${code} is ${taken.name}'s.`, "employeeCode");
    }
    // A position typed for them is one of HR's list; none typed, the seat's title.
    if (text(input.position)) await refuseUnknownPosition(tx, text(input.position) as string);
    const position = text(input.position) ?? seat.title;
    const [person] = await rows<{ id: number }>(
      tx,
      sql`insert into person (name, email, phone, title, role, password_hash, must_change_password)
        values (${name}, ${loginEmail}, ${mobile}, ${position}, ${seat.module}, ${hash}, true)
        returning id::int as id`,
    );
    const personId = person?.id as number;
    await tx.execute(
      sql`insert into seat_holder (seat_id, person_id, kind, starts_on, reason, by_person)
        values (${seat.id}, ${personId}, 'holder', ${input.startsOn}::date, 'Joined', ${me.id})`,
    );
    await fillSeatLogins(tx);
    await tx.execute(
      sql`insert into employee (person_id, company, employee_code, classification, position, hire_date, mobile,
          salary, allowance, created_by)
        values (${personId}, ${input.company}, ${code}, ${input.classification}, ${position}, ${input.startsOn}::date,
          ${mobile}, ${input.salary ?? null}, ${input.allowance ?? null}, ${me.id})`,
    );
    await hrEvent(tx, personId, me.id, "joined", `Added as a joiner in "${seat.title}" from ${input.startsOn}`);
    return { personId, loginEmail };
  });
}

/** HR changes the email a person signs in with or gives them a new password (typed by HR). Their
 *  open sessions end when the password changes. */
export async function setLogin(
  db: Database,
  me: Me,
  personId: number,
  input: HrLoginInput,
): Promise<{ loginEmail: string | null }> {
  allow(me, HR_WRITE_ROLES, "change logins");
  const changeEmail = input.email !== undefined && input.email !== null;
  const changePassword =
    input.password !== undefined && input.password !== null && input.password !== "";
  if (!changeEmail && !changePassword)
    throw new Refusal(400, "invalid", "Type the new email or the new password.");
  const password = changePassword ? checkPassword(input.password) : null;
  const hash = password ? await hashPassword(password) : null;
  return change(db, async (tx, today) => {
    const [person] = await rows<{ id: number; role: Role; email: string | null }>(
      tx,
      sql`select id::int as id, role, email from person where id = ${personId} and active for update`,
    );
    if (!person) throw new Refusal(404, "not_found", "That person isn't working here any more.");
    if (person.role === "ceo" || person.role === "admin")
      throw new Refusal(
        403,
        "not_allowed",
        "The CEO's and the Admin's logins aren't changed here.",
      );
    let email = person.email;
    if (changeEmail) {
      const [seat] = await rows<{ id: number }>(
        tx,
        sql`select h.seat_id::int as id from seat_holder h where h.person_id = ${personId} and h.kind = 'holder'
          and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on, h.id limit 1`,
      );
      email = await checkLoginEmail(tx, input.email, personId, seat?.id ?? null);
      await tx.execute(sql`update person set email = ${email} where id = ${personId}`);
      if (email !== person.email)
        await hrEvent(tx, personId, me.id, "login", "Login email changed", [
          { field: "loginEmail", label: "Login email", from: person.email, to: email, hidden: false },
        ]);
    }
    if (hash) {
      await tx.execute(
        sql`update person set password_hash = ${hash}, must_change_password = true, password_pending = false,
            failed_logins = 0, locked_until = null where id = ${personId}`,
      );
      await tx.execute(
        sql`delete from session where (person_id = ${personId} and viewed_by is null) or viewed_by = ${personId}`,
      );
      await accountEvent(tx, personId, me.id, "password_given");
      await hrEvent(tx, personId, me.id, "login", "One-time password given");
    }
    return { loginEmail: email };
  });
}

const RECORD_COLUMNS: Record<keyof HrRecordInput, string> = {
  company: "company",
  employeeCode: "employee_code",
  classification: "classification",
  position: "position",
  department: "department",
  hireDate: "hire_date",
  regularizedOn: "regularized_on",
  mobile: "mobile",
  personalEmail: "personal_email",
  birthDate: "birth_date",
  address: "address",
  emergencyName: "emergency_name",
  emergencyPhone: "emergency_phone",
  emergencyRelation: "emergency_relation",
  gender: "gender",
  civilStatus: "civil_status",
  citizenship: "citizenship",
  spouseName: "spouse_name",
  fatherName: "father_name",
  motherName: "mother_name",
  education: "education",
  school: "school",
  course: "course",
  workArrangement: "work_arrangement",
  workTown: "work_town",
  workProvince: "work_province",
  companyPhone: "company_phone",
  issuedEquipment: "issued_equipment",
  jobDescription: "job_description",
  salary: "salary",
  allowance: "allowance",
  bankName: "bank_name",
  bankAccount: "bank_account",
  sss: "sss",
  philhealth: "philhealth",
  pagibig: "pagibig",
  tin: "tin",
  noSss: "no_sss",
  noPhilhealth: "no_philhealth",
  noPagibig: "no_pagibig",
  noTax: "no_tax",
};
const DATE_FIELDS = new Set(["hireDate", "regularizedOn", "birthDate"]);
/** Fields with a fixed set of answers. */
const CHOICES: Partial<Record<keyof HrRecordInput, string[]>> = {
  gender: ["female", "male"],
  civilStatus: ["single", "married", "widowed", "separated"],
  workArrangement: ["office", "field", "hybrid", "remote"],
};
/** The long ones: what HR may write, at most. */
const TEXT_LIMIT: Partial<Record<keyof HrRecordInput, number>> = {
  issuedEquipment: 500,
  jobDescription: 2000,
};

/** A position is one of HR's list (Positions): a typo never becomes a new job title. */
async function refuseUnknownPosition(db: Runner, position: string): Promise<void> {
  const name = position.toLowerCase();
  // On the list; or a seat's title in the company tree that HR hasn't archived.
  const [known] = await rows<{ ok: number }>(
    db,
    sql`select 1 as ok where exists (select 1 from hr_position where lower(name) = ${name} and archived_at is null)
      or (exists (select 1 from seat where lower(title) = ${name})
        and not exists (select 1 from hr_position where lower(name) = ${name}))`,
  );
  if (!known)
    throw new Refusal(400, "invalid", `"${position}" isn't on HR's list of positions. Add it in Positions first.`, "position");
}

/** HR changes a record: only the fields sent. */
export async function updateRecord(
  db: Database,
  me: Me,
  personId: number,
  input: HrRecordInput,
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "change people's records");
  await ensureRecords(db);
  // The work town is one of the CRM's town list, sent with its province (or both cleared).
  if ("workTown" in input || "workProvince" in input) {
    const town = text(input.workTown);
    const province = text(input.workProvince);
    if (town || province) {
      const place = town && province ? townOnList(town, province) : null;
      if (!place) throw new Refusal(400, "invalid", "Pick the work town from the list.", "workTown");
      input = { ...input, workTown: place.town, workProvince: place.province };
    } else input = { ...input, workTown: null, workProvince: null };
  }
  const sets: SQL[] = [];
  // What the record becomes, for HR's trail.
  const after: Record<string, string | number | boolean | null> = {};
  for (const [key, column] of Object.entries(RECORD_COLUMNS) as [keyof HrRecordInput, string][]) {
    if (!(key in input)) continue;
    let value = input[key] as string | number | boolean | null | undefined;
    if (typeof value === "string") value = value.trim() || null;
    if (value === undefined) value = null;
    if (key.startsWith("no")) {
      if (typeof value !== "boolean")
        throw new Refusal(400, "invalid", "Tick it or leave it.", key);
      sets.push(sql`${sql.raw(column)} = ${value}`);
      after[key] = value;
      continue;
    }
    if (key === "company" && !COMPANIES.includes(value as Company))
      throw new Refusal(400, "invalid", "Pick the company.", key);
    if (key === "classification" && !CLASSES.includes(value as Classification))
      throw new Refusal(400, "invalid", "Pick how they are employed.", key);
    if (key === "hireDate" && !value) throw new Refusal(400, "invalid", "Pick the hire date.", key);
    const choices = CHOICES[key];
    if (choices && value !== null && !choices.includes(String(value)))
      throw new Refusal(400, "invalid", "Pick one from the list.", key);
    if (TEXT_LIMIT[key] && value !== null && String(value).length > (TEXT_LIMIT[key] as number))
      throw new Refusal(400, "invalid", `Keep it under ${TEXT_LIMIT[key]} characters.`, key);
    if (key === "companyPhone" && value !== null && !PHONE.test(String(value)))
      throw new Refusal(400, "invalid", "Type a mobile number, like 0917 555 0101.", key);
    if (DATE_FIELDS.has(key) && value !== null && !DAY.test(String(value)))
      throw new Refusal(400, "invalid", "Pick a day.", key);
    if (
      (key === "mobile" || key === "emergencyPhone") &&
      value !== null &&
      !PHONE.test(String(value))
    )
      throw new Refusal(400, "invalid", "Type a mobile number, like 0917 555 0101.", key);
    if (key === "personalEmail" && value !== null && !EMAIL.test(String(value)))
      throw new Refusal(400, "invalid", "Type an email like name@gmail.com.", key);
    if (
      (key === "salary" || key === "allowance") &&
      value !== null &&
      (!Number.isInteger(value) || (value as number) < 0)
    )
      throw new Refusal(400, "invalid", "Type the monthly amount in pesos.", key);
    if ((key === "employeeCode" || key === "personalEmail") && value !== null)
      value = key === "employeeCode" ? String(value).toUpperCase() : String(value).toLowerCase();
    after[key] = value;
    sets.push(
      DATE_FIELDS.has(key)
        ? sql`${sql.raw(column)} = ${value}::date`
        : sql`${sql.raw(column)} = ${value}`,
    );
  }
  if (!sets.length) return;
  await change(db, async (tx) => {
    // The record as it was, each field as the form sends it (dates as YYYY-MM-DD).
    const [found] = await rows<Record<string, string | number | boolean | null> & { company: Company }>(
      tx,
      sql`select ${sql.join(
        // The column and its key both come from RECORD_COLUMNS, a fixed list in this file, never from
        // the request (the code scan's raw-SQL rule asks for that to be said).
        (Object.entries(RECORD_COLUMNS) as [string, string][]).map(([key, column]) =>
          DATE_FIELDS.has(key)
            ? sql`to_char(${sql.raw(column)}, 'YYYY-MM-DD') as ${sql.raw(`"${key}"`)}` // nosemgrep
            : sql`${sql.raw(column)} as ${sql.raw(`"${key}"`)}`, // nosemgrep
        ),
        sql`, `,
      )} from employee where person_id = ${personId} for update`,
    );
    if (!found) throw new Refusal(404, "not_found", "No such person.");
    const position = typeof after.position === "string" ? after.position : null;
    if (position && position !== found.position) await refuseUnknownPosition(tx, position);
    const code = text(input.employeeCode)?.toUpperCase();
    if (code) {
      const [taken] = await rows<{ name: string }>(
        tx,
        sql`select p.name from employee e join person p on p.id = e.person_id
          where e.person_id <> ${personId} and upper(e.employee_code) = ${code}
            and e.company = ${input.company ?? found.company}`,
      );
      if (taken)
        throw new Refusal(409, "taken", `Employee ID ${code} is ${taken.name}'s.`, "employeeCode");
    }
    await tx.execute(
      sql`update employee set ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${me.id}
        where person_id = ${personId}`,
    );
    if ("mobile" in input)
      await tx.execute(sql`update person set phone = ${text(input.mobile)} where id = ${personId}`);
    if ("position" in input && text(input.position))
      await tx.execute(
        sql`update person set title = ${text(input.position)} where id = ${personId}`,
      );
    const changes = changesOf(found, after);
    if (changes.length) await hrEvent(tx, personId, me.id, "record", changeSentence(changes), changes);
  });
}

/** HR marks someone as left: the login stops, the seat falls vacant, the record is kept. */
/** Someone marked as left is back (a mistake, or rehired): they sign in again once given a
 *  one-time password (the old one and old sessions don't return); they are put in a seat from Teams & people (they show as "no seat"). */
export async function personBack(db: Database, me: Me, personId: number): Promise<void> {
  allow(me, HR_WRITE_ROLES, "bring someone back");
  const changed = await rows<{ name: string }>(
    db,
    sql`update person set active = true, password_pending = true where id = ${personId} and not active returning name`,
  );
  if (!changed.length) throw new Refusal(409, "not_now", "They are at work already.");
  await db.execute(sql`delete from session where person_id = ${personId} or viewed_by = ${personId}`);
  await db.execute(
    sql`update employee set status = 'active', left_on = null, left_reason = null, updated_at = now(), updated_by = ${me.id}
      where person_id = ${personId}`,
  );
  await hrEvent(db, personId, me.id, "back", "Back at work");
}

/** HR moves someone to a vacant seat: a transfer, a promotion, a demotion or a lateral move, from
 *  a day (up to three months ahead), keeping their old seat too or not. The seat decides their
 *  work, team, boss and email ID from that day; what they sold stays with the seat they sold it
 *  from (each order keeps the email ID it was sold as). HR's trail writes the move. */
export async function movePerson(
  db: Database,
  me: Me,
  personId: number,
  input: { seatId: number; kind: MoveKind; startsOn?: string | null; keepOther?: boolean; reason?: string | null },
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "move people");
  if (!clean(input.reason)) throw new Refusal(400, "invalid", "Say why they move.", "reason");
  await fillSeat(
    db,
    me,
    input.seatId,
    { personId, keepOther: input.keepOther, reason: input.reason, startsOn: input.startsOn, moveKind: input.kind },
    HR_WRITE_ROLES,
  );
  // A position HR typed for the old seat would now be wrong: it follows the seat's title again
  // (the old one stays in the trail).
  if (!input.keepOther)
    await db.execute(
      sql`update employee set position = null, updated_at = now(), updated_by = ${me.id} where person_id = ${personId} and position is not null`,
    );
}

export async function markLeft(
  db: Database,
  me: Me,
  personId: number,
  input: { lastDay?: string | null; reason?: string | null },
): Promise<{ vacant: string[] }> {
  if (!clean(input.reason))
    throw new Refusal(400, "invalid", "Say why they left (resigned, end of contract…).", "reason");
  // personLeaves writes HR's trail line (also when the CEO or the Admin marks them in Teams & people).
  return personLeaves(db, me, personId, input, HR_WRITE_ROLES);
}
