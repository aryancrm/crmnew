// Where a photo's or a paper's bytes live. On this computer and in tests they stay in the row
// (nothing to set up). Online they go to a bucket (Supabase Storage, or any S3-compatible one)
// and the row keeps only the key, so the database stays small. STORAGE_DRIVER picks: "db"
// (default) or "s3". Every photo is made smaller first, whatever sent it: the browser, a
// Messenger message, an email, a website.

import { createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import { Refusal } from "../http";

sharp.cache({ memory: 16, files: 0, items: 24 });
sharp.concurrency(1);

export type IncomingFile = { name: string; mime: string; bytes: Uint8Array };

/** What the row keeps: the bytes (database store) or the bucket's key (bucket store). */
export type KeptFile = {
  name: string;
  mime: string;
  size: number;
  data: Buffer | null;
  key: string | null;
};

const PHOTO = /^image\/(jpeg|png|webp|avif|heic|heif)$/i;
const SIDE = 2048;

/** Camera photos come down to 2048 px WebP; PDFs, animations and small photos stay as they are. */
export async function compressPhoto(file: IncomingFile): Promise<IncomingFile> {
  if (!PHOTO.test(file.mime)) return file;
  try {
    const image = sharp(file.bytes, { limitInputPixels: 40_000_000 });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) > 1) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    // Already made small by the browser: not encoded a second time.
    if (meta.format === "webp" && longest <= SIDE && file.bytes.byteLength <= 600_000 && !meta.exif)
      return { ...file, name: `${base}.webp`, mime: "image/webp" };
    if (meta.format === "jpeg" && longest <= SIDE && file.bytes.byteLength <= 700_000 && !meta.exif)
      return { ...file, name: `${base}.jpg`, mime: "image/jpeg" };
    const out = await image
      .rotate()
      .resize({ width: SIDE, height: SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72, effort: 3 })
      .toBuffer();
    if (out.byteLength >= file.bytes.byteLength) return file;
    return { name: `${base}.webp`, mime: "image/webp", bytes: new Uint8Array(out) };
  } catch {
    // A photo sharp can't read (a damaged or unusual file) is kept as it came.
    return file;
  }
}

interface Bucket {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/** Any S3-compatible bucket (Supabase Storage's S3 endpoint), signed with Signature V4 by hand. */
export function s3Bucket(cfg: S3Config): Bucket {
  const base = cfg.endpoint.replace(/\/$/, "");
  const urlOf = (key: string) =>
    `${base}/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function request(method: string, key: string, body?: Uint8Array, mime?: string) {
    const target = new URL(urlOf(key));
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256")
      .update(body ?? new Uint8Array())
      .digest("hex");
    const headers: Record<string, string> = {
      host: target.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (mime) headers["content-type"] = mime;
    const signed = Object.keys(headers).sort();
    const canonical = [
      method,
      target.pathname,
      target.searchParams.toString(),
      `${signed.map((h) => `${h}:${headers[h]}`).join("\n")}\n`,
      signed.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${day}/${cfg.region}/s3/aws4_request`;
    const toSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonical).digest("hex"),
    ].join("\n");
    const hmac = (k: Buffer | string, msg: string) => createHmac("sha256", k).update(msg).digest();
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${cfg.secretKey}`, day), cfg.region), "s3"),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`;
    const { host: _host, ...send } = headers;
    return fetch(target, {
      method,
      headers: send,
      body: body ? new Blob([new Uint8Array(body)]) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  }

  return {
    async put(key, bytes, mime) {
      const res = await request("PUT", key, bytes, mime);
      if (!res.ok)
        throw new Error(`Storage refused the file (${res.status}): ${(await res.text()).slice(0, 200)}`);
    },
    async get(key) {
      const res = await request("GET", key);
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Storage refused the download (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

let bucket: Bucket | null | undefined;

/** The bucket this process keeps files in, or null when they stay in the database. */
function bucketNow(): Bucket | null {
  if (bucket !== undefined) return bucket;
  const driver = process.env.STORAGE_DRIVER ?? "db";
  if (driver === "db") return (bucket = null);
  if (driver !== "s3") throw new Error(`STORAGE_DRIVER must be "db" or "s3", not "${driver}".`);
  const need = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`STORAGE_DRIVER=s3 needs ${name}.`);
    return value;
  };
  bucket = s3Bucket({
    endpoint: need("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "ap-southeast-1",
    bucket: need("S3_BUCKET"),
    accessKey: need("S3_ACCESS_KEY"),
    secretKey: need("S3_SECRET_KEY"),
  });
  return bucket;
}

/** Tests put a bucket of their own in place (null = back to the environment's). */
export function useBucket(next: Bucket | null | undefined): void {
  bucket = next;
}

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

/**
 * Makes a photo smaller and keeps the file: in the bucket (the row gets its key) or in the row.
 * Call it before the database transaction, so a slow upload never holds a lock. The key is the
 * content's hash, so the same photo sent twice is kept once.
 */
export async function keepFile(folder: string, file: IncomingFile): Promise<KeptFile> {
  const small = await compressPhoto(file);
  const name = small.name.trim().slice(0, 200) || "file";
  const store = bucketNow();
  if (!store)
    return { name, mime: small.mime, size: small.bytes.byteLength, data: Buffer.from(small.bytes), key: null };
  const hash = createHash("sha256").update(small.bytes).digest("hex");
  const key = `${folder}/${hash.slice(0, 2)}/${hash}.${EXT[small.mime] ?? "bin"}`;
  await store.put(key, small.bytes, small.mime);
  return { name, mime: small.mime, size: small.bytes.byteLength, data: null, key };
}

/** A kept file's bytes, from the row or from the bucket. */
export async function bytesOf(row: { data?: Uint8Array | null; key?: string | null }): Promise<Uint8Array> {
  if (row.data && row.data.byteLength > 0) return row.data;
  if (row.key) {
    const store = bucketNow();
    if (!store) throw new Error("This file is in the bucket but STORAGE_DRIVER isn't s3.");
    const bytes = await store.get(row.key);
    if (bytes) return bytes;
  }
  throw new Refusal(404, "not_found", "That file isn't there any more.");
}
