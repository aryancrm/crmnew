// The bridge (docs/PLAN.md 25). The bidding team's own system (the "Government Bidding System",
// built apart so that it could be moved into the CRM) still finds and reads the tenders on both
// portals while its work moves into the CRM piece by piece. Until the CRM's own robot does all of
// it, this hands over what that system holds, every hour, so the CRM is never behind it:
//
//   - its PhilGEPS tenders, with what it read in their papers (same shape as the CRM's door takes)
//   - its PS-PhilGEPS tenders (the new portal: Bid Match, each notice, the papers' reading)
//   - what the team screened there
//
// It only READS that system (its database's REST address with a key that may read), and writes
// only to the CRM, through the robot's door. Nothing in that system changes.
//
//   BIDDING_SUPABASE_URL / BIDDING_SUPABASE_KEY   that system's database (GitHub secrets). With
//                                                 none set, nothing is done.
//   CRM_URL, and who the robot is                 as for scraper.js (crm.js)
//   node feed/feed.mjs --all                      everything again, not only what changed

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const crm = require('../crm.js');
const say = (text) => console.log(`feed: ${text}`);

// ---------- reading that system (PostgREST) ----------

async function table(base, key, path) {
    const rows = [];
    for (let from = 0; ; from += 500) {
        const res = await fetch(`${base}/rest/v1/${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${from}`, {
            headers: { apikey: key, authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) throw new Error(`The bidding system's database refused ${path.split('?')[0]} (${res.status})`);
        const page = await res.json();
        rows.push(...page);
        if (page.length < 500) return rows;
    }
}

// ---------- PS-PhilGEPS: a Bid Match row as the CRM takes a notice ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const two = (n) => String(n).padStart(2, '0');

// PS-PhilGEPS writes "23-Oct-2026 12:00 AM": the day, and the moment in Philippine time without a zone
export function psMoment(text) {
    const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(text || '');
    const month = m && MONTHS[m[2].toLowerCase()];
    if (!month) return { day: null, moment: null };
    const day = `${m[3]}-${two(month)}-${two(m[1])}`;
    if (!m[4]) return { day, moment: null };
    const hour = (Number(m[4]) % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
    return { day, moment: `${day} ${two(hour)}:${m[5]}:00` };
}

// The notice's number: its link to the notice page, else a numeric first cell (as the system itself does)
export function psRef(row) {
    const link = (row.links || []).find((l) => /viewBidNotice\/(\d+)/.test(l.href || ''));
    if (link) return /viewBidNotice\/(\d+)/.exec(link.href)[1];
    return /^\d+$/.test(row.cells?.[0] || '') ? row.cells[0] : null;
}

const peso = (text) => {
    const value = Number(String(text || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(value) && value > 0 ? value : null;
};

// row: a Bid Match row { cells, links }; notice: what the Sync read on the notice's page; reading: what was read
// in its papers (ps_tender_analysis)
export function psNotice(row, headers, notice, reading) {
    const ref = psRef(row);
    if (!ref) return null;
    const cell = (name) => row.cells[headers.indexOf(name)] || '';
    const done = reading?.status === 'done' ? reading.result || {} : {};
    const schedule = notice?.schedule || {};
    const documents = (notice?.documents || []).map((d) => ({ name: d.name, size: d.size, path: d.path, source: 'notice' }));
    return {
        source: 'ps',
        ref_no: ref,
        title: cell('Notice Title') || `Notice ${ref}`,
        procuring_entity: cell('Agency name') || null,
        publish_date: psMoment(cell('Publish Date')).day,
        closing_date: psMoment(cell('Closing Date')).moment || psMoment(cell('Closing Date')).day,
        abc_amount: peso(cell('Approve Budget Contract')),
        detail_link: `https://philgeps.gov.ph/tenders/viewBidNotice/${ref}`,
        // The notice's own lines, as text too (the CRM looks for our medicines in it)
        items_text: (notice?.matched_items || []).map((item) => item.line || item.description || '').filter(Boolean).join('\n') || null,
        details: {
            procurement_mode: cell('Mode of Procurement') || null,
            pre_bid: schedule.prebid || null,
            bid_opening: schedule.bidOpening || null,
            contact_info: notice?.address ? [notice.address] : [],
            matched_items: notice?.matched_items || [],
            documents,
            documents_status: documents.length ? 'downloaded' : null,
            documents_items: (done.items || []).slice(0, 300),
            documents_bid_data_sheet: done.bid_data_sheet || null,
            documents_read: reading?.documents_read || null,
            documents_accuracy: done.accuracy || null,
            package: done.package,
        },
    };
}

// The Bid Match rows of a Sync as notices for the CRM: all of them, or (sinceMs) only those read again since
export function psNotices(snapshot, readings, sinceMs = 0) {
    const list = snapshot?.lists?.bidMatch || { headers: [], rows: [] };
    const out = [];
    for (const row of list.rows || []) {
        const ref = psRef(row);
        const notice = ref ? snapshot.notices?.[ref] : null;
        const reading = ref ? readings.get(ref) : null;
        const changed = !sinceMs || (notice?.read_at || 0) > sinceMs || Date.parse(reading?.analyzed_at || 0) > sinceMs || (notice?.first_seen || 0) > sinceMs;
        const one = changed ? psNotice(row, list.headers || [], notice, reading) : null;
        if (one) out.push(one);
    }
    return { notices: out, listed: (list.rows || []).length };
}

// ---------- one hand-over ----------

export async function handOver({ base, key, all = false }) {
    const { since } = all ? { since: null } : await crm.feedState();
    const sinceMs = since ? Date.parse(since) : 0;
    say(since ? `what changed since ${since}` : 'everything (the first hand-over)');

    // 1. Its PhilGEPS tenders: already in the shape the CRM's door takes
    const columns = 'ref_no,title,procuring_entity,publish_date,closing_date,abc_amount,detail_link,items_text,details';
    const philgeps = await table(base, key, `philgeps_opportunities?select=${columns}&order=id${since ? `&updated_at=gt.${encodeURIComponent(since)}` : ''}`);
    const first = philgeps.length ? await crm.send(philgeps.map((o) => ({ ...o, source: 'philgeps' }))) : { taken: 0, fresh: 0, matched: 0 };
    say(`PhilGEPS: ${first.taken} tenders handed over (${first.fresh} new to the CRM)`);

    // 2. Its PS-PhilGEPS tenders: the last Sync's Bid Match, each notice, the papers' reading
    const [snapshot] = await table(base, key, 'ps_philgeps_snapshot?id=eq.latest&select=synced_at,lists,notices');
    const readings = new Map((await table(base, key, 'ps_tender_analysis?select=ref,status,result,documents_read,analyzed_at&order=ref')).map((r) => [String(r.ref), r]));
    const { notices: ps, listed } = psNotices(snapshot, readings, sinceMs);
    const second = ps.length ? await crm.send(ps) : { taken: 0, fresh: 0, matched: 0 };
    say(`PS-PhilGEPS: ${second.taken} of ${listed} tenders handed over (${second.fresh} new to the CRM)`);

    // 3. What the team screened there
    const marks = (await table(base, key, 'screened_tenders?select=source,ref,added_by,added_at&order=added_at')).map((s) => ({ source: s.source === 'ps' ? 'ps' : 'philgeps', ref: String(s.ref), by: s.added_by || null, at: s.added_at || null }));
    const screened = marks.length ? await crm.screened(marks) : 0;
    say(`screened there: ${marks.length} (${screened} newly screened in the CRM)`);

    const summary = `From the bidding system: ${first.taken} PhilGEPS and ${second.taken} PS-PhilGEPS tenders, ${screened} newly screened`;
    await crm.run({ source: 'ps', trigger: 'feed', status: 'success', summary, found: first.taken + second.taken, matched: first.matched + second.matched, fresh: first.fresh + second.fresh });
    return { philgeps: first, ps: second, screened };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const base = (process.env.BIDDING_SUPABASE_URL || '').replace(/\/+$/, '');
    const key = process.env.BIDDING_SUPABASE_KEY || '';
    if (!base || !key) {
        say('the bidding system\'s database is not set (BIDDING_SUPABASE_URL / BIDDING_SUPABASE_KEY): nothing handed over');
    } else {
        await handOver({ base, key, all: process.argv.includes('--all') }).catch(async (e) => {
            console.error(`feed: ${e.message}`);
            await crm.run({ source: 'ps', trigger: 'feed', status: 'failed', summary: `From the bidding system: ${e.message}` }).catch(() => {});
            process.exitCode = 1;
        });
    }
}
