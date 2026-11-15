// A page's token or a mailbox's password is kept sealed (AES-256-GCM) with SECRETS_KEY, and
// opened only on the server when it is used. Lose the key and the channels are connected again.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const DEV_KEY = "2mg-new-crm-local-only";

function key(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production")
      throw new Error("SECRETS_KEY isn't set: page tokens and mailbox passwords can't be kept.");
    return createHash("sha256").update(DEV_KEY).digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}

export function unseal(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data)
    throw new Error("A kept secret is unreadable: connect the channel again.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error(
      "A kept secret can't be opened with this server's SECRETS_KEY: connect the channel again.",
    );
  }
}
