// node --test: the PS-PhilGEPS robot (papers/lib/psSync.mjs, unchanged) run by ps.mjs against a
// stand-in PS-PhilGEPS and a stand-in CRM, both inside this process (every request is answered
// here: nothing reaches the real site, an account or a real CRM).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pdf = fs.readFileSync(path.join(here, '..', 'papers', 'checks', 'price-schedule.pdf'));
const KEY = 'a-key-for-the-stand-in-crm-0123456789';
process.env.CRM_URL = 'http://crm.test';
process.env.TENDER_FINDER_KEY = KEY;
process.env.PAPERS_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-test-'));
process.env.PS_READ_MINUTES = '1';

// ---- the stand-in CRM: the robot's door, with the store ----
const crm = { store: new Map(), files: [], notices: [], runs: [] };
const rowsOf = (table) => [...(crm.store.get(table) || new Map()).values()];
function crmAnswer(url, init) {
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (init?.headers?.authorization !== `Bearer ${KEY}`) return json({ error: { message: 'Not the robot.' } }, 401);
    const at = url.pathname.replace('/webhooks/tender-finder/', '');
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (at === 'products') return json([{ generic_name: 'Letrozole', brand_name: 'Letrozole', dosage: '2.5 mg' }, { generic_name: 'Imatinib mesylate', brand_name: 'Imatinib', dosage: '400 mg' }]);
    if (at === 'screened' && !init?.method) return json([{ source: 'ps', ref: '152987' }]);
    if (at === 'store' && init?.method === 'POST') {
        const table = crm.store.get(body.table) || crm.store.set(body.table, new Map()).get(body.table);
        for (const row of body.upsert || []) table.set(row.key, row.value);
        for (const key of body.remove || []) table.delete(key);
        return json({ kept: (body.upsert || []).length, removed: (body.remove || []).length });
    }
    if (at === 'store') return json({ rows: rowsOf(url.searchParams.get('table')) });
    if (at === 'papers/file' && init?.method === 'POST') {
        // As the real CRM: a paper is kept only on a tender it has
        if (!crm.notices.some((one) => one.source === url.searchParams.get('source') && one.ref_no === url.searchParams.get('ref'))) return json({ error: { message: 'No such notice.' } }, 404);
        crm.files.push({ source: url.searchParams.get('source'), ref: url.searchParams.get('ref'), path: url.searchParams.get('path'), name: url.searchParams.get('name'), bytes: Buffer.from(init.body) });
        return json({ id: crm.files.length });
    }
    if (at === 'papers/file') {
        const kept = crm.files.find((one) => one.path === url.searchParams.get('path'));
        return kept ? new Response(kept.bytes, { status: 200 }) : json({ error: { message: 'No such paper.' } }, 404);
    }
    if (at === 'papers/list') return json(crm.files.filter((one) => one.ref === url.searchParams.get('ref')).map((one) => ({ path: one.path, name: one.name, size: one.bytes.length })));
    if (at === 'notices') {
        crm.notices.push(...body.notices);
        return json({ taken: body.notices.length, fresh: body.notices.length, matched: body.notices.length });
    }
    if (at === 'run') {
        crm.runs.push(body);
        return json({ ok: true });
    }
    return json({ error: { message: `No such address: ${at}` } }, 404);
}

// ---- the stand-in PS-PhilGEPS: the pages psSync.mjs reads, in the shape it reads them ----
const site = { connected: true, asked: [] };
const list = (headers, rows = '') => `<html><body><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
const BID_MATCH = ['Notice Reference Number', 'Notice Title', 'Agency name', 'Mode of Procurement', 'Approve Budget Contract', 'Publish Date', 'Closing Date'];
function siteAnswer(url, init) {
    site.asked.push(`${init?.method || 'GET'} ${url.pathname}`);
    const page = (html) => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    if (!site.connected) return page('<html><body><form action="/users/login" method="post"><input name="username"/></form></body></html>');
    const at = url.pathname;
    if (at === '/EventManagements/myBidMatch') {
        return page(list(BID_MATCH, '<tr><td><a href="/tenders/viewBidNotice/152987">152987</a></td><td>Procurement of Drugs and Medicines</td><td>PROVINCE OF DAVAO DEL NORTE</td><td>Small Value Procurement</td><td>555,000.00</td><td>23-Nov-2099 12:00 AM</td><td>26-Nov-2099 09:00 AM</td></tr>'));
    }
    if (at === '/EventManagements/myOpportunities') return page(list(['Notice Reference Number', 'Notice Title', 'Bid Submission Status']));
    if (at === '/EventManagements/myAwardNotices') return page(list(['Award Notice Number', 'Line Item', 'Award Acceptance']));
    if (at === '/Indexes/index') return page(`<html><body><form method="post"><input name="searchNoticeTitle" value=""/></form>${list(['Bid Notice Reference Number', 'Notice Title', 'Mode of Procurement'])}</body></html>`);
    if (at === '/tenders/viewBidNotice/152987') {
        return page(`<html><body><center class="verdhana_twelvepx">PROVINCE OF DAVAO DEL NORTE</center><center class="verdhana_twelvepx">Provincial Capitol, Tagum City</center><center class="verdhana_twelvepx">Request for Quotation</center>
<p>Notice Reference Number: 152987</p><p>Closing Date: 26-Nov-2099 09:00 AM</p>
<table><tr><th>Item No.</th><th>Lot Description</th><th>Quantity</th><th>Unit of Measure</th><th>ABC(Estimated Budget)</th></tr>
<tr><td>1</td><td>Letrozole 2.5 mg tablet</td><td>12000</td><td>Tablet</td><td>270,000.00</td></tr>
<tr><td>2</td><td>Paracetamol 500 mg tablet</td><td>50000</td><td>Tablet</td><td>60,000.00</td></tr></table>
<a href_path="/tenders/tender_doc_view/152987">Preview</a></body></html>`);
    }
    if (at === '/Tenders/tender_shedule/152987') {
        return page('<div class="table-row"><div class="table-col-label">Pre-Bid Meeting :</div><div class="table-col-value">Not Required</div></div><div class="table-row"><div class="table-col-label">Bid Opening Start :</div><div class="table-col-value">26-Nov-2099 09:00 AM</div></div>');
    }
    if (at === '/tenders/tender_doc_view/152987') return page('<a href="/portal_documents/9/Price%20Schedule.pdf">Price Schedule.pdf</a>');
    if (at === '/portal_documents/9/Price%20Schedule.pdf') return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    return new Response('not here', { status: 404 });
}

globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === 'http://crm.test') return crmAnswer(url, init);
    if (url.hostname === 'philgeps.gov.ph') return siteAnswer(url, init);
    throw new Error(`The test reached outside: ${url.origin}`);
};

const put = (table, key, value) => (crm.store.get(table) || crm.store.set(table, new Map()).get(table)).set(key, value);
let runs = 0;
const run = async (...flags) => {
    const argv = process.argv;
    process.argv = [argv[0], 'ps.mjs', ...flags];
    try {
        await import(`./ps.mjs?run=${++runs}`);
    } finally {
        process.argv = argv;
    }
};

test('not connected: nothing is asked of PS-PhilGEPS', async () => {
    await run();
    assert.equal(site.asked.length, 0);
    assert.equal(crm.notices.length, 0);
});

test('connected: one Sync reads the lists, the notice and its paper, keeps its records in the CRM and puts the tender on the finder', async () => {
    // As a person's Connect leaves it: the session and "connected since"
    put('ps_philgeps_session', 'current', { id: 'current', cookies: [{ name: 'PHPSESSID', value: 'made-by-a-person' }], saved_at: new Date().toISOString() });
    put('ps_sync_status', 'latest', { id: 'latest', status: 'idle', connected_at: new Date().toISOString() });
    await run();

    // Only reads on PS-PhilGEPS (the searches are its own search form's posts), and never a log-in
    assert.ok(site.asked.every((line) => line.startsWith('GET ') || line === 'POST /Indexes/index'), site.asked.join(', '));
    assert.ok(site.asked.includes('GET /tenders/viewBidNotice/152987'));
    // Its own records, each as it wrote it, in the CRM's store
    const status = crm.store.get('ps_sync_status').get('latest');
    assert.equal(status.status, 'success', JSON.stringify(status));
    assert.ok(status.connected_at);
    const snapshot = crm.store.get('ps_philgeps_snapshot').get('latest');
    assert.equal(snapshot.lists.bidMatch.rows.length, 1);
    assert.deepEqual(snapshot.lists.bidMatch.headers, BID_MATCH);
    const notice = snapshot.notices['152987'];
    assert.deepEqual(notice.matched, ['Letrozole']);
    assert.equal(notice.schedule.prebid, 'Not required');
    assert.deepEqual(notice.documents.map((d) => [d.name, d.size, d.path]), [['Price Schedule.pdf', pdf.length, '152987/Price_Schedule.pdf']]);
    // The paper is kept by the CRM (for the new portal), whole
    assert.deepEqual(crm.files.map((f) => [f.source, f.ref, f.path]), [['ps', '152987', '152987/Price_Schedule.pdf']]);
    assert.ok(crm.files[0].bytes.equals(pdf));
    // ... and read: our two medicines from the price schedule
    const reading = crm.store.get('ps_tender_analysis').get('152987');
    assert.equal(reading.status, 'done');
    assert.deepEqual(reading.result.items.map((i) => [i.our_products[0], i.quantity, i.unit_price]), [['Letrozole', 12000, 22.5], ['Imatinib', 3000, 95]]);
    // The tender is on the CRM's finder as a notice of the new portal
    const found = crm.notices.find((one) => one.ref_no === '152987');
    assert.equal(found.source, 'ps');
    assert.equal(found.procuring_entity, 'PROVINCE OF DAVAO DEL NORTE');
    assert.equal(found.closing_date, '2099-11-26 09:00:00');
    assert.equal(found.abc_amount, 555000);
    assert.equal(found.details.bid_opening, '26-Nov-2099 09:00 AM');
    assert.equal(found.details.matched_items[0].quantity, 12000);
    assert.equal(found.details.documents_items.length, 2);
    assert.equal(crm.runs.at(-1).source, 'ps');
    assert.equal(crm.runs.at(-1).status, 'success');

    // The next Sync: the paper the CRM keeps is not downloaded again
    const downloads = () => site.asked.filter((line) => line.includes('/portal_documents/')).length;
    assert.equal(downloads(), 1);
    crm.notices.length = 0;
    put('ps_sync_status', 'latest', { ...crm.store.get('ps_sync_status').get('latest'), started_at: new Date(Date.now() - 3600000).toISOString() });
    await run();
    assert.equal(downloads(), 1);
    assert.equal(crm.files.length, 1);
});

test('keep-alive: one page with the saved session; a session PS-PhilGEPS ended is forgotten and said', async () => {
    const before = site.asked.length;
    await run('--keepalive');
    assert.deepEqual(site.asked.slice(before), ['GET /EventManagements/myBidMatch']);
    assert.ok(crm.store.get('ps_philgeps_session').get('current'));
    // PS-PhilGEPS ends the session: the robot forgets it and says "not connected"; the next Sync asks nothing
    site.connected = false;
    await run('--keepalive');
    assert.equal(crm.store.get('ps_philgeps_session').has('current'), false);
    assert.equal(crm.store.get('ps_sync_status').get('latest').connected_at, null);
    const asked = site.asked.length;
    await run();
    assert.equal(site.asked.length, asked);
});
