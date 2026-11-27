// HR's reports (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov), on one contract the way
// ovio's reports are: each report says what it is asked for (a range of days, a day, a year, the
// days ahead) and gives typed columns, rows, a total row and the headline figures. The same result
// is shown on the screen, printed with the letterhead (prepared by, remarks, signatories), and
// downloaded as Excel. HR, the CEO and the Admin read them; a company filter narrows each to the
// people one company employs.

import { sql } from "drizzle-orm";
import type { CompanyCode } from "../companies";
import { ownCompanyCode } from "../companies/context";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { type Cell, workbook } from "../reports/xlsx";
import { letterheadOf } from "../settings/service";
import type {
  HrReport,
  HrReportColumn,
  HrReportKey,
  HrReportList,
  HrReportPeriod,
  HrReportValue,
  LeaveKind,
  Letterhead,
  Me,
} from "../types";
import { attendanceReport } from "./attendance";
import { balancesOf, KIND_WORDS, withDays } from "./leave";
import { OT_TYPES } from "./leave-rules";
import { HR_ROLES } from "./people";
import { dayWords } from "./print";

type Asked = HrReport["asked"];
type Built = Pick<HrReport, "columns" | "rows" | "totals" | "figures"> & { from?: string; to?: string };
type Report = {
  key: HrReportKey;
  title: string;
  what: string;
  group: string;
  period: HrReportPeriod;
  build: (db: Database, me: Me, asked: Asked) => Promise<Built>;
};

const col = (key: string, label: string, type: HrReportColumn["type"] = "text"): HrReportColumn => ({ key, label, type });
const short = (_code: string) => ownCompanyCode();
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const sum = (list: Record<string, HrReportValue>[], key: string) =>
  list.reduce((total, one) => total + (typeof one[key] === "number" ? (one[key] as number) : 0), 0);
const sums = (list: Record<string, HrReportValue>[], first: string, keys: string[]) => ({
  [first]: "Total",
  ...Object.fromEntries(keys.map((key) => [key, Math.round(sum(list, key) * 100) / 100])),
});
const co = (asked: Asked) => (asked.company ? sql`and e.company = ${asked.company}` : sql``);
/** Someone counts as staff on a day: hired by then and not gone (left on or before it). */
const staffOn = (day: string) =>
  sql`e.hire_date <= ${day}::date and (e.left_on is null or e.left_on > ${day}::date) and (p.active or e.left_on is not null)`;

const CLASSES = ["regular", "probationary", "part_time", "intern"] as const;
const CLASS_WORDS: Record<string, string> = { regular: "Regular", probationary: "Probationary", part_time: "Part-time", intern: "Intern" };

const REPORTS: Report[] = [
  {
    key: "headcount",
    title: "Headcount",
    what: "Everyone employed on a day, by company and department, by how they are employed.",
    group: "People",
    period: "day",
    build: async (db, _me, asked) => {
      const found = await rows<Record<string, HrReportValue>>(
        db,
        sql`select e.company, coalesce(nullif(trim(e.department), ''), 'No department') as department,
            ${sql.join(
              CLASSES.map((one) => sql`count(*) filter (where e.classification = ${one})::int as ${sql.identifier(one)}`),
              sql`, `,
            )}, count(*)::int as total
          from person p join employee e on e.person_id = p.id
          where p.role <> 'admin' and ${staffOn(asked.to)} ${co(asked)}
          group by 1, 2 order by 1, 2`,
      );
      const list: Record<string, HrReportValue>[] = found.map((one) => ({ ...one, company: short(String(one.company)) }));
      const total = sum(list, "total");
      return {
        columns: [col("company", "Company"), col("department", "Department"), ...CLASSES.map((one) => col(one, CLASS_WORDS[one] as string, "number")), col("total", "Total", "number")],
        rows: list,
        totals: { company: "Total", department: "", ...Object.fromEntries([...CLASSES, "total"].map((key) => [key, sum(list, key)])) },
        figures: [
          { label: "Headcount", value: String(total) },
          { label: "Regular", value: total ? `${Math.round((sum(list, "regular") / total) * 100)}%` : "—" },
          { label: "Departments", value: String(new Set(list.map((one) => one.department)).size) },
        ],
      };
    },
  },
  {
    key: "movement",
    title: "Joiners and leavers",
    what: "Who joined and who left in the period, with the reason given for leaving.",
    group: "People",
    period: "range",
    build: async (db, _me, asked) => {
      const found = await rows<Record<string, HrReportValue>>(
        db,
        sql`select * from (
            select to_char(e.hire_date, 'YYYY-MM-DD') as day, 'Joined' as movement, p.name, e.employee_code as "employeeCode",
              e.company, coalesce(e.position, p.title) as position, e.department, null as reason
            from person p join employee e on e.person_id = p.id
            where p.role <> 'admin' and e.hire_date between ${asked.from}::date and ${asked.to}::date ${co(asked)}
            union all
            select to_char(e.left_on, 'YYYY-MM-DD'), 'Left', p.name, e.employee_code, e.company, coalesce(e.position, p.title),
              e.department, e.left_reason
            from person p join employee e on e.person_id = p.id
            where p.role <> 'admin' and e.left_on between ${asked.from}::date and ${asked.to}::date ${co(asked)}
          ) moves order by day, name`,
      );
      const joined = found.filter((one) => one.movement === "Joined").length;
      const left = found.length - joined;
      return {
        columns: [
          col("day", "Day", "date"),
          col("movement", "Joined / left"),
          col("name", "Name"),
          col("employeeCode", "Employee ID"),
          col("company", "Company"),
          col("position", "Position"),
          col("department", "Department"),
          col("reason", "Reason for leaving"),
        ],
        rows: found.map((one) => ({ ...one, company: short(String(one.company)) })),
        totals: null,
        figures: [
          { label: "Joined", value: String(joined) },
          { label: "Left", value: String(left) },
          { label: "Net", value: `${joined - left >= 0 ? "+" : ""}${joined - left}` },
        ],
      };
    },
  },
  {
    key: "attrition",
    title: "Attrition by month",
    what: "Each month's headcount at the start and the end, who joined, who left, and the share who left (leavers over the month's average headcount).",
    group: "People",
    period: "range",
    build: async (db, _me, asked) => {
      const found = await rows<{ month: string; start: number; joined: number; left: number; end: number }>(
        db,
        sql`with months as (
            select generate_series(date_trunc('month', ${asked.from}::date), date_trunc('month', ${asked.to}::date), interval '1 month')::date as m),
          staff as (select e.hire_date, e.left_on from person p join employee e on e.person_id = p.id
            where p.role <> 'admin' and (p.active or e.left_on is not null) ${co(asked)})
          select to_char(m, 'YYYY-MM') as month,
            (select count(*) from staff where hire_date < m and (left_on is null or left_on >= m))::int as start,
            (select count(*) from staff where hire_date >= m and hire_date < m + interval '1 month')::int as joined,
            (select count(*) from staff where left_on >= m and left_on < m + interval '1 month')::int as left,
            (select count(*) from staff where hire_date < m + interval '1 month'
              and (left_on is null or left_on >= m + interval '1 month'))::int as end
          from months order by m`,
      );
      const list = found.map((one) => {
        const average = (one.start + one.end) / 2;
        return { ...one, rate: average ? Math.round((one.left / average) * 1000) / 10 : 0 };
      });
      const left = sum(list, "left");
      const average = list.length ? list.reduce((total, one) => total + (one.start + one.end) / 2, 0) / list.length : 0;
      return {
        columns: [
          col("month", "Month"),
          col("start", "At the start", "number"),
          col("joined", "Joined", "number"),
          col("left", "Left", "number"),
          col("end", "At the end", "number"),
          col("rate", "Attrition %", "percent"),
        ],
        rows: list,
        totals: { month: "Total", start: list[0]?.start ?? 0, joined: sum(list, "joined"), left, end: list.at(-1)?.end ?? 0, rate: average ? Math.round((left / average) * 1000) / 10 : 0 },
        figures: [
          { label: "Left in the period", value: String(left) },
          { label: "Attrition", value: average ? `${Math.round((left / average) * 1000) / 10}%` : "—" },
        ],
      };
    },
  },
  {
    key: "attendance",
    title: "Late, absent and hours",
    what: "Each person's working days in the period: days in, absent, on leave, late, undertime, overtime and hours worked (the attendance report, for Excel and print).",
    group: "Time",
    period: "range",
    build: async (db, me, asked) => {
      const report = await attendanceReport(db, me, { from: asked.from, to: asked.to });
      const companies = new Map(
        (await rows<{ id: number; company: string }>(db, sql`select person_id::int as id, company from employee`)).map((one) => [one.id, one.company]),
      );
      const list = report.people
        .filter((one) => !asked.company || companies.get(one.personId) === asked.company)
        .map((one) => ({
          name: one.name,
          team: one.team,
          company: short(companies.get(one.personId) ?? ""),
          workDays: one.workDays,
          present: one.present,
          absent: one.absent,
          leaveDays: one.leaveDays,
          lateDays: one.lateDays,
          lateHours: hours(one.lateMinutes),
          undertimeHours: hours(one.undertimeMinutes),
          overtimeHours: hours(one.overtimeMinutes),
          workedHours: hours(one.workedMinutes),
        }));
      const numbers = ["workDays", "present", "absent", "leaveDays", "lateDays", "lateHours", "undertimeHours", "overtimeHours", "workedHours"];
      return {
        from: report.from,
        to: report.to,
        columns: [
          col("name", "Name"),
          col("team", "Team"),
          col("company", "Company"),
          col("workDays", "Working days", "number"),
          col("present", "Days in", "number"),
          col("absent", "Absent", "number"),
          col("leaveDays", "On leave", "number"),
          col("lateDays", "Days late", "number"),
          col("lateHours", "Late (hours)", "hours"),
          col("undertimeHours", "Undertime (hours)", "hours"),
          col("overtimeHours", "Overtime (hours)", "hours"),
          col("workedHours", "Hours worked", "hours"),
        ],
        rows: list,
        totals: { ...sums(list, "name", numbers), team: "", company: "" },
        figures: [
          { label: "People", value: String(list.length) },
          { label: "Absent days", value: String(sum(list, "absent")) },
          { label: "Late days", value: String(sum(list, "lateDays")) },
        ],
      };
    },
  },
  {
    key: "leave-balances",
    title: "Leave balances",
    what: "Each person's vacation and sick leave for the year: the days given (with HR's adjustments), used, waiting for approval and left; leave without pay used.",
    group: "Leave and forms",
    period: "year",
    build: async (db, _me, asked) => {
      const people = await rows<{ personId: number; name: string; employeeCode: string | null; company: string; classification: string }>(
        db,
        sql`select p.id::int as "personId", p.name, e.employee_code as "employeeCode", e.company, e.classification
          from person p join employee e on e.person_id = p.id where p.active and p.role <> 'admin' ${co(asked)} order by p.name`,
      );
      const list: Record<string, HrReportValue>[] = [];
      for (const one of people) {
        const left = await balancesOf(db, one.personId, asked.year, one.classification as never);
        list.push({
          name: one.name,
          employeeCode: one.employeeCode,
          company: short(one.company),
          classification: CLASS_WORDS[one.classification] ?? one.classification,
          vlGiven: left.vl.allotted,
          vlUsed: left.vl.used,
          vlAsked: left.vl.asked,
          vlLeft: left.vl.left,
          slGiven: left.sl.allotted,
          slUsed: left.sl.used,
          slLeft: left.sl.left,
          lwop: left.lwop.used,
        });
      }
      const numbers = ["vlGiven", "vlUsed", "vlAsked", "vlLeft", "slGiven", "slUsed", "slLeft", "lwop"];
      return {
        columns: [
          col("name", "Name"),
          col("employeeCode", "Employee ID"),
          col("company", "Company"),
          col("classification", "Employment"),
          col("vlGiven", "VL given", "number"),
          col("vlUsed", "VL used", "number"),
          col("vlAsked", "VL waiting", "number"),
          col("vlLeft", "VL left", "number"),
          col("slGiven", "SL given", "number"),
          col("slUsed", "SL used", "number"),
          col("slLeft", "SL left", "number"),
          col("lwop", "Without pay", "number"),
        ],
        rows: list,
        totals: { ...sums(list, "name", numbers), employeeCode: "", company: "", classification: "" },
        figures: [
          { label: "VL left, everyone", value: String(sum(list, "vlLeft")) },
          { label: "SL left, everyone", value: String(sum(list, "slLeft")) },
        ],
      };
    },
  },
  {
    key: "leave-taken",
    title: "Leave taken",
    what: "Every approved leave that falls in the period, with its working days.",
    group: "Leave and forms",
    period: "range",
    build: async (db, _me, asked) => {
      const found = await rows<{ personId: number; name: string; company: string; kind: LeaveKind; from: string; to: string; halfDay: boolean; reason: string | null }>(
        db,
        sql`select l.person_id::int as "personId", p.name, e.company, l.kind, to_char(l.from_day, 'YYYY-MM-DD') as "from",
            to_char(l.to_day, 'YYYY-MM-DD') as "to", l.half_day as "halfDay", l.reason
          from person_leave l join person p on p.id = l.person_id join employee e on e.person_id = p.id
          where l.status = 'approved' and l.from_day <= ${asked.to}::date and l.to_day >= ${asked.from}::date ${co(asked)}
          order by l.from_day, p.name`,
      );
      const counted = await withDays(db, found);
      const list = counted.map((one) => ({
        from: one.from,
        to: one.to,
        name: one.name,
        company: short(one.company),
        kind: (KIND_WORDS[one.kind] ?? one.kind).replace(/^./, (c) => c.toUpperCase()),
        days: one.days,
        reason: one.reason,
      }));
      const byKind = (kind: LeaveKind) => counted.filter((one) => one.kind === kind).reduce((total, one) => total + one.days, 0);
      return {
        columns: [col("from", "From", "date"), col("to", "To", "date"), col("name", "Name"), col("company", "Company"), col("kind", "Kind"), col("days", "Working days", "number"), col("reason", "Reason")],
        rows: list,
        totals: { from: "Total", to: "", name: "", company: "", kind: "", days: sum(list, "days"), reason: "" },
        figures: [
          { label: "Vacation", value: `${byKind("vl")} days` },
          { label: "Sick", value: `${byKind("sl")} days` },
          { label: "Without pay", value: `${byKind("lwop")} days` },
        ],
      };
    },
  },
  {
    key: "overtime",
    title: "Overtime",
    what: "Approved overtime in the period: the kind of day, the hours and the night-differential hours (10 PM to 6 AM).",
    group: "Time",
    period: "range",
    build: async (db, _me, asked) => {
      const found = await rows<{ day: string; name: string; company: string; type: keyof typeof OT_TYPES | null; minutes: number; night: number }>(
        db,
        sql`select to_char(f.day, 'YYYY-MM-DD') as day, p.name, e.company, f.ot_type as type, coalesce(f.ot_minutes, 0)::int as minutes,
            coalesce(f.ot_night_minutes, 0)::int as night
          from hr_form f join person p on p.id = f.person_id join employee e on e.person_id = p.id
          where f.kind = 'ot' and f.status = 'approved' and f.day between ${asked.from}::date and ${asked.to}::date ${co(asked)}
          order by f.day, p.name`,
      );
      const list = found.map((one) => ({
        day: one.day,
        name: one.name,
        company: short(one.company),
        type: one.type ? OT_TYPES[one.type] : "",
        hours: hours(one.minutes),
        night: hours(one.night),
      }));
      return {
        columns: [col("day", "Day", "date"), col("name", "Name"), col("company", "Company"), col("type", "Kind of day"), col("hours", "Hours", "hours"), col("night", "Of which night", "hours")],
        rows: list,
        totals: { ...sums(list, "day", ["hours", "night"]), name: "", company: "", type: "" },
        figures: [
          { label: "Overtime hours", value: String(sum(list, "hours")) },
          { label: "People", value: String(new Set(list.map((one) => one.name)).size) },
        ],
      };
    },
  },
  {
    key: "forms",
    title: "Leave and forms filed",
    what: "How many leave requests and forms were filed for days in the period, by kind and by what became of them.",
    group: "Leave and forms",
    period: "range",
    build: async (db, _me, asked) => {
      const found = await rows<{ kind: string; status: string; n: number }>(
        db,
        sql`select 'leave' as kind, l.status, count(*)::int as n from person_leave l join employee e on e.person_id = l.person_id
            where l.from_day between ${asked.from}::date and ${asked.to}::date ${co(asked)} group by 2
          union all
          select f.kind, f.status, count(*)::int from hr_form f join employee e on e.person_id = f.person_id
            where f.day between ${asked.from}::date and ${asked.to}::date ${co(asked)} group by 1, 2`,
      );
      const WORDS: Record<string, string> = {
        leave: "Leave",
        ob: "Official business",
        wfh: "Work from home",
        ot: "Overtime",
        eod: "Daily accomplishment report",
        incident: "Incident report",
      };
      const statuses = ["asked", "approved", "refused", "returned", "cancelled", "revoked"];
      const list = Object.keys(WORDS).map((kind) => {
        const row: Record<string, HrReportValue> = { kind: WORDS[kind] as string };
        for (const status of statuses) row[status] = found.filter((one) => one.kind === kind && one.status === status).reduce((t, one) => t + one.n, 0);
        row.total = statuses.reduce((t, status) => t + (row[status] as number), 0);
        return row;
      });
      return {
        columns: [
          col("kind", "Kind"),
          col("asked", "Waiting", "number"),
          col("approved", "Approved", "number"),
          col("refused", "Refused", "number"),
          col("returned", "Returned to fix", "number"),
          col("cancelled", "Cancelled", "number"),
          col("revoked", "Revoked", "number"),
          col("total", "Total", "number"),
        ],
        rows: list,
        totals: sums(list, "kind", [...statuses, "total"]),
        figures: [
          { label: "Filed", value: String(sum(list, "total")) },
          { label: "Still waiting", value: String(sum(list, "asked")) },
        ],
      };
    },
  },
  {
    key: "due-soon",
    title: "Due soon",
    what: "What comes up in the days ahead: probation reviews (month 3 and 5), regularization (month 6), birthdays and work anniversaries.",
    group: "People",
    period: "ahead",
    build: async (db, _me, asked) => {
      const people = await rows<{ name: string; position: string | null; company: string; classification: string; hire: string; birth: string | null }>(
        db,
        sql`select p.name, coalesce(e.position, p.title) as position, e.company, e.classification,
            to_char(e.hire_date, 'YYYY-MM-DD') as hire, to_char(e.birth_date, 'YYYY-MM-DD') as birth
          from person p join employee e on e.person_id = p.id where p.active and p.role <> 'admin' ${co(asked)}`,
      );
      const from = todayManila();
      const to = addDays(from, asked.days);
      const months = (day: string, by: number) => {
        const [y, m, d] = day.split("-").map(Number) as [number, number, number];
        const at = new Date(Date.UTC(y, m - 1 + by, 1));
        const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
        return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
      };
      /** The next time a day's month and day come round, on or after today. */
      const next = (day: string) => {
        const year = Number(from.slice(0, 4));
        for (const y of [year, year + 1]) {
          const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
          const md = day.slice(5) === "02-29" && !leap ? "02-28" : day.slice(5);
          if (`${y}-${md}` >= from) return `${y}-${md}`;
        }
        return null;
      };
      const list: Record<string, HrReportValue>[] = [];
      const add = (day: string | null, what: string, one: (typeof people)[number]) => {
        if (day && day >= from && day <= to) list.push({ day, what, name: one.name, position: one.position, company: short(one.company) });
      };
      for (const one of people) {
        if (one.classification === "probationary") {
          add(months(one.hire, 3), "Probation review (month 3)", one);
          add(months(one.hire, 5), "Probation review (month 5)", one);
          add(months(one.hire, 6), "Regularization due (month 6)", one);
        }
        if (one.birth) add(next(one.birth), "Birthday", one);
        const anniversary = next(one.hire);
        if (anniversary && anniversary > one.hire) {
          const years = Number(anniversary.slice(0, 4)) - Number(one.hire.slice(0, 4));
          add(anniversary, `${years} year${years === 1 ? "" : "s"} with the company`, one);
        }
      }
      list.sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.name).localeCompare(String(b.name)));
      const count = (word: RegExp) => list.filter((one) => word.test(String(one.what))).length;
      return {
        from,
        to,
        columns: [col("day", "Day", "date"), col("what", "What"), col("name", "Name"), col("position", "Position"), col("company", "Company")],
        rows: list,
        totals: null,
        figures: [
          { label: "Probation and regularization", value: String(count(/Probation|Regularization/)) },
          { label: "Birthdays", value: String(count(/Birthday/)) },
          { label: "Anniversaries", value: String(count(/with the company/)) },
        ],
      };
    },
  },
  {
    key: "missing",
    title: "Missing details",
    what: "Everyone whose record lacks what HR and payroll need: employee ID, SSS, PhilHealth, Pag-IBIG, TIN (unless exempt), birth date, mobile, emergency contact, bank account.",
    group: "People",
    period: "day",
    build: async (db, _me, asked) => {
      const found = await rows<{ name: string; employeeCode: string | null; company: string; missing: string[] }>(
        db,
        sql`select p.name, e.employee_code as "employeeCode", e.company, array_remove(array[
            case when e.employee_code is null then 'Employee ID' end,
            case when e.sss is null and not e.no_sss then 'SSS' end,
            case when e.philhealth is null and not e.no_philhealth then 'PhilHealth' end,
            case when e.pagibig is null and not e.no_pagibig then 'Pag-IBIG' end,
            case when e.tin is null and not e.no_tax then 'TIN' end,
            case when e.birth_date is null then 'Birth date' end,
            case when e.mobile is null then 'Mobile' end,
            case when e.emergency_name is null or e.emergency_phone is null then 'Emergency contact' end,
            case when e.bank_account is null then 'Bank account' end
          ], null) as missing
          from person p join employee e on e.person_id = p.id where p.active and p.role <> 'admin' ${co(asked)} order by p.name`,
      );
      const gaps = found.filter((one) => one.missing.length);
      return {
        columns: [col("name", "Name"), col("employeeCode", "Employee ID"), col("company", "Company"), col("count", "Missing", "number"), col("missing", "What is missing")],
        rows: gaps.map((one) => ({ name: one.name, employeeCode: one.employeeCode, company: short(one.company), count: one.missing.length, missing: one.missing.join(", ") })),
        totals: null,
        figures: [
          { label: "Records with gaps", value: String(gaps.length) },
          { label: "Complete", value: String(found.length - gaps.length) },
        ],
      };
    },
  },
];

/** The reports HR may open, grouped. */
export function reportList(me: Me): HrReportList {
  allow(me, HR_ROLES, "see HR's reports");
  return { reports: REPORTS.map(({ key, title, what, group, period }) => ({ key, title, what, group, period })) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const words = (day: string) => dayWords(day).replace(/^\w+, /, "");

/** One report, run for what it is asked. */
export async function runReport(
  db: Database,
  me: Me,
  key: string,
  query: { from?: string | null; to?: string | null; year?: string | null; days?: string | null; company?: string | null },
): Promise<HrReport> {
  allow(me, HR_ROLES, "see HR's reports");
  const report = REPORTS.find((one) => one.key === key);
  if (!report) throw new Refusal(404, "not_found", "No such report.");
  const today = todayManila();
  let to = query.to && DAY.test(query.to) ? query.to : today;
  let from = query.from && DAY.test(query.from) ? query.from : `${today.slice(0, 7)}-01`;
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -731)) from = addDays(to, -731);
  const year = Number(query.year) > 2000 && Number(query.year) < 2100 ? Number(query.year) : Number(today.slice(0, 4));
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 366);
  // One company per database since the separation (26 Nov night): no company to filter by.
  const company: CompanyCode | null = null;
  const asked: Asked = { from, to, year, days, company };
  const built = await report.build(db, me, asked);
  const shownFrom = built.from ?? from;
  const shownTo = built.to ?? to;
  const periodWords =
    report.period === "range"
      ? `${words(shownFrom)} to ${words(shownTo)}`
      : report.period === "day"
        ? `As of ${words(to)}`
        : report.period === "year"
          ? String(year)
          : `${words(shownFrom)} to ${words(shownTo)} (the next ${days} days)`;
  const letterhead: Letterhead = await letterheadOf(db);
  return {
    key: report.key,
    title: report.title,
    what: report.what,
    period: report.period,
    periodWords,
    asked: { ...asked, from: shownFrom, to: shownTo },
    columns: built.columns,
    rows: built.rows,
    totals: built.totals,
    figures: built.figures,
    letterhead,
    preparedBy: me.name,
    preparedAt: new Date().toISOString(),
  };
}

/** The same report as an Excel workbook: the title, the period, who prepared it, the table, the total. */
export function reportWorkbook(report: HrReport): Buffer {
  const cell = (value: HrReportValue, type: HrReportColumn["type"], total = false): Cell => {
    if (value === null || value === undefined) return "";
    if (typeof value !== "number") return total ? { v: value, s: "totalName" } : value;
    if (type === "hours" || type === "percent" || type === "money") return { v: value, s: total ? "totalMoney" : "money" };
    return { v: value, s: total ? "totalInt" : "int" };
  };
  const out: Cell[][] = [
    [{ v: `${report.title} · ${report.letterhead.name}`, s: "title" }],
    [report.periodWords],
    [`Prepared by ${report.preparedBy} on ${words(todayManila())}`],
    [report.figures.map((one) => `${one.label}: ${one.value}`).join("   ·   ")],
    [],
    report.columns.map((column) => ({ v: column.label, s: "head" })),
    ...report.rows.map((row) => report.columns.map((column) => cell(row[column.key] ?? null, column.type))),
  ];
  if (report.totals) out.push(report.columns.map((column) => cell(report.totals?.[column.key] ?? null, column.type, true)));
  return workbook([
    { name: report.title, rows: out, widths: report.columns.map((column) => (column.type === "text" ? 24 : 14)) },
  ]);
}
