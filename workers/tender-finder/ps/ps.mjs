// The CRM's own PS-PhilGEPS robot (docs/PLAN.md 25, step 6). The work is the bidding team's own
// module, unchanged (papers/lib/psSync.mjs): with the log-in session a person made (the site has a
// captcha, so a person connects once: ps/connect), it reads Bid Match, My Opportunities and Award
// Notices, adds the open medicine notices Bid Match leaves out, reads each notice (its lines, its
// dates, its papers) and then the papers themselves for our medicines (papers/lib/psDocs.mjs).
// It only reads: nothing on PS-PhilGEPS is accepted, refused or changed.
//
// Its records (the last Sync's lists and notices, each tender's reading, the session) are kept by
// the CRM (papers/supabase-shim); this file starts one Sync and then puts what it found on the
// CRM's finder.
//
//   node ps/ps.mjs               one Sync (nothing when PS-PhilGEPS is not connected)
//   node ps/ps.mjs --keepalive   one page with the saved session, so PS-PhilGEPS does not end it
//                                for being idle (it does, well under an hour)

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crm = require('../crm.js');

process.env.SUPABASE_URL ||= 'http://crm.invalid';
process.env.SUPABASE_KEY ||= 'the-crm-keeps-it';
// The notices' pages are where the Sync finds our medicines, the dates and the papers. Its old host stopped a
// request at 300 s, so it read notices for 210 s from the Sync's start; at 606 Bid Match rows the list alone
// took that, and no notice was read (25 Nov). Here nothing stops it: 25 minutes for the notices (the workflow
// allows 45 in all, with 12 for the papers' reading after), and a Sync is taken as cut off only after 40.
process.env.PS_NOTICES_MINUTES ||= '25';
process.env.PS_STALE_MINUTES ||= '40';

const { createClient, uploads } = await import('../papers/supabase-shim/index.mjs');
const ps = await import('../papers/lib/psSync.mjs');
const { analyzePending } = await import('../papers/lib/psDocs.mjs');
const { psNotices } = await import('../feed/feed.mjs');

const say = (text) => console.log(`ps: ${text}`);
// After the Sync itself (which stops reading at 260 s, as its old host made it), more time for the papers
const READ_MS = Number(process.env.PS_READ_MINUTES || 12) * 60 * 1000;
// Where the last hand-over to the finder is remembered (one of the robot's own rows)
const MARK = 'crm-handover';

// What the last Sync holds, put on the CRM's finder: the notices read again since the last time
async function toFinder(supabase) {
    const { data: mark } = await supabase.from('philgeps_sync_relay').select('job').eq('id', MARK).maybeSingle();
    const { data: snapshot } = await supabase.from('ps_philgeps_snapshot').select('synced_at, lists, notices').eq('id', 'latest').maybeSingle();
    if (!snapshot) return { taken: 0, listed: 0 };
    const { data: readings } = await supabase.from('ps_tender_analysis').select('ref, status, result, documents_read, analyzed_at');
    const started = Date.now();
    const { notices, listed } = psNotices(snapshot, new Map((readings || []).map((r) => [String(r.ref), r])), Number(mark?.job?.at) || 0);
    const taken = notices.length ? await crm.send(notices) : { taken: 0, fresh: 0, matched: 0 };
    await supabase.from('philgeps_sync_relay').upsert({ id: MARK, job: { at: started }, updated_at: new Date().toISOString() });
    return { ...taken, listed };
}

async function main() {
    const supabase = createClient();
    if (process.argv.includes('--keepalive')) {
        const kept = await ps.keepAlive();
        say(kept.skipped ? `keep-alive skipped (${kept.skipped})` : kept.connected ? 'the session is alive' : kept.ended ? 'PS-PhilGEPS ended the session: a person connects again (captcha)' : 'not connected');
        return;
    }
    // Who started it: the hourly schedule, or a person's Fetch now on the Tender finder (--trigger=manual).
    // The bidding system's module logs a Sync not started by the schedule as a person's, which the CRM's
    // Fetch now waits for (apps/api/src/tenders/fetch-now.ts).
    const manual = process.argv.includes('--trigger=manual');
    const claim = await ps.claimSync(manual ? 'Fetch now' : 'schedule');
    if (claim.notConnected) {
        say('PS-PhilGEPS is not connected: a person connects once (captcha), then the Sync runs every hour');
        return;
    }
    if (!claim.started) {
        say('a Sync is already running');
        return;
    }
    let stage;
    try {
        stage = await ps.runSync();
        say(stage || 'Sync done');
    } catch (e) {
        // (its status, with the reason, is already kept for the finder's page)
        say(`Sync stopped: ${e.message}`);
        if (e.code === 'NOT_CONNECTED') return;
    }
    // The papers not read yet (the Sync reads for a few minutes only)
    const reading = await analyzePending({ maxMs: READ_MS }).catch((e) => ({ error: e.message }));
    if (reading?.error) say(`reading the papers: ${reading.error}`);
    else if (reading && (reading.read || reading.left)) say(`papers read for ${reading.read} tenders, ${reading.left} waiting`);
    const handed = await toFinder(supabase);
    say(`${handed.taken} of ${handed.listed} PS-PhilGEPS tenders put on the CRM's finder (${handed.fresh || 0} new)`);
    // The papers downloaded in this run, now that their tenders are on the finder (the CRM keeps a paper
    // only on a tender it has); the ones the reader found are not ours were let go of already
    let kept = 0;
    for (const [key, held] of [...uploads]) {
        if (held.bucket !== 'ps-documents') continue;
        try {
            await crm.keepPaper({ source: 'ps', ref: key.split('/')[0], path: key, name: key.split('/').slice(1).join('/'), bulletin: false, bytes: held.bytes });
            kept++;
        } catch (e) {
            say(`${key}: not kept (${e.message})`);
        }
        fs.rmSync(held.file, { force: true });
        uploads.delete(key);
    }
    if (kept) say(`${kept} papers kept by the CRM`);
}

await main().catch((e) => {
    console.error(`ps: ${e.message}`);
    process.exitCode = 1;
});
