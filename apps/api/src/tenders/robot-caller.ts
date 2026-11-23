// Who is at the robot's door (docs/PLAN.md 24). The tender finder's robot is no person, so it has
// no sign-in. It is let in one of two ways:
//
// 1. From this repository's own GitHub workflow (.github/workflows/tender-finder.yml on main),
//    where the robot runs: GitHub signs a short-lived token saying which repository, branch and
//    workflow is asking, and that signature is checked here against GitHub's published keys.
//    No shared secret exists, so none can leak or needs typing anywhere.
// 2. With a key (TENDER_FINDER_KEY, 24 characters or more, the same on the robot's computer),
//    for a robot run elsewhere: the company's server, the office PC.
//
// Either opens the door only: /webhooks/tender-finder, nothing else of the CRM.

import { createHash, createPublicKey, type JsonWebKey, timingSafeEqual, verify } from "node:crypto";

const ISSUER = "https://token.actions.githubusercontent.com";
/** What the workflow asks its token for; a token made for anything else is refused. */
export const ROBOT_AUDIENCE = "crmnew-tender-finder";
const WORKFLOW = ".github/workflows/tender-finder.yml";
/** The repository whose workflow is the robot: this one. TENDER_FINDER_GITHUB names another
 *  ("owner/name"), or "off" to shut this way in. */
const trustedRepository = () => (process.env.TENDER_FINDER_GITHUB || "aryancrm/crmnew").trim();
const keySet = () => (process.env.TENDER_FINDER_KEY ?? "").trim().length >= 24;

type GithubKey = JsonWebKey & { kid?: string };
let fetchKeys = async (): Promise<GithubKey[]> => {
  const response = await fetch(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub's keys: ${response.status}`);
  return ((await response.json()) as { keys: GithubKey[] }).keys;
};
let kept: { at: number; keys: GithubKey[] } | null = null;

/** For the tests: GitHub's keys from somewhere else. */
export function useGithubKeys(fetcher: () => Promise<GithubKey[]>): void {
  fetchKeys = fetcher;
  kept = null;
}

/** GitHub's signing key of that id: kept an hour, asked again (at most once a minute) for an id
 *  not seen, since GitHub changes its keys. */
async function githubKey(id: string): Promise<GithubKey | null> {
  const age = kept ? Date.now() - kept.at : Number.POSITIVE_INFINITY;
  if (!kept || age > 3_600_000 || (!kept.keys.some((key) => key.kid === id) && age > 60_000)) kept = { at: Date.now(), keys: await fetchKeys() };
  return kept.keys.find((key) => key.kid === id) ?? null;
}

const decoded = (part: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** A GitHub Actions token from the robot's workflow on this repository's main branch: signed by
 *  GitHub (RS256 only), made for this door, not expired, and saying exactly that workflow. */
export async function fromRobotWorkflow(token: string, now = Date.now()): Promise<boolean> {
  const repository = trustedRepository();
  if (!repository || repository === "off") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [head, body, signature] = parts as [string, string, string];
  const header = decoded(head);
  const claims = decoded(body);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return false;
  const key = await githubKey(header.kid).catch(() => null);
  if (!key || key.kty !== "RSA") return false;
  let signed = false;
  try {
    signed = verify("RSA-SHA256", Buffer.from(`${head}.${body}`), createPublicKey({ key, format: "jwk" }), Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
  const seconds = now / 1000;
  return (
    signed &&
    claims.iss === ISSUER &&
    claims.aud === ROBOT_AUDIENCE &&
    typeof claims.exp === "number" &&
    claims.exp > seconds &&
    (typeof claims.nbf !== "number" || claims.nbf <= seconds + 60) &&
    claims.repository === repository &&
    claims.ref === "refs/heads/main" &&
    claims.job_workflow_ref === `${repository}/${WORKFLOW}@refs/heads/main`
  );
}

/** "ok" lets the robot in; "off" when neither way in is set up on this server; "no" otherwise. */
export async function robotCaller(header: string | undefined): Promise<"ok" | "off" | "no"> {
  const given = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (keySet()) {
    const hash = (text: string) => createHash("sha256").update(text).digest();
    if (timingSafeEqual(hash((process.env.TENDER_FINDER_KEY ?? "").trim()), hash(given))) return "ok";
  }
  if (given && (await fromRobotWorkflow(given))) return "ok";
  return robotReady() ? "no" : "off";
}

/** Whether the robot has a way in on this server. */
export const robotReady = () => keySet() || !["", "off"].includes(trustedRepository());
