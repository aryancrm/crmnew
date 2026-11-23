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

module.exports = { molecules, known, send, run };
