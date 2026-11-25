import { createSign, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedB2bTeam } from "../b2b/seed";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import { seedHospitalBoxes } from "../sellers/seed";
import type { FoundDetail, FoundList, Tender } from "../types";
import { agencyKey, agencyMatcher, dayIn, medicineMatcher, modeOf, moleculeName, strengthsOf } from "./finder";
import { ROBOT_AUDIENCE, useGithubKeys } from "./robot-caller";
import { seedBidding, seedFound } from "./seed";

const PASSWORD = "test-password-1";
const KEY = "robot-key-for-the-tests-0123456789";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
const robot = (path: string, body?: unknown, key: string | null = KEY) =>
  app.request(`/webhooks/tender-finder/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const list = async (who: string, query = "") => (await (await get(who, `/api/tenders/found${query}`)).json()) as FoundList;
const one = async (who: string, id: number) => (await (await get(who, `/api/tenders/found/${id}`)).json()) as FoundDetail;
const idOf = async (ref: string) => (await rows<{ id: number }>(db, sql`select id::int as id from tender_found where ref_no = ${ref}`))[0]?.id as number;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedB2bTeam(db, PASSWORD);
  await seedBidding(db, PASSWORD);
  await seedHospitalBoxes(db, PASSWORD);
  expect(await seedFound(db)).toBe(true);
  expect(await seedFound(db)).toBe(false);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jimmy", "hazel", "sam", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});
afterAll(() => {
  delete process.env.TENDER_FINDER_KEY;
  delete process.env.TENDER_FINDER_GITHUB;
});

describe("the tender finder: matching", () => {
  it("an agency is the customer of the same name, whatever the punctuation or the portal's suffix", () => {
    expect(agencyKey("Dr. Paulino J. Garcia Memorial Research & Medical Center")).toBe("DR PAULINO J GARCIA MEMORIAL RESEARCH AND MEDICAL CENTER");
    expect(agencyKey("Las Piñas General Hospital")).toBe("LAS PINAS GENERAL HOSPITAL");
    const match = agencyMatcher([
      { id: 1, name: "East Avenue Medical Center" },
      { id: 2, name: "Department of Health – Central Office" },
      { id: 3, name: "Vicente Sotto Memorial Medical Center" },
      { id: 4, name: "City Health Office" },
      { id: 5, name: "City Health Office" },
    ]);
    expect(match("EAST AVENUE MEDICAL CENTER")).toBe(1);
    expect(match("Department of Health - Central Office")).toBe(2);
    expect(match("VICENTE SOTTO MEMORIAL MEDICAL CENTER - REGION VII")).toBe(3);
    expect(match("Vicente Sotto Memorial Medical Center Pharmacy Division")).toBe(3);
    // Two customers of one name: nobody guesses.
    expect(match("City Health Office")).toBeNull();
    expect(match("Quirino Memorial Medical Center")).toBeNull();
    expect(match(null)).toBeNull();
  });

  it("a medicine's molecule: salts and brackets dropped", () => {
    expect(moleculeName("Imatinib mesylate")).toBe("Imatinib");
    expect(moleculeName("Abiraterone acetate")).toBe("Abiraterone");
    expect(moleculeName("Cefazolin (as sodium)")).toBe("Cefazolin");
    // Live's own spellings: whatever salt it comes as goes, the molecule stays.
    expect(moleculeName("Salbutamol (as sulfate)")).toBe("Salbutamol");
    expect(moleculeName("Clopidogrel (as bisulfate)")).toBe("Clopidogrel");
    expect(moleculeName("Dapagliflozin (as propanediol monohydrate)")).toBe("Dapagliflozin");
    expect(moleculeName("Hydrocortisone (As Sodium Succinate)")).toBe("Hydrocortisone");
    expect(moleculeName("Sitagliptin (as Monohydrate Phosphate) + Metformin Hydrochloride")).toBe("Sitagliptin + Metformin");
    expect(moleculeName("Bupivacaine Hydrochloride in dextrose")).toBe("Bupivacaine");
    expect(moleculeName("Iodine (as Iohexol)")).toBe("Iohexol");
    expect(moleculeName("Rocuronium [COLD CHAIN]*")).toBe("Rocuronium");
    expect(moleculeName("Sitagliptin + Metformin")).toBe("Sitagliptin + Metformin");
  });

  it("amounts compare whatever the unit they are written in", () => {
    expect(strengthsOf("Bortezomib 3.5 mg vial")).toEqual(["3500mcg"]);
    expect(strengthsOf("1 g")).toEqual(strengthsOf("1,000 mg"));
    expect(strengthsOf("0.5mg")).toEqual(strengthsOf("500 mcg"));
    expect(strengthsOf("100mg/10 mL")).toEqual(["100000mcg", "10ml"]);
    expect(strengthsOf("6000 tablet")).toEqual([]);
  });

  it("a line is our medicine by its molecule, then its strength; no single fit is left to a person", () => {
    const match = medicineMatcher([
      { id: 1, name: "Imatinib", generic: "Imatinib mesylate", strength: "400 mg" },
      { id: 2, name: "Imatinib", generic: "Imatinib mesylate", strength: "100 mg" },
      { id: 3, name: "Abiraterone", generic: "Abiraterone acetate", strength: "250 mg" },
      { id: 4, name: "Janumet", generic: "Sitagliptin + Metformin", strength: "50 mg/500 mg" },
      { id: 5, name: "Glucophage", generic: "Metformin", strength: "500 mg" },
      { id: 6, name: "Anastrozole", generic: "Anastrozole", strength: "1 mg" },
      { id: 7, name: "No generic", generic: null, strength: null },
    ]);
    expect(match("2 3000 tablet Imatinib 400 mg tablet 95.00")).toMatchObject({ molecules: ["Imatinib"], medicineId: 1 });
    expect(match("IMATINIB (as mesilate) 100mg capsule")).toMatchObject({ medicineId: 2 });
    // A strength we do not keep: ours by molecule, the medicine left to pick.
    expect(match("Imatinib 600 mg tablet")).toEqual({ molecules: ["Imatinib"], medicineId: null, candidates: [1, 2] });
    expect(match("Abiraterone Acetate 500 mg tablet")).toMatchObject({ molecules: ["Abiraterone"], medicineId: null, candidates: [3] });
    // No strength written and one medicine of that molecule: that one.
    expect(match("Abiraterone tablets")).toMatchObject({ medicineId: 3 });
    // A combination is the combination, not also its part; the part alone is the part.
    expect(match("Sitagliptin 50mg + Metformin 500mg tab")).toMatchObject({ molecules: ["Sitagliptin + Metformin"], medicineId: 4 });
    expect(match("Metformin 500 mg tablet")).toMatchObject({ molecules: ["Metformin"], medicineId: 5 });
    // Ours are kept as the concentration and the vial ("10mg/ml (50 mg/5 ml)"): the vial's amount
    // on the line is ours; the concentration alone settles it only when we keep one such medicine;
    // two brands of one strength are left to the person.
    const vials = medicineMatcher([
      { id: 11, name: "RocuGet", generic: "Rocuronium", strength: "10mg/ml (50 mg/5 ml)" },
      { id: 12, name: "DexmidoGet", generic: "Dexmedetomidine", strength: "100 mcg/1 ml" },
      { id: 13, name: "DexmidoGet", generic: "Dexmedetomidine (As Hydrochloride)", strength: "200 mcg/2 ml" },
      { id: 14, name: "Kontra", generic: "Sugammadex", strength: "100 mg/ml (200 mg/2 ml)" },
      { id: 15, name: "SugamaGet 200", generic: "Sugammadex", strength: "100 mg/ml (200 mg/2 ml)" },
    ]);
    expect(vials("Rocuronium bromide 50mg/5ml vial")).toMatchObject({ molecules: ["Rocuronium"], medicineId: 11 });
    expect(vials("Rocuronium 10 mg/mL, 5 mL vial")).toMatchObject({ medicineId: 11 });
    expect(vials("Rocuronium 100mg/10ml vial")).toMatchObject({ medicineId: null, candidates: [11] });
    expect(vials("Dexmedetomidine 200mcg/2mL vial")).toMatchObject({ medicineId: 13 });
    expect(vials("Dexmedetomidine 100 mcg/mL, 2 mL vial")).toMatchObject({ medicineId: null, candidates: [12, 13] });
    expect(vials("Sugammadex 200mg/2ml vial")).toMatchObject({ medicineId: null, candidates: [14, 15] });
    // An item kept under a form word, or a name of two or three letters, is not looked for.
    const items = medicineMatcher([
      { id: 21, name: "Syringe 3 mL", generic: "Syringe", strength: null },
      { id: 22, name: "Test", generic: "hb", strength: null },
      { id: 23, name: "Filgrastim", generic: "Filgrastim", strength: "300 mcg/0.5 mL" },
    ]);
    expect(items("Filgrastim 300mcg/0.5mL pre-filled syringe, HB 12")).toMatchObject({ molecules: ["Filgrastim"], medicineId: 23, candidates: [23] });
    // A spelling tenders use, and no match inside another word.
    expect(match("Anastrazole 1mg tab")).toMatchObject({ medicineId: 6 });
    expect(match("Paracetamol 500 mg and Dimetformine")).toEqual({ molecules: [], medicineId: null, candidates: [] });
  });

  it("the days and the mode a notice writes", () => {
    expect(dayIn("27/10/2026 2:00 PM")).toBe("2026-10-27");
    expect(dayIn("October 27, 2026 at 10:00am")).toBe("2026-10-27");
    expect(dayIn("28 OCTOBER 2026")).toBe("2026-10-28");
    expect(dayIn("to be announced")).toBeNull();
    expect(dayIn("31/02/2026")).toBeNull();
    expect(modeOf("Invitation to Bid (ITB)", "Public Bidding")).toBe("competitive_bidding");
    expect(modeOf("Request for Quotation (RFQ)", "Negotiated Procurement - Small Value Procurement (Sec. 53.9)")).toBe("small_value");
    expect(modeOf("Notice for Negotiated Procurement", null)).toBe("negotiated");
    expect(modeOf(null, null)).toBe("other");
  });
});

describe("the tender finder: the robot's door", () => {
  it("is shut with no way in on the server, and to a wrong key", async () => {
    process.env.TENDER_FINDER_GITHUB = "off";
    delete process.env.TENDER_FINDER_KEY;
    expect((await robot("molecules")).status).toBe(503);
    process.env.TENDER_FINDER_KEY = "short";
    expect((await robot("molecules")).status).toBe(503);
    process.env.TENDER_FINDER_KEY = KEY;
    expect((await robot("molecules", undefined, null)).status).toBe(401);
    expect((await robot("molecules", undefined, "robot-key-for-the-tests-0123456780")).status).toBe(401);
    expect((await robot("notices", { notices: [{ ref_no: "1", title: "x" }] }, "wrong")).status).toBe(401);
    expect((await robot("molecules")).status).toBe(200);
    // The key opens nothing else of the CRM.
    expect((await app.request("/api/tenders/found", { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(401);
  });

  it("lets in this repository's own GitHub workflow by GitHub's signature, and nothing that only looks like it", async () => {
    delete process.env.TENDER_FINDER_KEY;
    delete process.env.TENDER_FINDER_GITHUB;
    const github = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
    useGithubKeys(async () => [{ ...github.publicKey.export({ format: "jwk" }), kid: "key-1" }]);
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = (changes: Record<string, unknown> = {}, signer = github.privateKey, header: Record<string, unknown> = { alg: "RS256", kid: "key-1" }) => {
      const claims = {
        iss: "https://token.actions.githubusercontent.com",
        aud: ROBOT_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
        repository: "aryancrm/crmnew",
        ref: "refs/heads/main",
        job_workflow_ref: "aryancrm/crmnew/.github/workflows/tender-finder.yml@refs/heads/main",
        ...changes,
      };
      const signed = `${part(header)}.${part(claims)}`;
      return `${signed}.${createSign("RSA-SHA256").update(signed).sign(signer).toString("base64url")}`;
    };
    const status = async (bearer: string) => (await robot("molecules", undefined, bearer)).status;
    expect(await status(token())).toBe(200);
    expect((await robot("run", { status: "success", summary: "From the workflow", found: 1 }, token())).status).toBe(200);
    // Another repository (a fork), another branch, another workflow, a token made for something
    // else, an expired one, one signed by someone else, one not signed, an unknown key.
    expect(await status(token({ repository: "someone/crmnew", job_workflow_ref: "someone/crmnew/.github/workflows/tender-finder.yml@refs/heads/main" }))).toBe(401);
    expect(await status(token({ ref: "refs/heads/other", job_workflow_ref: "aryancrm/crmnew/.github/workflows/tender-finder.yml@refs/heads/other" }))).toBe(401);
    expect(await status(token({ ref: "refs/pull/7/merge" }))).toBe(401);
    expect(await status(token({ job_workflow_ref: "aryancrm/crmnew/.github/workflows/ci.yml@refs/heads/main" }))).toBe(401);
    // The keep-alive of the PS-PhilGEPS session is the robot's other workflow; on another branch it is not.
    expect(await status(token({ job_workflow_ref: "aryancrm/crmnew/.github/workflows/tender-finder-keepalive.yml@refs/heads/main" }))).toBe(200);
    expect(await status(token({ ref: "refs/heads/other", job_workflow_ref: "aryancrm/crmnew/.github/workflows/tender-finder-keepalive.yml@refs/heads/other" }))).toBe(401);
    expect(await status(token({ aud: "https://github.com/aryancrm" }))).toBe(401);
    expect(await status(token({ iss: "https://example.com" }))).toBe(401);
    expect(await status(token({ exp: Math.floor(Date.now() / 1000) - 5 }))).toBe(401);
    expect(await status(token({}, stranger.privateKey))).toBe(401);
    const unsigned = `${part({ alg: "none", kid: "key-1" })}.${token().split(".")[1]}.`;
    expect(await status(unsigned)).toBe(401);
    expect(await status(token({}, github.privateKey, { alg: "RS256", kid: "key-9" }))).toBe(401);
    expect(await status(token({}, github.privateKey, { alg: "HS256", kid: "key-1" }))).toBe(401);
    // Neither does it open anything else of the CRM, and switched off it lets nobody in.
    expect((await app.request("/api/tenders/found", { headers: { authorization: `Bearer ${token()}` } })).status).toBe(401);
    process.env.TENDER_FINDER_GITHUB = "off";
    expect(await status(token())).toBe(503);
    process.env.TENDER_FINDER_KEY = KEY;
    expect(await status(token())).toBe(401);
    expect((await robot("molecules")).status).toBe(200);
  });

  it("gives our molecules in the robot's own shape", async () => {
    const molecules = (await (await robot("molecules")).json()) as { name: string; match: string[] }[];
    expect(molecules.map((one) => one.name)).toEqual(["Abiraterone", "Anastrozole", "Bortezomib", "Capecitabine", "Imatinib", "Letrozole"]);
    expect(molecules.find((one) => one.name === "Anastrozole")?.match).toEqual(["anastrozole", "anastrazole"]);
  });

  it("takes notices in the robot's shape; one seen again is brought up to date, its lines written again only when they changed", async () => {
    const notice = {
      ref_no: "13000001",
      title: "Supply of Letrozole 2.5 mg Tablet",
      procuring_entity: "East Avenue Medical Center",
      publish_date: "2026-11-20",
      closing_date: "2099-12-01 13:00:00",
      abc_amount: 113980.5,
      detail_link: "https://notices.philgeps.gov.ph/GEPSNONPILOT/Tender/SplashBidNoticeAbstractUI.aspx?menuIndex=3&refID=13000001",
      items_text: "Description\n7 5000 tablet Letrozole 2.5 mg tablet 22.796 113,980.00",
      details: {
        notice_type: "Request for Quotation (RFQ)",
        matched_items: [{ line: "7 5000 tablet Letrozole 2.5 mg tablet 22.796 113,980.00", description: "Letrozole 2.5 mg tablet", item_no: "7", quantity: 5000, unit: "tablet", total: 113980 }],
        something_else: { big: "x".repeat(5000) },
      },
    };
    expect(await (await robot("notices", { notices: [notice] })).json()).toEqual({ taken: 1, fresh: 1, matched: 1 });
    const id = await idOf("13000001");
    const read = await one("hazel", id);
    expect(read.found).toMatchObject({
      source: "philgeps",
      agency: "East Avenue Medical Center",
      customer: "East Avenue Medical Center",
      abc: 11398050,
      publishedOn: "2026-11-20",
      closingAt: "2099-12-01T05:00:00Z",
      molecules: ["Letrozole"],
      open: true,
    });
    expect(read.found.link).toContain("refID=13000001");
    // The budget for one piece worked out from the line's total.
    expect(read.lines).toMatchObject([{ itemNo: "7", qty: 5000, unit: "tablet", abcTotal: 11398000, abcUnit: 2280, medicine: "Letrozole 2.5 mg" }]);
    const [kept] = await rows<{ details: Record<string, unknown> }>(db, sql`select details from tender_found where id = ${id}`);
    // What is kept of the details: the notice's facts and its own lines; nothing unknown.
    expect(Object.keys(kept?.details ?? {})).toEqual(["notice_type", "matched_items"]);

    // The robot asks what it has read already, and gets it back as it sent it.
    const known = (await (await robot("known", { refs: ["13000001", "99999999"] })).json()) as { ref_no: string; abc_amount: number; items_text: string }[];
    expect(known).toMatchObject([{ ref_no: "13000001", abc_amount: 113980.5 }]);

    // Seen again from the list only (no page read): nothing of it is lost.
    expect(await (await robot("notices", { notices: [{ ref_no: "13000001", title: notice.title, closing_date: "2099-12-05 13:00:00" }] })).json()).toMatchObject({ fresh: 0, matched: 1 });
    const again = await one("hazel", id);
    expect(again.found).toMatchObject({ abc: 11398050, closingAt: "2099-12-05T05:00:00Z", customer: "East Avenue Medical Center" });
    expect(again.lines.length).toBe(1);
    // Read again unchanged: the same lines. Changed (a bid bulletin): the new ones, the old kept.
    await robot("notices", { notices: [notice] });
    const count = async () => (await rows<{ live: number; replaced: number }>(db, sql`select count(*) filter (where replaced_at is null)::int as live, count(*) filter (where replaced_at is not null)::int as replaced from tender_found_line where found_id = ${id}`))[0];
    expect(await count()).toEqual({ live: 1, replaced: 0 });
    const changed = { ...notice, details: { ...notice.details, matched_items: [{ ...notice.details.matched_items[0], quantity: 6000 }] } };
    await robot("notices", { notices: [changed] });
    expect(await count()).toEqual({ live: 1, replaced: 1 });
    expect((await one("hazel", id)).lines[0]?.qty).toBe(6000);

    // A link that is not the portal's is not kept; a wrong shape is refused.
    await robot("notices", { notices: [{ ref_no: "13000002", title: "Imatinib 400 mg", detail_link: "https://evil.example/philgeps.gov.ph" }] });
    expect((await one("hazel", await idOf("13000002"))).found.link).toBeNull();
    expect((await robot("notices", { notices: [{ title: "no reference" }] })).status).toBe(400);
    expect((await robot("notices", { notices: [] })).status).toBe(400);
  });

  it("reads PhilGEPS's own line table: quantity, unit and the line's budget, and leaves the words above it out", async () => {
    const itemsText = [
      "Description",
      "The City Government invites bids for the Supply and Delivery of Letrozole and other items; Imatinib included.",
      "Line Items",
      "Item No. Product/Service Name Description Quantity UOM Budget (PHP)",
      "1 Letrozole 2.5 mg tablet 80000 Tablet 792,800.00",
      "2 Albumin, Human 20%, 50ml. 4500 Vial 9,893,250.00",
      "7 Imatinib (as mesilate) 400 mg film-coated tablet, in blister pack with certificate of analysis 1,500 Tablet 142,500.00",
      "8 Capecitabine 500 mg tablet",
      "9 Bortezomib 3.5 mg vial 1 Lot 950,000.00",
    ].join("\n");
    const notice = {
      ref_no: "13000020",
      title: "Supply and Delivery of Letrozole and other items",
      closing_date: "2099-12-01 13:00:00",
      items_text: itemsText,
      // As the robot hands them in: every line naming a molecule of ours, the words above the table too, unread.
      details: { matched_items: itemsText.split("\n").filter((line) => /letrozole|imatinib|capecitabine|bortezomib/i.test(line)).map((line) => ({ line, products: [] })) },
    };
    expect(await (await robot("notices", { notices: [notice] })).json()).toMatchObject({ fresh: 1, matched: 1 });
    const read = await one("hazel", await idOf("13000020"));
    expect(read.lines.map((line) => [line.itemNo, line.description, line.qty, line.unit, line.abcTotal, line.abcUnit, line.medicine])).toEqual([
      ["1", "Letrozole 2.5 mg tablet", 80000, "Tablet", 79280000, 991, "Letrozole 2.5 mg"],
      ["7", "Imatinib (as mesilate) 400 mg film-coated tablet, in blister pack with certificate of analysis", 1500, "Tablet", 14250000, 9500, "Imatinib 400 mg"],
      // A row cut short keeps its words; a lot is one lot at its budget.
      [null, "8 Capecitabine 500 mg tablet", null, null, null, null, "Capecitabine 500 mg"],
      ["9", "Bortezomib 3.5 mg vial", 1, "Lot", 95000000, 95000000, "Bortezomib 3.5 mg"],
    ]);
  });

  it("keeps each run as the robot reports it", async () => {
    expect((await robot("run", { status: "failed", trigger: "schedule", summary: "The PhilGEPS website is down right now." })).status).toBe(200);
    const found = await list("jimmy");
    expect(found.robot.ready).toBe(true);
    expect(found.robot.runs[0]).toMatchObject({ status: "failed", summary: "The PhilGEPS website is down right now." });
    expect(found.robot.runs.some((run) => run.status === "success" && run.found === 543)).toBe(true);
  });
});

describe("the tender finder: the team's pages", () => {
  it("is for the seats that have Tenders: the bidding line, the mentor above it, the CEO; not a MedRep of another line", async () => {
    for (const who of ["hazel", "jimmy", "sam", "naresh"]) expect((await get(who, "/api/tenders/found")).status).toBe(200);
    const id = await idOf("12451001");
    expect((await get("ryan", "/api/tenders/found")).status).toBe(403);
    expect((await get("ryan", `/api/tenders/found/${id}`)).status).toBe(403);
    expect((await post("ryan", `/api/tenders/found/${id}/screen`, { on: true })).status).toBe(403);
    expect((await post("ryan", `/api/tenders/found/${id}/tender`, { agencyId: 1, mode: "other", lines: [] })).status).toBe(403);
    expect(await (await get("ryan", "/api/tenders/found/count")).json()).toEqual({ allowed: false, fresh: 0 });
    expect(((await (await get("hazel", "/api/tenders/found/count")).json()) as { allowed: boolean; fresh: number }).allowed).toBe(true);
    expect((await app.request("/api/tenders/found")).status).toBe(401);
  });

  it("Opportunities holds every notice asking for our medicines, closed ones too; Everything found adds the rest", async () => {
    const fresh = await list("hazel", "?q=1245");
    expect(fresh.view).toBe("opportunities");
    expect(fresh.rows.map((row) => row.refNo).sort()).toEqual(["12450900", "12451001", "12451017", "12451033"]);
    expect(fresh.counts.opportunities).toBeGreaterThanOrEqual(4);
    // A page at a time, 25 by default (25, 50 or 100 asked); a page past the end is empty, the counts stay whole
    expect(fresh).toMatchObject({ page: 1, pageSize: 25, total: 4 });
    expect((await list("hazel", "?size=50")).pageSize).toBe(50);
    expect((await list("hazel", "?size=7")).pageSize).toBe(25);
    const beyond = await list("hazel", "?view=all&page=2");
    expect(beyond.page).toBe(2);
    expect(beyond.rows.length).toBe(Math.max(0, Math.min(25, beyond.counts.all - 25)));
    expect((await list("hazel", "?view=all&page=nonsense")).page).toBe(1);
    // The old address (?view=new) lands on the Opportunities
    expect((await list("hazel", "?view=new&q=1245")).view).toBe("opportunities");
    const all = await list("hazel", "?view=all&q=1245");
    // The closed one is an opportunity still; the one that is not ours is only under Everything found.
    expect(all.rows.map((row) => row.refNo).sort()).toEqual(["12450900", "12451001", "12451017", "12451033", "12451050"]);
    expect(all.rows.find((row) => row.refNo === "12450900")).toMatchObject({ open: false, molecules: ["Capecitabine"] });
    expect(all.rows.find((row) => row.refNo === "12451050")?.molecules).toEqual([]);
    expect((await list("hazel", "?view=screened")).rows.map((row) => row.refNo)).toEqual(["109877"]);
    expect((await list("hazel", "?view=all&source=ps")).rows.map((row) => row.refNo)).toEqual(["109877"]);
    expect((await list("hazel", "?molecule=Abiraterone")).rows.map((row) => row.refNo)).toEqual(["12451033"]);
    expect((await list("hazel", "?q=vicente")).rows.map((row) => row.refNo)).toEqual(["12451033"]);
    expect(fresh.molecules).toContain("Bortezomib");
  });

  it("the bidding system's list: summary cards, document chips, type, products left out, sorts and dates", async () => {
    const fresh = await list("hazel", "?q=1245");
    // The cards are over what is listed
    expect(fresh.stats.listed).toBe(4);
    expect(fresh.stats.abc).toBe(fresh.rows.reduce((sum, row) => sum + (row.abc ?? 0), 0));
    expect(fresh.stats.products).toBe(new Set(fresh.rows.flatMap((row) => row.molecules)).size);
    expect(fresh.stats.ours).toBeGreaterThanOrEqual(4);
    // Document chips: each tender is in exactly one of with / pick-up / none
    expect(fresh.docCounts.all).toBe(fresh.docCounts.with + fresh.docCounts.pickup + fresh.docCounts.none);
    expect((await list("hazel", "?q=1245&docs=none")).total).toBe(fresh.docCounts.none);
    // The type as the bidding system shows it: "Invitation to Bid (ITB)" is ITB, and the filter keeps only those
    expect(fresh.rows.find((row) => row.refNo === "12451001")?.type).toBe("ITB");
    expect(fresh.types.map((one) => one.code)).toContain("ITB");
    expect((await list("hazel", "?q=1245&type=ITB")).rows.every((row) => row.type === "ITB")).toBe(true);
    expect((await list("hazel", "?q=1245&type=Nothing")).total).toBe(0);
    // A product left out hides every tender asking for it
    const without = await list("hazel", "?q=1245&exclude=Capecitabine");
    expect(without.rows.map((row) => row.refNo)).not.toContain("12450900");
    expect(without.total).toBe(fresh.rows.filter((row) => !row.molecules.includes("Capecitabine")).length);
    expect(without.rows.every((row) => !row.molecules.includes("Capecitabine"))).toBe(true);
    // Every word of the search must be found
    expect((await list("hazel", "?q=1245 vicente")).rows.map((row) => row.refNo)).toEqual(["12451033"]);
    expect((await list("hazel", "?q=1245 nowhere")).total).toBe(0);
    // Highest budget first
    const budgets = (await list("hazel", "?q=1245&sort=budget")).rows.map((row) => row.abc ?? -1);
    expect(budgets).toEqual([...budgets].sort((a, b) => b - a));
    // A date range on the published day or the closing day
    expect((await list("hazel", "?q=1245&from=2999-01-01")).total).toBe(0);
    expect((await list("hazel", "?q=1245&dateOn=closing&to=1999-12-31")).total).toBe(0);
    expect((await list("hazel", "?q=1245&from=bad-day")).total).toBe(4);
  });

  it("a notice's page: its lines matched to our medicines, the agency to a customer, the mode and days read", async () => {
    const detail = await one("hazel", await idOf("12451001"));
    expect(detail.found).toMatchObject({ customer: "East Avenue Medical Center", abc: 243700000, noticeType: "Invitation to Bid (ITB)" });
    expect(detail.mode).toBe("competitive_bidding");
    expect(detail.prebidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.openingOn).toBe(detail.found.closingAt?.slice(0, 10));
    expect(detail.lines.map((line) => [line.medicine, line.qty, line.abcUnit])).toEqual([
      ["Bortezomib 3.5 mg", 200, 950000],
      ["Imatinib 400 mg", 3000, 9500],
      ["Capecitabine 500 mg", 6000, 4200],
    ]);
    // Our price starts from the price book's Bidding price, where there is one.
    expect(detail.lines[0]?.candidates[0]?.price).toBe(920000);
    expect(detail.lines[1]?.candidates[0]?.price).toBeNull();
    expect(detail.found.details.supplements.length).toBe(1);
    // Read in the papers, on the other portal.
    const papers = await one("hazel", await idOf("109877"));
    expect(papers.lines).toMatchObject([{ origin: "papers", qty: 10000, medicine: "Imatinib 400 mg" }]);
    expect(papers.found.details.documents).toEqual(["PBD-Imatinib-2026.pdf", "Technical-Specifications.docx"]);
    // A strength we do not keep and an agency that is no customer: both left to the person.
    const other = await one("hazel", await idOf("12451033"));
    expect(other.found.customer).toBeNull();
    expect(other.lines).toMatchObject([{ medicineId: null, molecules: ["Abiraterone"] }]);
    expect(other.lines[0]?.candidates.map((one) => one.name)).toEqual(["Abiraterone 250 mg"]);
  });

  it("screened and taken off, kept with who and when", async () => {
    const id = await idOf("12451017");
    expect((await post("hazel", `/api/tenders/found/${id}/screen`, { on: true })).status).toBe(200);
    expect((await list("hazel", "?view=screened")).rows.map((row) => row.refNo).sort()).toEqual(["109877", "12451017"]);
    expect((await one("jimmy", id)).found).toMatchObject({ screenedBy: "Hazel" });
    expect((await post("jimmy", `/api/tenders/found/${id}/screen`, { on: false })).status).toBe(200);
    expect((await one("hazel", id)).events.map((event) => [event.what, event.by])).toEqual([["screened", "Hazel"], ["unscreened", "Jimmy"]]);
    expect((await list("hazel", "?q=12451017")).rows.length).toBe(1);
  });

  it("the join: a notice becomes a tender with its agency, budget, dates and lines, then goes the tender's own road to the award", async () => {
    const id = await idOf("12451001");
    const detail = await one("hazel", id);
    const lines = detail.lines.map((line) => ({ lineId: line.id, medicineId: line.medicineId as number, qty: line.qty as number, unitPrice: line.candidates[0]?.price ?? (line.abcUnit as number) - 100 }));
    // A line that is another notice's, a medicine we do not keep, pieces that are not whole: refused.
    const body = { agencyId: detail.found.agencyId, mode: detail.mode, lines };
    expect((await post("hazel", `/api/tenders/found/${id}/tender`, { ...body, lines: [{ ...lines[0], lineId: 999999 }] })).status).toBe(400);
    expect((await post("hazel", `/api/tenders/found/${id}/tender`, { ...body, lines: [{ ...lines[0], medicineId: 999999 }] })).status).toBe(400);
    expect((await post("hazel", `/api/tenders/found/${id}/tender`, { ...body, lines: [{ ...lines[0], qty: 1.5 }] })).status).toBe(400);
    expect((await rows(db, sql`select 1 from tender where philgeps_ref = '12451001'`)).length).toBe(0);

    const made = await post("hazel", `/api/tenders/found/${id}/tender`, body);
    expect(made.status).toBe(200);
    const tenderId = ((await made.json()) as { id: number }).id;
    const tender = (await (await get("hazel", `/api/tenders/${tenderId}`)).json()) as {
      tender: Tender;
      lines: { medicine: string; qty: number; unitPrice: number }[];
      events: { step: string; note: string | null }[];
      found: { refNo: string; asked: { description: string; abcUnit: number | null }[] } | null;
    };
    expect(tender.tender).toMatchObject({
      agency: "East Avenue Medical Center",
      title: "Supply and Delivery of Various Anti-Cancer Medicines",
      philgepsRef: "12451001",
      mode: "competitive_bidding",
      abc: 243700000,
      step: "found",
      owner: "Hazel",
      postedOn: detail.found.publishedOn,
      prebidOn: detail.prebidOn,
      openingOn: detail.openingOn,
      // 200 × ₱9,200 (the price book's Bidding price) + 3,000 × ₱94 + 6,000 × ₱41.
      ourBid: 200 * 920000 + 3000 * 9400 + 6000 * 4100,
    });
    expect(new Date(tender.tender.deadlineAt as string).getTime()).toBe(new Date(detail.found.closingAt as string).getTime());
    expect(tender.lines.map((line) => [line.medicine, line.qty, line.unitPrice])).toEqual([
      ["Bortezomib 3.5 mg", 200, 920000],
      ["Imatinib 400 mg", 3000, 9400],
      ["Capecitabine 500 mg", 6000, 4100],
    ]);
    expect(tender.events).toMatchObject([{ step: "found", note: "From the tender finder: PhilGEPS 12451001" }]);
    expect(tender.found?.asked.map((line) => line.abcUnit)).toEqual([950000, 9500, 4200]);

    // The notice says which tender it is; it makes one tender only and stays screened.
    const after = await one("hazel", id);
    expect(after.found).toMatchObject({ tenderId, tenderCode: tender.tender.code, screenedBy: "Hazel" });
    expect(after.events.map((event) => event.what)).toEqual(["tender"]);
    expect((await post("jimmy", `/api/tenders/found/${id}/tender`, body)).status).toBe(409);
    expect((await post("hazel", `/api/tenders/found/${id}/screen`, { on: false })).status).toBe(409);
    expect((await list("hazel", "?view=tenders")).rows.map((row) => row.refNo)).toEqual(["12451001"]);
    // Made a tender, it stays among the Opportunities (every tender for our medicines), shown as the tender
    expect((await list("hazel", "?q=12451001")).rows.map((row) => row.tenderId)).toEqual([tenderId]);

    // The tender's own road: the Admin approves the price, a complete envelope, submitted, won.
    const step = (who: string, input: unknown) => post(who, `/api/tenders/${tenderId}/step`, input);
    expect((await step("hazel", { step: "preparing" })).status).toBe(200);
    expect((await step("hazel", { step: "price_approved" })).status).toBe(403);
    // A line left without a price (the price book had none) stops the approval, by its name.
    const priced = lines.map((line) => ({ medicineId: line.medicineId, qty: line.qty, unitPrice: line.unitPrice }));
    expect((await post("hazel", `/api/tenders/${tenderId}/lines`, { lines: priced.map((line, n) => (n === 1 ? { ...line, unitPrice: 0 } : line)) })).status).toBe(200);
    const unpriced = await step("jimmy", { step: "price_approved" });
    expect(unpriced.status).toBe(400);
    expect(((await unpriced.json()) as { error: { message: string } }).error.message).toContain("Imatinib 400 mg has no price yet");
    expect((await post("hazel", `/api/tenders/${tenderId}/lines`, { lines: priced })).status).toBe(200);
    expect((await step("jimmy", { step: "price_approved" })).status).toBe(200);
    expect((await post("hazel", `/api/tenders/${tenderId}/lines`, { lines: [{ medicineId: lines[0]?.medicineId, qty: 1, unitPrice: 1 }] })).status).toBe(409);
    expect((await step("hazel", { step: "submitted" })).status).toBe(400);
    expect((await post("hazel", `/api/tenders/${tenderId}`, { papers: tender.tender.papers.map((paper) => ({ ...paper, done: true })) })).status).toBe(200);
    expect((await step("hazel", { step: "submitted" })).status).toBe(200);
    expect((await step("hazel", { step: "won" })).status).toBe(200);
  });

  it("an agency and a medicine picked by hand are remembered", async () => {
    // Two notices of an agency that is no customer of that name.
    await robot("notices", {
      notices: [
        { ref_no: "13000010", title: "Abiraterone 250 mg tablet", procuring_entity: "Vicente Sotto Memorial Medical Center - Region VII", closing_date: "2099-01-01 10:00:00",
          details: { matched_items: [{ line: "Abiraterone tablet 1000 tablets", description: "Abiraterone 500mg tablet", quantity: 1000, unit: "tablets" }] } },
      ],
    });
    const id = await idOf("12451033");
    const detail = await one("hazel", id);
    expect(detail.found.agencyId).toBeNull();
    const [agency] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = 'Department of Health – Central Office'`);
    const line = detail.lines[0] as FoundDetail["lines"][number];
    const made = await post("hazel", `/api/tenders/found/${id}/tender`, {
      agencyId: agency?.id,
      mode: detail.mode,
      title: "Abiraterone for the regional cancer center",
      lines: [{ lineId: line.id, medicineId: line.candidates[0]?.id, qty: 6000, unitPrice: 20000 }],
    });
    expect(made.status).toBe(200);
    const after = await one("hazel", id);
    expect(after.found.customer).toBe("Department of Health – Central Office");
    expect(after.lines[0]).toMatchObject({ medicine: "Abiraterone 250 mg" });
    expect(after.events.map((event) => [event.what, event.note])).toMatchObject([["agency", "Department of Health – Central Office"], ["tender", expect.stringMatching(/^TND-/)]]);
    // The agency's other notice knows its customer now.
    expect((await one("hazel", await idOf("13000010"))).found.customer).toBe("Department of Health – Central Office");
    // An agency that is no government buyer or hospital is refused, and nothing is made.
    const [patient] = await rows<{ id: number }>(db, sql`select id::int as id from customer where kind = 'patient' limit 1`);
    if (patient) {
      const refused = await post("hazel", `/api/tenders/found/${await idOf("13000010")}/tender`, { agencyId: patient.id, mode: "other", lines: [] });
      expect(refused.status).toBe(400);
      expect((await one("hazel", await idOf("13000010"))).found.tenderId).toBeNull();
    }
  });
});

describe("the tender papers", () => {
  const door = (path: string, init: RequestInit = {}) =>
    app.request(`/webhooks/tender-finder/${path}`, { ...init, headers: { authorization: `Bearer ${KEY}`, ...(init.headers as Record<string, string> | undefined) } });

  it("the robot is told which notices want their papers (screened, open, on PhilGEPS) and our medicines as its product list", async () => {
    process.env.TENDER_FINDER_KEY = KEY;
    const products = (await (await door("products")).json()) as { generic_name: string; brand_name: string; dosage: string }[];
    expect(products.find((one) => one.generic_name === "Imatinib mesylate")).toMatchObject({ brand_name: "Imatinib", dosage: "400 mg" });
    // The seed's screened notice is on the other portal: not for this log-in.
    const before = (await (await door("papers")).json()) as { ref_no: string }[];
    expect(before.map((one) => one.ref_no)).not.toContain("109877");
    expect(before.map((one) => one.ref_no)).not.toContain("12451017");
    expect((await post("hazel", `/api/tenders/found/${await idOf("12451017")}/screen`, { on: true })).status).toBe(200);
    const wanted = (await (await door("papers")).json()) as { ref_no: string; closing_date: string; abc_amount: number; items_text: string; details: Record<string, unknown> }[];
    const one = wanted.find((row) => row.ref_no === "12451017");
    expect(one).toMatchObject({ abc_amount: 486000, procuring_entity: "Department of Health - Central Office" });
    // Philippine time without a zone, as the robot keeps a notice.
    expect(one?.closing_date).toMatch(/^\d{4}-\d{2}-\d{2} 10:00:00$/);
    expect((await app.request("/webhooks/tender-finder/papers")).status).toBe(401);
  });

  it("a paper is kept whole, shown on the notice to the seats that have the finder, and given back to the robot", async () => {
    const id = await idOf("12451017");
    // Larger than any other webhook may be (2 MB), small enough to stay quick.
    const bytes = new Uint8Array(2.2 * 1024 * 1024).map((_, n) => n % 251);
    const query = new URLSearchParams({ ref: "12451017", path: "12451017/Price Schedule.pdf", name: "Price Schedule.pdf", kind: "paper" });
    const kept = await door(`papers/file?${query}`, { method: "POST", body: bytes, headers: { "content-type": "application/octet-stream" } });
    expect(kept.status).toBe(200);
    // A bid bulletin's file, and the same paper handed in again takes the first one's place.
    await door(`papers/file?${new URLSearchParams({ ref: "12451017", path: "12451017/Bid Bulletin 1 - BB1.pdf", name: "Bid Bulletin 1 - BB1.pdf", kind: "bulletin" })}`, { method: "POST", body: new Uint8Array([1, 2, 3]) });
    await door(`papers/file?${query}`, { method: "POST", body: bytes });
    expect((await door(`papers/file?${new URLSearchParams({ ref: "99999999", path: "x", name: "x.pdf" })}`, { method: "POST", body: bytes })).status).toBe(404);
    expect((await door("papers/file?ref=12451017", { method: "POST", body: bytes })).status).toBe(400);
    // Any other webhook stays small.
    expect((await door("notices", { method: "POST", body: bytes, headers: { "content-type": "application/json" } })).status).toBe(413);

    const detail = await one("hazel", id);
    expect(detail.papers.files.map((file) => [file.kind, file.name, file.size])).toEqual([
      ["paper", "Price Schedule.pdf", bytes.byteLength],
      ["bulletin", "Bid Bulletin 1 - BB1.pdf", 3],
    ]);
    const fileId = detail.papers.files[0]?.id as number;
    const opened = await get("jimmy", `/api/tenders/found/files/${fileId}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-type")).toBe("application/pdf");
    expect(opened.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await opened.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect((await get("ryan", `/api/tenders/found/files/${fileId}`)).status).toBe(403);
    expect((await app.request(`/api/tenders/found/files/${fileId}`)).status).toBe(401);
    const back = await door(`papers/file?${new URLSearchParams({ ref: "12451017", path: "12451017/Price Schedule.pdf" })}`);
    expect(new Uint8Array(await back.arrayBuffer()).byteLength).toBe(bytes.byteLength);
    expect((await door(`papers/file?${new URLSearchParams({ ref: "12451017", path: "nothing" })}`)).status).toBe(404);
  });

  it("what was read in the papers becomes the notice's lines, stays when the notice is read again, and its page says what the papers say", async () => {
    const id = await idOf("12451017");
    const wanted = (await (await door("papers")).json()) as (Record<string, unknown> & { ref_no: string; details: Record<string, unknown> })[];
    const notice = wanted.find((row) => row.ref_no === "12451017") as (typeof wanted)[number];
    const read = {
      ...notice.details,
      documents: [{ name: "Price Schedule.pdf", title: "Bidding Documents", size: 3145728, path: "12451017/Price Schedule.pdf", order_no: "5551", source: "order", downloaded_at: "2026-11-23T09:00:00.000Z" }],
      documents_status: "downloaded",
      documents_remark: "Ordered by the system on PhilGEPS (free) (order 5551); 1 file downloaded.",
      documents_checked_at: "2026-11-23T09:00:00.000Z",
      documents_items: [
        { our_products: ["Letrozole"], item_no: "1", description: "Letrozole 2.5 mg film-coated tablet", quantity: 15000, unit: "tablet", unit_price: 21, total: 315000, line: "1 Letrozole 2.5 mg film-coated tablet 15,000 tablet 21.00 315,000.00", source: "Price Schedule.pdf, page 1" },
      ],
      documents_read: [{ name: "Price Schedule.pdf", kind: "text", pages: 4 }],
      documents_read_key: "read-63|list-1|12451017/Price Schedule.pdf:3145728",
      documents_accuracy: { percent: 100, reasons: [], version: 1 },
      documents_bid_data_sheet: { prebid_conference: "November 27, 2026 at 10:00 AM, BAC Conference Room", bid_opening: null, bid_security: "Bid Securing Declaration" },
      documents_outside_table: [{ line: "x".repeat(1000) }],
    };
    expect((await robot("notices", { notices: [{ ...notice, source: "philgeps", details: read }] })).status).toBe(200);
    const detail = await one("hazel", id);
    // The papers' line for Letrozole takes the notice's own; the notice's line stays for the molecule the papers do not give.
    expect(detail.lines.map((line) => [line.origin, line.medicine, line.qty, line.abcUnit])).toEqual([
      ["papers", "Letrozole 2.5 mg", 15000, 2100],
      ["notice", "Anastrozole 1 mg", 9000, 2400],
    ]);
    expect(detail.papers).toMatchObject({
      status: "downloaded",
      remark: "Ordered by the system on PhilGEPS (free) (order 5551); 1 file downloaded.",
      accuracy: 100,
      reading: false,
      sheet: [
        { label: "Pre-bid conference", said: "November 27, 2026 at 10:00 AM, BAC Conference Room" },
        { label: "Bid security", said: "Bid Securing Declaration" },
      ],
    });
    // The robot gets its own record back (to know what is done), without what is only for checking.
    const known = (await (await robot("known", { refs: ["12451017"] })).json()) as { details: Record<string, unknown> }[];
    expect(known[0]?.details).toMatchObject({ documents_status: "downloaded", documents_read_key: read.documents_read_key, documents_checked_at: read.documents_checked_at });
    expect(known[0]?.details.documents_outside_table).toBeUndefined();
    // The next hour's reading of the public notice hands that record back: the papers' lines stay.
    await robot("notices", { notices: [{ ref_no: "12451017", title: notice.title, items_text: notice.items_text, details: known[0]?.details }] });
    expect((await one("hazel", id)).lines.map((line) => line.origin)).toEqual(["papers", "notice"]);
  });

  it("the robot's log-ins are kept; a refused one stops it until a person says to try again", async () => {
    const state = async () => (await list("hazel")).robot.login;
    expect((await state()).state).toBe("never");
    const note = (outcome: string, detail?: string) => door("logins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: "philgeps", outcome, detail, source: "github" }) });
    await note("started");
    await note("ok");
    expect(await state()).toMatchObject({ state: "ok" });
    expect((await post("hazel", "/api/tenders/found/robot/login-again", {})).status).toBe(409);
    await note("started");
    await note("rejected", 'PhilGEPS did not accept the log-in: "Invalid User ID or Password."');
    expect(await state()).toMatchObject({ state: "refused", said: 'PhilGEPS did not accept the log-in: "Invalid User ID or Password."' });
    expect(await (await door("login-state")).json()).toMatchObject({ state: "refused" });
    const kept = (await (await door("logins?site=philgeps")).json()) as { outcome: string }[];
    expect(kept.map((one) => one.outcome)).toEqual(["rejected", "started", "ok", "started"]);
    expect((await post("ryan", "/api/tenders/found/robot/login-again", {})).status).toBe(403);
    expect((await post("jimmy", "/api/tenders/found/robot/login-again", {})).status).toBe(200);
    expect(await state()).toMatchObject({ state: "ok", said: "A person said to try the log-in again." });
    expect(await (await door("login-state")).json()).toMatchObject({ state: "ok" });
    expect((await door("logins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: "philgeps", outcome: "made-up" }) })).status).toBe(400);
  });
});

describe("the bidding system hands over (the bridge)", () => {
  it("a PS-PhilGEPS tender arrives with its lines and its papers' reading; what was screened there is screened here, once", async () => {
    process.env.TENDER_FINDER_KEY = KEY;
    expect(await (await robot("feed-state")).json()).toEqual({ since: null });
    const ps = {
      source: "ps",
      ref_no: "152987",
      title: "Procurement of Drugs and Medicines",
      procuring_entity: "East Avenue Medical Center",
      publish_date: "2026-11-23",
      closing_date: "2099-11-26 09:00:00",
      abc_amount: 1484125,
      detail_link: "https://philgeps.gov.ph/tenders/viewBidNotice/152987",
      items_text: "1 Letrozole 2.5 mg tablet 2500 Tablet 55,000.00",
      details: {
        procurement_mode: "Small Value Procurement",
        bid_opening: "26-Nov-2099 09:00 AM",
        matched_items: [{ line: "1 Letrozole 2.5 mg tablet 2500 Tablet 55,000.00", description: "Letrozole 2.5 mg tablet", quantity: 2500, unit: "Tablet", total: 55000 }],
        documents: [{ name: "S20266637.pdf", size: 551936, path: "152987/S20266637.pdf", source: "notice" }],
        documents_status: "downloaded",
        documents_items: [{ our_products: ["Imatinib"], item_no: "4", description: "Imatinib 400 mg tablet", quantity: 900, unit: "Tablet", unit_price: 95, total: 85500 }],
        documents_bid_data_sheet: { bid_security: "Bid Securing Declaration" },
        documents_accuracy: { percent: 100 },
      },
    };
    expect(await (await robot("notices", { notices: [ps] })).json()).toMatchObject({ fresh: 1, matched: 1 });
    const id = (await rows<{ id: number }>(db, sql`select id::int as id from tender_found where source = 'ps' and ref_no = '152987'`))[0]?.id as number;
    const detail = await one("hazel", id);
    expect(detail.found).toMatchObject({ source: "ps", customer: "East Avenue Medical Center", abc: 148412500, closingAt: "2099-11-26T01:00:00Z", procurementMode: "Small Value Procurement" });
    expect(detail.found.link).toBe("https://philgeps.gov.ph/tenders/viewBidNotice/152987");
    expect(detail.mode).toBe("small_value");
    expect(detail.lines.map((line) => [line.origin, line.medicine, line.qty, line.abcUnit])).toEqual([
      ["papers", "Imatinib 400 mg", 900, 9500],
      ["notice", "Letrozole 2.5 mg", 2500, 2200],
    ]);
    expect(detail.papers).toMatchObject({ status: "downloaded", sheet: [{ label: "Bid security", said: "Bid Securing Declaration" }] });
    expect(detail.found.details.documents).toEqual(["S20266637.pdf"]);

    // Screened there: screened here, by the name it has there; a second hand-over changes nothing,
    // and one screened here by a person keeps that person.
    const marks = { marks: [{ source: "ps", ref: "152987", by: "2mgincorporated", at: "2026-11-21T00:29:00Z" }, { source: "philgeps", ref: "12451017", by: "someone" }, { source: "ps", ref: "nowhere" }] };
    expect(await (await robot("screened", marks)).json()).toEqual({ screened: 1 });
    expect(await (await robot("screened", marks)).json()).toEqual({ screened: 0 });
    expect((await one("hazel", id)).found).toMatchObject({ screenedBy: "2mgincorporated (in the bidding system)", screenedAt: "2026-11-21T00:29:00Z" });
    expect((await one("hazel", await idOf("12451017"))).found.screenedBy).toBe("Hazel");
    expect((await list("hazel", "?view=screened&source=ps")).rows.map((row) => row.refNo)).toContain("152987");
    // The papers of the new portal are not for the CRM's own PhilGEPS log-in.
    expect(((await (await app.request("/webhooks/tender-finder/papers", { headers: { authorization: `Bearer ${KEY}` } })).json()) as { ref_no: string }[]).map((one) => one.ref_no)).not.toContain("152987");

    // After a hand-over that went well, the next one is told since when.
    await robot("run", { source: "ps", trigger: "feed", status: "failed", summary: "The bidding system's database refused" });
    expect(await (await robot("feed-state")).json()).toEqual({ since: null });
    await robot("run", { source: "ps", trigger: "feed", status: "success", summary: "From the bidding system: 1 PhilGEPS and 1 PS-PhilGEPS tenders" });
    expect(((await (await robot("feed-state")).json()) as { since: string }).since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("the robots' own records", () => {
  it("are kept row by row as handed in, only for the robots' tables; a log-in session is sealed; the finder's page says whether PS-PhilGEPS is connected", async () => {
    process.env.TENDER_FINDER_KEY = KEY;
    const write = (body: unknown) => robot("store", body);
    const read = async (table: string) => ((await (await robot(`store?table=${table}`)).json()) as { rows: Record<string, unknown>[] }).rows;
    expect((await list("hazel")).robot.ps).toMatchObject({ connected: false, status: null });
    expect(await read("ps_sync_status")).toEqual([]);
    expect((await write({ table: "ps_sync_status", upsert: [{ key: "latest", value: { id: "latest", status: "idle", connected_at: "2026-11-23T09:00:00.000Z" } }] })).status).toBe(200);
    expect((await write({ table: "ps_tender_analysis", upsert: [{ key: "152987", value: { ref: "152987", status: "done", result: { items: [] } } }, { key: "153000", value: { ref: "153000", status: "failed" } }] })).status).toBe(200);
    expect(await read("ps_tender_analysis")).toEqual([{ ref: "152987", status: "done", result: { items: [] } }, { ref: "153000", status: "failed" }]);
    // A row handed in again takes the first one's place; one taken away is gone.
    await write({ table: "ps_tender_analysis", upsert: [{ key: "152987", value: { ref: "152987", status: "skipped" } }], remove: ["153000", "never-there"] });
    expect(await read("ps_tender_analysis")).toEqual([{ ref: "152987", status: "skipped" }]);
    expect((await list("jimmy")).robot.ps).toMatchObject({ connected: true, connectedAt: "2026-11-23T09:00:00.000Z", status: "idle" });

    // The session's cookies come back to the robot as it wrote them, and are not readable at rest.
    const session = { id: "current", cookies: [{ name: "PHPSESSID", value: "a-live-log-in" }], saved_at: "2026-11-23T09:00:00.000Z" };
    await write({ table: "ps_philgeps_session", upsert: [{ key: "current", value: session }] });
    expect(await read("ps_philgeps_session")).toEqual([session]);
    const [kept] = await rows<{ value: unknown; sealed: string | null }>(db, sql`select value, sealed from tender_robot_row where tbl = 'ps_philgeps_session'`);
    expect(kept?.value).toBeNull();
    expect(kept?.sealed).toMatch(/^v1\./);
    expect(JSON.stringify(kept)).not.toContain("a-live-log-in");

    // Not a way to write anywhere: another table's name is refused, and so is anyone without the robot's way in.
    expect((await write({ table: "person", upsert: [{ key: "1", value: { role: "admin" } }] })).status).toBe(400);
    expect((await robot("store?table=sales_order")).status).toBe(400);
    expect((await app.request("/webhooks/tender-finder/store?table=ps_philgeps_session")).status).toBe(401);
    expect((await get("hazel", "/webhooks/tender-finder/store?table=ps_philgeps_session")).status).toBe(401);
    // What is screened in the CRM, and the papers it keeps of a notice, as the robot asks for them.
    const screened = (await (await robot("screened")).json()) as { source: string; ref: string }[];
    expect(screened).toContainEqual({ source: "philgeps", ref: "12451017" });
    expect(await (await robot("papers/list?source=philgeps&ref=12451017")).json()).toMatchObject([{ path: "12451017/Price Schedule.pdf" }, { path: "12451017/Bid Bulletin 1 - BB1.pdf" }]);
    expect(await (await robot("papers/list?source=ps&ref=12451017")).json()).toEqual([]);
  });
});
