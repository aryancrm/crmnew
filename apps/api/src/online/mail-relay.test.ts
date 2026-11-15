import { createHmac } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { isRelayUrl, pairRelay, pingRelay, relaySend, useRelayFetch } from "./mail-relay";

const URL_OK = "https://script.google.com/macros/s/AKfycbx1234567890abcdefghijk/exec";

/** A stand-in for the Apps Script: pairs once, checks every signature, keeps what it sent. */
function fakeScript() {
  let secret: string | null = null;
  const sent: { key: string; raw: string }[] = [];
  const handler = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { op?: string; payload?: string; sig?: string };
    const answer = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (body.op === "pair") {
      if (secret) return answer({ ok: false, error: "already paired" });
      secret = "s".repeat(48);
      return answer({ ok: true, secret, email: "info@2mginc.com" });
    }
    const expected = createHmac("sha256", secret ?? "").update(body.payload ?? "").digest("hex");
    if (!secret || body.sig !== expected) return answer({ ok: false, error: "bad signature" });
    const payload = JSON.parse(body.payload ?? "{}") as { op: string; key?: string; raw?: string };
    if (payload.op === "ping") return answer({ ok: true, email: "info@2mginc.com" });
    sent.push({ key: payload.key ?? "", raw: Buffer.from(payload.raw ?? "", "base64url").toString() });
    return answer({ ok: true });
  };
  return { handler, sent, secret: () => secret };
}

describe("sending through the company's Google script", () => {
  afterAll(() => useRelayFetch(undefined));

  it("knows a script's address", () => {
    expect(isRelayUrl(URL_OK)).toBe(true);
    expect(isRelayUrl("https://example.com/exec")).toBe(false);
  });

  it("pairs once, then sends signed emails the script can read", async () => {
    const script = fakeScript();
    useRelayFetch(script.handler as typeof fetch);
    const paired = await pairRelay(URL_OK);
    expect(paired.email).toBe("info@2mginc.com");
    await expect(pairRelay(URL_OK)).rejects.toThrow(/delete CRM_SECRET/);
    expect((await pingRelay(URL_OK, paired.secret)).email).toBe("info@2mginc.com");
    await expect(pingRelay(URL_OK, "wrong".repeat(10))).rejects.toThrow(/bad signature/);
    await relaySend(URL_OK, paired.secret, {
      from: { address: "info@2mginc.com", name: "2MG Inc." },
      to: "patient@example.com",
      subject: "Your quotation",
      text: "Hello",
      messageId: "<abc@2mginc.com>",
    });
    expect(script.sent).toHaveLength(1);
    expect(script.sent[0]?.key).toBe("<abc@2mginc.com>");
    expect(script.sent[0]?.raw).toMatch(/Subject: Your quotation/);
    expect(script.sent[0]?.raw).toMatch(/To: patient@example.com/);
  });
});
