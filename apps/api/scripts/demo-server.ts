// The demo company beside the real one, to try every seat's screens on this computer: its own
// database (.data/demo), its API on :4101, the web on :5181 (pnpm dev:demo-web). The first run
// makes the demo people, one per desk and per kind of MedRep (server.ts, SEED_DEMO), each
// <name>@2mg.test with the password given once in SEED_PASSWORD; later runs only open it.
//
//   SEED_PASSWORD=<your choice> pnpm dev:demo-api    (the first time)
//   pnpm dev:demo-api                                (after)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../.data/demo", import.meta.url));
process.env.PGLITE_DIR = dir;
process.env.PORT ??= "4101";
process.env.WEB_URL ??= "http://localhost:5181";
process.env.CHANNEL_JOBS ??= "off";
if (!existsSync(dir)) {
  if (!process.env.SEED_PASSWORD) throw new Error("The first run makes the demo people: give SEED_PASSWORD (their password).");
  process.env.SEED_DEMO = "1";
}
await import("../src/server");
