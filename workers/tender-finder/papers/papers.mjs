// The tender papers (docs/PLAN.md 24): for the notices the team screened in the CRM, the robot
// logs in to PhilGEPS with the company's own account, "orders" each notice's bid documents at no
// cost (it stops at anything that asks a payment), downloads them and its bid bulletins, logs out,
// reads them (PDF, Word, Excel; scans by OCR) for our medicines and hands the files and the lines
// to the CRM.
//
// The work itself is the bidding team's tender finder, unchanged, in papers/lib (philgepsSync.mjs:
// log-in, order, download, log-out; psDocs.mjs: the reader). This file only decides what to do in
// one run and passes things between that code and the CRM (supabase-shim/index.mjs explains how
// their Supabase calls land in the CRM).
//
//   PHILGEPS_USERNAME / PHILGEPS_PASSWORD   the company's PhilGEPS log-in (GitHub secrets). With
//                                           none set, nothing is logged in to: only papers the
//                                           CRM already keeps are read.
//   CRM_URL, and who the robot is           as for scraper.js (crm.js)
//
// Account safety, as in the original: one log-in a run, a refused password is never sent again
// until a person says so in the CRM, the log-in guard's limits (papers/lib/loginGuard.mjs) count
// across runs, and the log-out is always made and confirmed, whatever happened in between.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crm = require('../crm.js');

// The vendored modules ask for these before they talk to "Supabase" (here: the CRM, through the shim)
process.env.SUPABASE_URL ||= 'http://crm.invalid';
process.env.SUPABASE_KEY ||= 'the-crm-keeps-it';

const { configure, uploads, createClient } = await import('./supabase-shim/index.mjs');
const sync = await import('./lib/philgepsSync.mjs');
const { buildMatcher } = await import('./lib/products.mjs');

// One run's time for fetching (the workflow gives the whole job 45 minutes; the log-out needs a moment)
const FETCH_MS = Number(process.env.PAPERS_FETCH_MINUTES || 18) * 60 * 1000;
const say = (text) => console.log(`papers: ${text}`);

// A paper downloaded in this run, handed to the CRM (and let go of here)
async function handIn(ref, documents) {
    let files = 0;
    for (const doc of documents) {
        const held = uploads.get(doc.path);
        if (!held) continue;
        await crm.keepPaper({ ref, path: doc.path, name: doc.name, bulletin: doc.source === 'bulletin', bytes: held.bytes });
        files++;
    }
    return files;
}

// What was read in a notice's papers, as the CRM takes a notice
const toCrm = (o, details) => crm.send([{ ...o, source: 'philgeps', details }]);

// Reads a notice's downloaded papers for our medicines; a reading that could not finish (a long scan)
// is said and left for the next run, never fatal
async function read(supabase, matcher, o, details) {
    try {
        const update = await sync.readTenderDocuments(supabase, matcher, o, details);
        return update.details;
    } catch (e) {
        say(`${o.ref_no}: its papers are not read to the end yet (${e.message})`);
        return { ...details, documents_read_note: String(e.message).slice(0, 300) };
    }
}

const lookedAtToday = (o) => Date.now() - Date.parse(o.details?.documents_checked_at || 0) < sync.RECHECK_MS;
const newBulletin = (o) => {
    const d = o.details || {};
    const tried = new Set(d.documents_supplements_tried || []);
    return (d.supplements?.length || 0) > (d.documents_supplements_seen || 0) || sync.supplementNos(d.supplements).some((no) => !tried.has(no));
};

async function main() {
    const started = Date.now();
    const supabase = createClient();
    const wanted = await crm.papers();
    if (!wanted.length) {
        say('no screened notice is open: nothing to do');
        return;
    }
    configure({ crm, screened: wanted.map((o) => String(o.ref_no)) });
    const matcher = buildMatcher(await crm.products());

    // 1. Papers the CRM keeps that are not read yet (a scan left unfinished, a changed medicine list): no log-in
    let reread = 0;
    // (only papers the CRM itself keeps: ones the bidding team's own system still holds are read there)
    const kept = (o) => (o.details?.documents || []).filter((d) => d.path && !d.removed).every((d) => (o.kept || []).includes(d.path));
    for (const o of wanted.filter((one) => kept(one) && sync.needsReading(one, matcher.key))) {
        say(`${o.ref_no}: reading its papers again`);
        const details = await read(supabase, matcher, o, o.details || {});
        await toCrm(o, details);
        o.details = details;
        reread++;
    }

    // 2. Notices whose papers are still to fetch. One looked at within the day with nothing to get (it asks
    // a payment, it has no papers) is left until tomorrow, unless a new bid bulletin came: no log-in for nothing.
    const pending = wanted.filter((o) => sync.needsDocuments(o) && (newBulletin(o) || !lookedAtToday(o)));
    if (!pending.length) {
        say(`${wanted.length} screened, none waiting for its papers${reread ? `, ${reread} read again` : ''}`);
        return;
    }
    if (!process.env.PHILGEPS_USERNAME || !process.env.PHILGEPS_PASSWORD) {
        say(`${pending.length} screened notices wait for their papers: no PhilGEPS log-in is set (PHILGEPS_USERNAME / PHILGEPS_PASSWORD)`);
        return;
    }
    const standing = await crm.loginState();
    if (standing.state === 'refused') {
        say(`PhilGEPS refused the log-in (${standing.said || 'no reason given'}): not tried again until a person says so in the CRM`);
        return;
    }

    const session = new sync.Session();
    let sent = false;
    let files = 0;
    let done = 0;
    let stopped = null;
    let later = 0;
    // Whatever ends this run, the account is logged out
    const leave = async () => {
        if (!sent) return true;
        sent = false;
        const out = await sync.logout(session);
        say(out ? 'logged out of PhilGEPS (confirmed)' : 'THE LOG-OUT COULD NOT BE CONFIRMED');
        if (!out) await crm.login({ site: 'philgeps', outcome: 'error', detail: 'The log-out could not be confirmed after the papers run', source: 'github' }).catch(() => {});
        return out;
    };
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => leave().finally(() => process.exit(1)));

    try {
        say(`logging in to PhilGEPS for ${pending.length} notices`);
        await sync.login(session, async () => { sent = true; }, { trigger: 'schedule', source: 'github' });
        for (const o of pending) {
            if (Date.now() - started > FETCH_MS) {
                later = pending.length - done;
                break;
            }
            let result;
            try {
                result = await sync.fetchTender(session, supabase, o, () => {});
            } catch (e) {
                if (e.code === 'SESSION_ENDED' || e.code === 'SITE_DOWN') throw e;
                say(`${o.ref_no}: ${e.message}`);
                done++;
                continue;
            }
            // As philgepsSync.mjs runSyncRound keeps a tender's papers: one entry per stored file
            const previous = o.details?.documents || [];
            result.documents = result.documents.filter((d, i, all) => all.findIndex((x) => x.path === d.path) === i);
            const names = new Set(result.documents.map((d) => d.name));
            let details = {
                ...(o.details || {}),
                documents: [...previous.filter((d) => !names.has(d.name)), ...result.documents],
                documents_status: previous.length || result.documents.length ? 'downloaded' : result.status,
                documents_remark: result.remark,
                documents_checked_at: new Date().toISOString(),
                documents_supplements_seen: o.details?.supplements?.length || 0,
                documents_supplements_tried: result.supplementsTried || o.details?.documents_supplements_tried || [],
            };
            files += await handIn(o.ref_no, result.documents);
            if (sync.needsReading({ details }, matcher.key)) details = await read(supabase, matcher, o, details);
            for (const doc of result.documents) uploads.delete(doc.path);
            await toCrm(o, details);
            say(`${o.ref_no}: ${details.documents_status}${result.documents.length ? `, ${result.documents.length} files` : ''}${result.ordered ? ' (ordered now, at no cost)' : ''}`);
            done++;
        }
    } catch (e) {
        stopped = e.message;
        say(e.message);
    } finally {
        const out = await leave();
        const summary = `Papers: ${done} of ${pending.length} screened notices looked at, ${files} files kept${later ? `; ${later} wait for the next run` : ''}${stopped ? `; stopped: ${stopped}` : ''}${out ? '' : '; THE LOG-OUT COULD NOT BE CONFIRMED'}`;
        await crm.run({ source: 'philgeps', trigger: 'papers', status: stopped || !out ? 'failed' : 'success', summary, found: done, matched: files, fresh: 0 }).catch(() => {});
        say(summary);
        if (!out) process.exitCode = 1;
    }
}

await main().catch((e) => {
    console.error(`papers: ${e.message}`);
    process.exitCode = 1;
});
