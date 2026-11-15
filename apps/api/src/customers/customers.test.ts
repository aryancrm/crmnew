import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { CustomerDetail, CustomerList, CustomerMatch, Me, MyArea } from "../types";
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
