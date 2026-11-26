// Starts the API: opens the database, brings it up to date, then listens.
//
// Several companies (COMPANIES=on, Aryan 26 Nov 2026): each company's data in its own database,
// listed in one more, and each request answered on its company's (companies/). Without it, one
// company as before: the server's own database, answering everything.

import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { asCompany } from "./companies/context";
import { controlRoutes } from "./companies/control-routes";
import { folderPlaces, openCompanies, postgresPlaces } from "./companies/registry";
import { companyRouter } from "./companies/router";
import { companyTick, readyCompany } from "./companies/start";
import { openDatabase } from "./db/index";
import { startKeepAwake } from "./keep-awake";
import { startChannelJobs } from "./online/inbox";

const port = Number(process.env.PORT ?? 4100);
const webUrl = process.env.WEB_URL ?? "http://localhost:5180";
const secure = webUrl.startsWith("https://");
const mainUrl = process.env.DATABASE_URL || undefined;
const mainDir = process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pg", import.meta.url));
const embedded = !mainUrl;
const QUARTER_HOUR = 15 * 60 * 1000;

const listening = () => {
  console.log(`api: listening on http://localhost:${port}`);
  startKeepAwake();
};

if (process.env.COMPANIES !== "on") {
  const db = openDatabase({ url: mainUrl, dir: mainDir });
  const start = { home: true, embedded };
  await readyCompany(db, start);
  setInterval(() => companyTick(db, start), QUARTER_HOUR).unref();
  // Every connected Facebook page and mailbox is read on a timer, and the webhook's events worked.
  if (process.env.CHANNEL_JOBS !== "off") startChannelJobs(db);
  serve({ fetch: createApp(db, { webUrl }).fetch, port }, listening);
} else {
  const places = mainUrl ? postgresPlaces(mainUrl) : folderPlaces(mainDir);
  const control = await places.control();
  const list = await openCompanies({
    control,
    places,
    // The server's own database is the first company's (named so on the list's first start).
    home: {
      name: process.env.HOME_COMPANY_NAME ?? "2MG Inc.",
      code: process.env.HOME_COMPANY_CODE ?? "2MG",
      loginDomain: process.env.LOGIN_DOMAIN ?? "2mginc.com",
    },
    ready: (db, ref) =>
      asCompany(ref, async () => {
        await readyCompany(db, { home: ref.home, embedded, label: ref.code });
        // The pages and mailboxes set up on the server are the first company's.
        if (ref.home && process.env.CHANNEL_JOBS !== "off") startChannelJobs(db);
        return createApp(db, { webUrl });
      }),
  });
  for (const one of list.all()) console.log(`company: ${one.ref.name} (${one.ref.code}, Org ID ${one.ref.orgId}, @${one.ref.loginDomain})`);
  setInterval(() => {
    for (const one of list.all())
      if (!one.row.pausedAt)
        asCompany(one.ref, () => companyTick(one.db, { home: one.ref.home, embedded, label: one.ref.code }));
  }, QUARTER_HOUR).unref();
  const panel = controlRoutes(control, list, { secure });
  await panel.announceSetup();
  serve({ fetch: companyRouter(list, { secure, control: panel.app }).fetch, port }, listening);
}
