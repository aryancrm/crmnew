import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { sql } from "drizzle-orm";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { CustomerDetail, CustomerList, CustomerMatch, CustomerPage, Me, MyArea } from "../types";
import { phoneKey } from "./service";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const list = async (who: string, query = "") =>
  (await (await get(who, `/api/customers${query}`)).json()) as CustomerList;
const page = async (who: string, id: number) =>
  (await (await get(who, `/api/customers/${id}`)).json()) as CustomerDetail;
const names = (result: CustomerList) => result.rows.map((row) => row.name);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "vanessa", "sarla", "marco", "jane"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (who: string, key: string, body: object) => {
    const response = await post(who, "/api/customers", body);
    if (response.status !== 200)
      throw new Error(`${key}: ${JSON.stringify(await response.json())}`);
    ids[key] = (await response.json()).id;
  };
  // Management adds: a hospital in Ryan's area (found by its city), one far away, a patient.
  await add("sarla", "sanjuan", {
    kind: "hospital",
    name: "San Juan de Dios Hospital",
    city: "Pasay",
    phone: "(02) 8831 9731",
  });
  await add("sarla", "davao", {
    kind: "hospital",
    name: "Davao Doctors Hospital",
    city: "Davao City",
  });
  await add("jane", "rosario", {
    kind: "patient",
    name: "Rosario Santos",
    phone: "0917 555 0142",
    city: "Las Piñas",
  });
});

describe("customer numbers", () => {
  it("every customer has one, however it was added (26 Nov: the page showed a blank one)", async () => {
    const [made] = await rows<{ id: number; code: string | null }>(
      db,
      sql`insert into customer (name, kind, added_by) values ('Walk-in Test', 'patient', (select id from person limit 1)) returning id::int as id, code`,
    );
    expect(made?.code).toBe(`CUS-${String(made?.id).padStart(5, "0")}`);
    const [empty] = await rows<{ n: number }>(db, sql`select count(*)::int as n from customer where code is null or code = ''`);
    expect(empty?.n).toBe(0);
    // Only this test's row (the lists below count the demo's customers).
    await db.execute(sql`delete from customer where id = ${made?.id}`);
  });
});

describe("phone numbers", () => {
  it("are one number however they are typed", () => {
    expect(phoneKey("0917 555 0142")).toBe("9175550142");
    expect(phoneKey("+63 917 555 0142")).toBe("9175550142");
    expect(phoneKey("639175550142")).toBe("9175550142");
    expect(phoneKey("12")).toBeNull();
  });
});

describe("who sees which customers", () => {
  it("gives a MedRep the customers of their own area", async () => {
    const me = (await (await get("ryan", "/api/me")).json()).me as Me;
    expect(me.area?.id).toBeGreaterThan(0);
    // San Juan was put in Ryan's area by its city; the patient in Las Piñas too. Davao isn't his.
    expect(names(await list("ryan")).sort()).toEqual([
      "Rosario Santos",
      "San Juan de Dios Hospital",
    ]);
    expect((await page("ryan", ids.sanjuan as number)).customer).toMatchObject({
      area: "HOS | Pasay",
      medrep: "Ryan",
      channel: "HOSP",
    });
    expect((await get("ryan", `/api/customers/${ids.davao}`)).status).toBe(404);
  });

  it("gives a team lead and a manager their people's, and the office everything", async () => {
    expect(names(await list("daniel"))).toContain("San Juan de Dios Hospital");
    expect(names(await list("daniel"))).not.toContain("Davao Doctors Hospital");
    expect(names(await list("vanessa"))).toContain("San Juan de Dios Hospital");
    expect((await list("sarla")).total).toBe(3);
    expect((await list("marco")).total).toBe(3);
    expect((await list("sarla")).counts).toEqual({ hospital: 2, patient: 1 });
  });

  it("answers in a handful of queries, searched and paged on the server", async () => {
    const response = await get("ryan", "/api/customers?kind=hospital&q=juan%20pasay");
    // The page, its count, the kinds, who looks after them and the kind's figures: read at once.
    expect(
      Number(/"(\d+) queries"/.exec(response.headers.get("server-timing") ?? "")?.[1]),
    ).toBeLessThanOrEqual(6);
    const result = (await response.json()) as CustomerList;
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(names(await list("sarla", "?q=0142"))).toEqual(["Rosario Santos"]);
    expect((await list("sarla", "?q=nobody-here")).total).toBe(0);
    expect((await list("sarla", "?page=2")).rows).toEqual([]);
  });

  it("says who looks after the listed customers, and narrows to one of them", async () => {
    const all = await list("sarla");
    const counted = all.byRep.reduce((sum, rep) => sum + rep.count, all.unassigned);
    expect(counted).toBe(all.total);
    expect(all.summary.all).toBe(all.total);
    const ryan = all.byRep.find((rep) => rep.name === "Ryan");
    expect(ryan).toMatchObject({ channel: "HOSP", area: "HOS | Pasay" });
    const his = await list("sarla", `?medrep=${ryan?.id}`);
    expect(his.total).toBe(ryan?.count);
    expect(his.rows.every((row) => row.medrep === "Ryan")).toBe(true);
    expect(his.byRep).toEqual(all.byRep);
  });
});

describe("adding a customer", () => {
  it("from the field: theirs at once, in their area, waiting for review", async () => {
    const made = await post("ryan", "/api/customers", {
      kind: "doctor",
      name: "Dr. Marco Reyes",
      city: "Makati",
      specialty: "Oncology",
      worksAt: ids.sanjuan,
      phone: "0918 222 3344",
      licenceNo: "0456789",
      // A MedRep can't set terms or credit: these are ignored.
      paymentTerms: "days",
      paymentDays: 60,
      creditLimit: 99_000_00,
    });
    expect(made.status).toBe(200);
    const doctor = (await page("ryan", (await made.json()).id)).customer;
    expect(doctor).toMatchObject({
      kind: "doctor",
      area: "HOS | Pasay",
      worksAt: "San Juan de Dios Hospital",
      review: "to_review",
      addedBy: "Ryan",
      paymentTerms: "advance",
      paymentDays: null,
      creditLimit: null,
    });
    expect(doctor.code).toMatch(/^CUS-\d{5}$/);
    ids.reyes = doctor.id;
    expect((await page("sarla", ids.sanjuan as number)).doctors).toMatchObject([
      { name: "Dr. Marco Reyes", specialty: "Oncology" },
    ]);
    expect((await (await get("ryan", "/api/my/area")).json()) as MyArea).toMatchObject({
      area: { name: "HOS | Pasay", channel: "HOSP" },
      counts: { hospital: 1, doctor: 1, patient: 1 },
      // The doctor he just added, and the patient the Online desk added.
      toReview: 2,
    });
  });

  it("knows a doctor by their PRC licence number: one doctor, one entry (27 Nov)", async () => {
    const doctor = (body: Record<string, unknown>) => post("ryan", "/api/customers", { kind: "doctor", city: "Pasay", ...body });
    // No PRC number: not added.
    const none = await doctor({ name: "Dr. Lea Uy" });
    expect(none.status).toBe(400);
    expect((await none.json()).error.field).toBe("licenceNo");
    // Dr. Marco Reyes's number typed another way ("PRC 0456789" is 456789): refused, named.
    const again = await doctor({ name: "Dr. M. Reyes", licenceNo: "PRC 456789" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatchObject({ field: "licenceNo", message: expect.stringMatching(/^That PRC licence number is already Dr\. Marco Reyes \(CUS-\d{5}\)/) });
    // "Dr." is a title: "Marco Reyes" in Makati is the doctor already there.
    const title = await doctor({ name: "Marco Reyes", city: "Makati", licenceNo: "0999111" });
    expect(title.status).toBe(409);
    expect((await title.json()).error.field).toBe("name");
    // The form shows the doctor already on file as soon as the number is typed.
    const found = (await (await get("ryan", "/api/customers/check?kind=doctor&licence=0456789")).json()) as { matches: CustomerMatch[] };
    expect(found.matches[0]).toMatchObject({ name: "Dr. Marco Reyes", why: "licence" });
    // Another doctor's number can't be given to a doctor already on file either (Management adds
    // this one, so nothing is left waiting for review).
    const other = await post("sarla", "/api/customers", { kind: "doctor", name: "Dr. Lea Uy", city: "Pasay", licenceNo: "0777123" });
    expect(other.status).toBe(200);
    const id = (await other.json()).id as number;
    const taken = await post("sarla", `/api/customers/${id}`, { kind: "doctor", name: "Dr. Lea Uy", city: "Pasay", licenceNo: "456789" });
    expect(taken.status).toBe(409);
  });

  it("takes a hospital from the field only with its licence, then its three papers (the hub's form)", async () => {
    const bare = await post("ryan", "/api/customers", {
      kind: "hospital",
      name: "Pasay Licensed Hospital",
      city: "Pasay",
      phone: "0918 777 1212",
    });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.message).toContain("TIN, licence owner, LTO number");
    const made = await post("ryan", "/api/customers", {
      kind: "hospital",
      name: "Pasay Licensed Hospital",
      city: "Pasay",
      phone: "0918 777 1212",
      tin: "123-456-789-000",
      licenceOwner: "Dr. Ana Cruz",
      licenceNo: "LTO-3000-001",
      ltoType: "Hospital",
      licenceIssued: "2025-01-10",
      licenceExpires: "2028-01-10",
    });
    expect(made.status).toBe(200);
    const id = (await made.json()).id as number;
    const first = await page("sarla", id);
    expect(first.customer).toMatchObject({ licenceOwner: "Dr. Ana Cruz", ltoType: "Hospital", review: "to_review" });
    expect(first.missing).toEqual(["BIR 2303", "LTO permit", "Business permit"]);
    for (const kind of ["bir_2303", "lto_permit", "business_permit"]) {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", new File([new Uint8Array([37, 80, 68, 70, 45, 49])], `${kind}.pdf`, { type: "application/pdf" }));
      const sent = await app.request(`/api/customers/${id}/papers`, {
        method: "POST",
        headers: { cookie: cookies.ryan as string },
        body: form,
      });
      expect(sent.status).toBe(200);
    }
    const done = await page("sarla", id);
    expect(done.missing).toEqual([]);
    expect(done.papers.map((paper) => paper.kindLabel)).toEqual(["BIR 2303", "LTO permit", "Business permit"]);
    // Any other file too (26 Nov), without counting as one of the three papers; a made-up kind is refused.
    for (const [kind, status] of [["other", 200], ["passport_photo", 400]] as const) {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", new File([new Uint8Array([37, 80, 68, 70, 45, 49])], "letter.pdf", { type: "application/pdf" }));
      const sent = await app.request(`/api/customers/${id}/papers`, { method: "POST", headers: { cookie: cookies.ryan as string }, body: form });
      expect(sent.status, kind).toBe(status);
    }
    expect((await page("sarla", id)).missing).toEqual([]);
    const paper = await get("sarla", `/api/customer-papers/${done.papers[0]?.id}`);
    expect(paper.status).toBe(200);
    expect(paper.headers.get("content-type")).toBe("application/pdf");
    // Management may add a hospital and complete it later; a distributor may follow up its papers.
    expect(
      (await post("sarla", "/api/customers", { kind: "hospital", name: "Office Added Hospital", city: "Pasay" })).status,
    ).toBe(200);
    const distributor = await post("ryan", "/api/customers", {
      kind: "distributor",
      name: "Pasay Pharma Trading",
      city: "Pasay",
      phone: "0918 777 3434",
    });
    expect(distributor.status).toBe(200);
    const distributorId = (await distributor.json()).id as number;
    expect((await page("sarla", distributorId)).missing).toContain("BIR 2303");
    // Management checks both; the next tests count what waits for review.
    for (const one of [id, distributorId])
      expect((await post("sarla", `/api/customers/${one}/review`)).status).toBe(200);
  });

  it("is refused for a hospital already listed, naming who looks after it", async () => {
    const twin = await post("jane", "/api/customers", {
      kind: "hospital",
      name: "san juan de dios hospital",
      city: "PASAY",
    });
    expect(twin.status).toBe(409);
    expect((await twin.json()).error).toMatchObject({
      field: "name",
      message: "san juan de dios hospital in PASAY is already a customer, looked after by Ryan.",
    });
    expect(
      (await post("marco", "/api/customers", { kind: "patient", name: "Someone" })).status,
    ).toBe(403);
    const short = await post("ryan", "/api/customers", { kind: "patient", name: "A" });
    expect((await short.json()).error.field).toBe("name");
    const notHospital = await post("ryan", "/api/customers", {
      kind: "doctor",
      name: "Dr. Other",
      licenceNo: "0456790",
      worksAt: ids.rosario,
    });
    expect((await notHospital.json()).error.field).toBe("worksAt");
  });

  it("recognises an old customer by number or name, whoever looks after them", async () => {
    const check = async (who: string, query: string) =>
      (
        (await (await get(who, `/api/customers/check?${query}`)).json()) as {
          matches: CustomerMatch[];
        }
      ).matches;
    // The same number typed another way.
    expect(await check("ryan", "phone=%2B63917%20555%200142")).toMatchObject([
      { name: "Rosario Santos", kind: "patient", why: "phone", phone: "•••• 0142", mine: true },
    ]);
    // Davao isn't Ryan's: he learns it exists, not its details, and can't open it.
    expect(await check("ryan", "name=davao%20doc")).toMatchObject([
      { name: "Davao Doctors Hospital", why: "name", mine: false },
    ]);
    expect(await check("ryan", "name=da")).toEqual([]);
  });
});

describe("changing and reviewing", () => {
  it("lets the field fix contact details, and only Management set terms and area", async () => {
    const id = ids.reyes as number;
    const base = { kind: "doctor", name: "Dr. Marco Reyes", city: "Makati", worksAt: ids.sanjuan };
    expect(
      (
        await post("ryan", `/api/customers/${id}`, {
          ...base,
          phone: "0918 222 9999",
          paymentTerms: "days",
          paymentDays: 30,
        })
      ).status,
    ).toBe(200);
    expect((await page("ryan", id)).customer).toMatchObject({
      phone: "0918 222 9999",
      paymentTerms: "advance",
    });

    const noDays = await post("sarla", `/api/customers/${id}`, { ...base, paymentTerms: "days" });
    expect((await noDays.json()).error.field).toBe("paymentDays");
    expect(
      (
        await post("sarla", `/api/customers/${id}`, {
          ...base,
          areaId: null,
          paymentTerms: "days",
          paymentDays: 30,
          creditLimit: 500_000_00,
        })
      ).status,
    ).toBe(200);
    expect((await page("sarla", id)).customer).toMatchObject({
      paymentTerms: "days",
      paymentDays: 30,
      creditLimit: 500_000_00,
      area: null,
    });
    // Out of his area now, but he added it: still his to see.
    expect((await get("ryan", `/api/customers/${id}`)).status).toBe(200);
    // Someone else's customer can't be changed.
    expect(
      (await post("ryan", `/api/customers/${ids.davao}`, { kind: "hospital", name: "Hacked" }))
        .status,
    ).toBe(404);
  });

  it("is reviewed once, by Management", async () => {
    const id = ids.reyes as number;
    expect((await post("ryan", `/api/customers/${id}/review`)).status).toBe(403);
    expect((await post("sarla", `/api/customers/${id}/review`)).status).toBe(200);
    expect((await page("sarla", id)).customer).toMatchObject({ review: "ok", reviewedBy: "Sarla" });
    expect((await post("sarla", `/api/customers/${id}/review`)).status).toBe(409);
    expect(names(await list("sarla", "?review=1"))).toEqual(["Rosario Santos"]);
  });
});

describe("who looks after a customer (28 Nov)", () => {
  it("is whoever holds the seat of their territory today; a territory no seat holds keeps its MedRep", async () => {
    // Abe is still marked with Ryan's territory but holds no seat of it, as after a handover; before,
    // being first by name, he was the one shown.
    const [abe] = await rows<{ id: number }>(
      db,
      sql`insert into person (name, email, role, password_hash, area_id, channel_id)
        select 'Abe Former', 'abe.former@2mg.test', 'medrep', 'x', area_id, channel_id from person where email = 'ryan@2mg.test'
        returning id::int as id`,
    );
    const row = async (id: number, q: string) => (await list("sarla", `?q=${q}`)).rows.find((one) => one.id === id);
    // The list: Ryan holds the seat of "HOS | Pasay", under his lead, and the customer's HQ is Pasay.
    expect(await row(ids.sanjuan as number, "san%20juan")).toMatchObject({ medrep: "Ryan", manager: "Daniel", hq: "Pasay" });
    const all = await list("sarla");
    expect(all.byRep.map((rep) => rep.name)).not.toContain("Abe Former");
    const ryan = all.byRep.find((rep) => rep.name === "Ryan");
    expect((await list("sarla", `?medrep=${ryan?.id}`)).rows.every((one) => one.medrep === "Ryan")).toBe(true);
    // The page: looked after by Ryan and up his line; its HQ, the territory's name kept underneath.
    const shown = (await (await get("sarla", `/api/customers/${ids.sanjuan}/page`)).json()) as CustomerPage;
    expect(shown.line[0]?.name).toBe("Ryan");
    expect(shown.customer).toMatchObject({ medrep: "Ryan", hq: "Pasay", area: "HOS | Pasay" });

    // A territory no seat holds goes by its MedRep, as before.
    const [davao] = await rows<{ id: number }>(
      db,
      sql`insert into area (channel_id, name) select id, 'HOS | Davao' from channel where code = 'HOSP' returning id::int as id`,
    );
    await db.execute(sql`update person set area_id = ${davao?.id} where id = ${abe?.id}`);
    await db.execute(sql`update customer set area_id = ${davao?.id} where id = ${ids.davao}`);
    expect(await row(ids.davao as number, "davao")).toMatchObject({ medrep: "Abe Former", hq: "Davao" });
    const far = (await (await get("sarla", `/api/customers/${ids.davao}/page`)).json()) as CustomerPage;
    expect(far.line[0]?.name).toBe("Abe Former");
    // Put back as it was.
    await db.execute(sql`update customer set area_id = null where id = ${ids.davao}`);
    await db.execute(sql`update person set active = false where id = ${abe?.id}`);
  });
});

describe("a doctor's PRC licence number (28 Nov)", () => {
  it("finds the doctor in the list, typed with or without the zeros in front, and shows on their card", async () => {
    // Dr. Lea Uy, added above with PRC 0777123.
    for (const typed of ["0777123", "777123", "PRC-0777123"]) {
      const found = await list("sarla", `?kind=doctor&q=${encodeURIComponent(typed)}`);
      expect(names(found), typed).toEqual(["Dr. Lea Uy"]);
      expect(found.rows[0]?.prc).toBe("0777123");
    }
    // Only a doctor's: a hospital's licence number isn't searched or shown as one.
    expect((await list("sarla", "?q=3000001")).total).toBe(0);
    expect((await list("sarla", "?kind=hospital")).rows.every((one) => one.prc === null)).toBe(true);
  });
});
