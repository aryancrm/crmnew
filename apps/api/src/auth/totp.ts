// The codes an authenticator app shows (RFC 6238: six digits, thirty seconds, SHA-1, what Google
// Authenticator, Microsoft Authenticator and 1Password read), as Bishnoi One makes them.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STEP_SECONDS = 30;
const DIGITS = 6;
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ABC[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ABC[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const letter of text.toUpperCase().replace(/=+$/, "")) {
    const at = ABC.indexOf(letter);
    if (at < 0) throw new Error("Not a base32 key.");
    value = ((value << 5) | at) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new key: 160 bits, as the RFC asks. */
export const newKey = () => base32(randomBytes(20));

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

export function codeAt(key: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", fromBase32(key)).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The time step a code is for (now, or one either side: a phone's clock a little off), else null. */
export function stepOfCode(key: string, code: string, ms = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(ms);
  let found: number | null = null;
  // The newest that matches, so it can't be used again a step later.
  for (const step of [now - 1, now, now + 1])
    if (timingSafeEqual(Buffer.from(codeAt(key, step)), Buffer.from(code))) found = step;
  return found;
}

/** What the QR code says. */
export function setupUri(account: string, key: string, issuer = "Bishnoi One CRM"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${key}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
