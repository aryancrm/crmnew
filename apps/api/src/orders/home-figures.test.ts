// The two Homes' figures: a MedRep's own (orders/my-kpis.ts) and the company's for Management
// (orders/company-kpis.ts) count the same orders the same way, and only the right people see them.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Catalogue, CompanyKpis, MyKpis } from "../types";

const PASSWORD = "test-password-1";
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the Homes' figures", () => {
  it("count a new order today for the MedRep and for the company, the same way", async () => {
    const before = await read<MyKpis>("ryan", "/api/orders/kpis");
    const company = await read<CompanyKpis>("sarla", "/api/orders/company-kpis");
    const hospital = (
      (await (
        await post("sarla", "/api/customers", {
          kind: "hospital",
          name: "Figures Test Hospital",
          city: "Pasay",
          paymentTerms: "cod",
        })
      ).json()) as { id: number }
    ).id;
    const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
    const row = catalogue.rows.find(
      (item) => item.prices.hospital !== undefined && item.total >= 10,
    );
    const placed = await post("ryan", "/api/orders", {
      customerId: hospital,
      items: [{ medicineId: row?.id, qty: 2, priceKind: "hospital" }],
    });
    expect(placed.status, await placed.clone().text()).toBe(200);

    const after = await read<MyKpis>("ryan", "/api/orders/kpis");
    expect(after.submitted).toBe(before.submitted + 1);
    expect(after.todayOrders).toBe(before.todayOrders + 1);
    expect(after.pending).toBe(before.pending + 1);
    expect(after.orders[0]?.customer).toBe("Figures Test Hospital");
    expect(after.scorecard.kpis.map((kpi) => kpi.code)).toEqual(["IST", "DSO", "HRR", "NZSD"]);

    const companyAfter = await read<CompanyKpis>("sarla", "/api/orders/company-kpis");
    expect(companyAfter.submitted).toBe(company.submitted + 1);
    expect(companyAfter.waiting).toBe(company.waiting + 1);
    expect(companyAfter.byRep.find((rep) => rep.name === "Ryan")?.orders).toBeGreaterThan(0);
    // The month always holds today.
    const month = await read<CompanyKpis>("sarla", "/api/orders/company-kpis?period=month");
    expect(month.submitted).toBeGreaterThanOrEqual(companyAfter.submitted);
    expect(month.submitted).toBe(month.monthOrders);
  });

  it("keeps the company's figures from a MedRep", async () => {
    expect((await get("ryan", "/api/orders/company-kpis")).status).toBe(403);
  });
});
