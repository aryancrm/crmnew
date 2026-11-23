// The robot's way into the CRM (docs/PLAN.md 24): its own door, /webhooks/tender-finder. It asks
// which molecules are ours and which notices the CRM has already read, and hands in what it found
// and how each run went. It holds no database password and no person's login.
//
//   CRM_URL            the CRM's API, e.g. https://api.example.com (no trailing slash needed)
//
// Who it is, on every call:
// - on GitHub (the workflow .github/workflows/tender-finder.yml): a short-lived token GitHub signs
//   for that workflow, asked fresh for each call. Nothing to set, no secret anywhere.
// - elsewhere (the company's server, the office PC): TENDER_FINDER_KEY, the same key as on the
//   CRM's server (24 characters or more).

const AUDIENCE = 'crmnew-tender-finder';

const base = () => {
    const url = (process.env.CRM_URL || '').replace(/\/+$/, '');
    if (!url) throw new Error('CRM_URL is not set (the address of the CRM\'s API)');
    return `${url}/webhooks/tender-finder`;
};

async function whoIAm() {
    if (process.env.TENDER_FINDER_KEY) return process.env.TENDER_FINDER_KEY;
    const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const ask = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !ask) {
        throw new Error('No way in to the CRM: on GitHub the workflow needs "id-token: write"; elsewhere set TENDER_FINDER_KEY');
    }
    const res = await fetch(`${url}&audience=${AUDIENCE}`, { headers: { authorization: `Bearer ${ask}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`GitHub gave no token for the CRM (${res.status})`);
    return (await res.json()).value;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A server waking up or restarting (a deploy) answers 502-504 or not at all for a moment: tried
// three times. A refusal (wrong key, wrong shape) is said at once.
async function call(path, body) {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(`${base()}/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { authorization: `Bearer ${await whoIAm()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(120000)
            });
            if (res.ok) return res.json();
            const said = await res.json().catch(() => ({}));
            last = new Error(`The CRM refused ${path} (${res.status}): ${said.error?.message || res.statusText}`);
            if (![502, 503, 504].includes(res.status)) throw last;
        } catch (err) {
            if (err === last && !/\((?:502|503|504)\)/.test(err.message)) throw err;
            last = err;
        }
        if (attempt < 3) await pause(attempt * 5000);
    }
    throw last;
}

// Our molecules, as the CRM's medicines give them: [{ name, match: [spellings] }]
const molecules = () => call('molecules');

// The notices the CRM has already read: [{ ref_no, items_text, abc_amount, details }]
const known = (source, refs) => (refs.length ? call('known', { source, refs }) : Promise.resolve([]));

// The CRM takes 50 notices and 2 MB a call: sent in small batches. Returns { taken, fresh, matched }.
const BATCH = 20;
const BATCH_BYTES = 1200000;
async function send(notices) {
    const total = { taken: 0, fresh: 0, matched: 0 };
    let batch = [];
    let bytes = 0;
    const flush = async () => {
        if (!batch.length) return;
        const got = await call('notices', { notices: batch });
        for (const key of Object.keys(total)) total[key] += got[key] || 0;
        batch = [];
        bytes = 0;
    };
    for (const notice of notices) {
        // Only what the CRM reads: the tender, its notice page, the lines that are ours
        const row = {
            source: notice.source || 'philgeps',
            ref_no: String(notice.ref_no),
            title: String(notice.title || '').slice(0, 4000),
            procuring_entity: notice.procuring_entity || null,
            publish_date: notice.publish_date || null,
            closing_date: notice.closing_date || null,
            abc_amount: typeof notice.abc_amount === 'number' ? notice.abc_amount : null,
            detail_link: notice.detail_link || null,
            items_text: notice.items_text ? String(notice.items_text).slice(0, 400000) : null,
            details: notice.details || null
        };
        const size = Buffer.byteLength(JSON.stringify(row));
        if (batch.length >= BATCH || bytes + size > BATCH_BYTES) await flush();
        batch.push(row);
        bytes += size;
    }
    await flush();
    return total;
}

// How a run went: { source, trigger, status: 'success' | 'failed', summary, found, matched, fresh }
const run = (report) => call('run', { ...report, summary: String(report.summary || '').slice(0, 2000) });

// ---- the tender papers (papers/papers.mjs) ----

// Our medicines as the paper reader's product list: [{ generic_name, brand_name, dosage, dosage_form, ... }]
const products = () => call('products');

// The notices whose papers the robot looks after (the ones the team screened), as it keeps a notice
const papers = () => call('papers');

// Bytes in, bytes out: a paper handed to the CRM, a kept paper asked back (null when the CRM has none)
async function raw(pathAndQuery, bytes) {
    const res = await fetch(`${base()}/${pathAndQuery}`, {
        method: bytes ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${await whoIAm()}`, ...(bytes ? { 'content-type': 'application/octet-stream' } : {}) },
        body: bytes || undefined,
        signal: AbortSignal.timeout(300000)
    });
    if (res.status === 404 && !bytes) return null;
    if (!res.ok) {
        const said = await res.json().catch(() => ({}));
        throw new Error(`The CRM refused a paper (${res.status}): ${said.error?.message || res.statusText}`);
    }
    return bytes ? res.json() : Buffer.from(await res.arrayBuffer());
}
const query = (fields) => new URLSearchParams(fields).toString();
const keepPaper = ({ source, ref, path, name, bulletin, bytes }) => raw(`papers/file?${query({ source: source || 'philgeps', ref, path, name, kind: bulletin ? 'bulletin' : 'paper' })}`, bytes);
const paper = (ref, path, source = 'philgeps') => raw(`papers/file?${query({ source, ref, path })}`);
// The papers the CRM keeps of one notice: [{ path, name, size }]
const papersList = (source, ref) => call(`papers/list?${query({ source, ref })}`);
// What is screened in the CRM: [{ source, ref }]
const screenedList = () => call('screened');

// ---- the robots' own records (papers/supabase-shim) ----

// A table's rows as the robot keeps them; rows handed in ({ key, value }) or taken away (keys)
const store = async (table) => (await call(`store?${query({ table })}`)).rows;
async function storeWrite(table, { upsert = [], remove = [] }) {
    // (a Sync's lists and notices are several MB: one row a call when rows are large)
    for (let i = 0; i < upsert.length; i += 50) await call('store', { table, upsert: upsert.slice(i, i + 50) });
    if (remove.length) await call('store', { table, remove });
}

// The robot's log-ins to a portal, kept by the CRM across runs: the last day's (for the guard's counts),
// a new one, and where the log-in stands ({ state: 'never' | 'ok' | 'refused' | 'busy' | 'trouble', at, said })
const logins = (site, since) => call(`logins?${query({ site, ...(since ? { since } : {}) })}`);
const login = (row) => call('logins', { site: row.site, outcome: row.outcome, detail: row.detail || null, source: row.source || null });
const loginState = () => call('login-state');

// ---- the bidding team's own system handing over (feed/feed.mjs) ----

// Since when it has handed over ({ since: ISO | null }), and what it screened: [{ source, ref, by, at }]
const feedState = () => call('feed-state');
async function screened(marks) {
    let done = 0;
    for (let i = 0; i < marks.length; i += 500) done += (await call('screened', { marks: marks.slice(i, i + 500) })).screened || 0;
    return done;
}

module.exports = { molecules, known, send, run, products, papers, keepPaper, paper, papersList, screenedList, store, storeWrite, logins, login, loginState, feedState, screened };
