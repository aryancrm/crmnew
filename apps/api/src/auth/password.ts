// Passwords are kept only as a salted scrypt hash: "scrypt$<salt>$<hash>", both base64url.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** What a new password must be, in the words the screen shows; null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  // The company's old common password (JOIN_PASSWORD, while the server still has it) is everyone's
  // secret, so it is nobody's own.
  const retired = process.env.JOIN_PASSWORD?.trim();
  if (retired && password.trim() === retired) return "That is the company's old password. Choose one only you know.";
  return null;
}
