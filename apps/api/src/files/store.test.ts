import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Catalogue } from "../types";
import { bytesOf, compressPhoto, keepFile, useBucket } from "./store";

/** A bucket that lives in memory, standing in for Supabase Storage. */
function memoryBucket() {
  const kept = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    kept,
    async put(key: string, bytes: Uint8Array, mime: string) {
      kept.set(key, { bytes, mime });
    },
    async get(key: string) {
      return kept.get(key)?.bytes ?? null;
    },
  };
}

/** A camera-sized photo with detail in it (noise), as a phone would send. */
async function cameraPhoto(): Promise<Uint8Array> {
  const width = 3000;
  const height = 2200;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 2654435761) >>> 24;
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer(),
  );
}

describe("photos are made smaller whatever sent them", () => {
  it("a camera photo comes down to 2048 px WebP", async () => {
    const bytes = await cameraPhoto();
    const small = await compressPhoto({ name: "rx.jpg", mime: "image/jpeg", bytes });
    expect(small.mime).toBe("image/webp");
    expect(small.name).toBe("rx.webp");
    expect(small.bytes.byteLength).toBeLessThan(bytes.byteLength);
    const meta = await sharp(small.bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(2048);
  });

  it("a PDF and a file that isn't a readable photo stay as they came", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    expect(await compressPhoto({ name: "a.pdf", mime: "application/pdf", bytes: pdf })).toEqual({
      name: "a.pdf",
      mime: "application/pdf",
      bytes: pdf,
    });
    const broken = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    expect((await compressPhoto({ name: "b.png", mime: "image/png", bytes: broken })).bytes).toBe(
      broken,
    );
  });
});

describe("where the bytes live", () => {
  afterAll(() => useBucket(undefined));

  it("without a bucket the row keeps the bytes", async () => {
    useBucket(null);
    const kept = await keepFile("orders", {
      name: "po.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(kept.key).toBeNull();
    expect([...(kept.data ?? [])]).toEqual([1, 2, 3]);
    expect([...(await bytesOf(kept))]).toEqual([1, 2, 3]);
  });

  it("with a bucket the row keeps only the key, and the same photo is kept once", async () => {
    const bucket = memoryBucket();
    useBucket(bucket);
    const bytes = await cameraPhoto();
    const first = await keepFile("cases", { name: "id.jpg", mime: "image/jpeg", bytes });
    const again = await keepFile("cases", { name: "id-again.jpg", mime: "image/jpeg", bytes });
    expect(first.data).toBeNull();
    expect(first.key).toMatch(/^cases\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
    expect(again.key).toBe(first.key);
    expect(bucket.kept.size).toBe(1);
    expect((await bytesOf(first)).byteLength).toBe(first.size);
  });
});

describe("an order's paper through the app, with the bucket on", () => {
  const PASSWORD = "test-password-1";
  let db: Database;
  let app: ReturnType<typeof createApp>;
  const cookies: Record<string, string> = {};
  const bucket = memoryBucket();

  beforeAll(async () => {
    useBucket(bucket);
    db = openDatabase({ dir: "memory" });
    await migrate(db);
    await seedDemo(db, PASSWORD);
    await seedFixture(db);
    app = createApp(db, { webUrl: "http://localhost:5180" });
    for (const name of ["ryan", "sarla", "jane"]) {
      const response = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
      });
      cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    }
  });
  afterAll(() => useBucket(undefined));

  const call = (who: string, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: cookies[who] as string },
    });
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("the photo goes to the bucket smaller, the database keeps the key, and it opens again", async () => {
    const customer = (await (
      await call("sarla", "/api/customers", json({ kind: "hospital", name: "Bucket Hospital", city: "Pasay" }))
    ).json()) as { id: number };
    const catalogue = (await (await call("sarla", "/api/inventory/medicines")).json()) as Catalogue;
    const medicine = catalogue.rows.find((row) => row.prices.hospital !== undefined && row.total >= 10);
    if (!medicine) throw new Error("no medicine with a hospital price");
    const placed = (await (
      await call(
        "ryan",
        "/api/orders",
        json({ customerId: customer.id, items: [{ medicineId: medicine.id, qty: 1, priceKind: "hospital" }] }),
      )
    ).json()) as { id: number };

    const photo = await cameraPhoto();
    const form = new FormData();
    form.set("kind", "po");
    form.set("file", new File([new Uint8Array(photo)], "po.jpg", { type: "image/jpeg" }));
    const sent = await call("ryan", `/api/orders/${placed.id}/papers`, { method: "POST", body: form });
    expect(sent.status).toBe(200);
    const { id } = (await sent.json()) as { id: number };

    const [row] = await rows<{ data: Uint8Array | null; key: string | null; mime: string; size: number }>(
      db,
      sql`select data, store_key as key, mime, size from order_file where id = ${id}`,
    );
    expect(row?.data).toBeNull();
    expect(row?.key).toMatch(/^orders\//);
    expect(row?.mime).toBe("image/webp");
    expect(row?.size).toBeLessThan(photo.byteLength);
    expect(bucket.kept.get(row?.key as string)?.bytes.byteLength).toBe(row?.size);

    const opened = await call("sarla", `/api/papers/${id}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-type")).toContain("image/webp");
    expect((await opened.arrayBuffer()).byteLength).toBe(row?.size);
    // Someone who can't see the order can't open its paper, wherever it is kept.
    expect((await call("jane", `/api/papers/${id}`)).status).toBe(404);
  });
});
