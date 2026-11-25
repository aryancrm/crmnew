// node --test: the bridge against a stand-in for the bidding system's database and a stand-in CRM.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const KEY = 'a-key-for-the-stand-in-crm-0123456789';
const DB_KEY = 'the-bidding-systems-read-key';

async function serve(handler) {
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const out = await handler(req, new URL(req.url, 'http://127.0.0.1'), Buffer.concat(chunks).toString());
        res.writeHead(out.status || 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

// The bidding system's tables, as its own code writes them
const bidMatch = {
    headers: ['Notice Reference Number', 'Notice Title', 'Agency name', 'Mode of Procurement', 'Approve Budget Contract', 'Publish Date', 'Closing Date'],
    rows: [
        { cells: ['152987', 'Procurement of Drugs and Medicines', 'PROVINCE OF DAVAO DEL NORTE', 'Small Value Procurement', '₱1,484,125.00', '23-Nov-2026 12:00 AM', '26-Nov-2026 09:00 AM'], links: [{ href: 'https://philgeps.gov.ph/tenders/viewBidNotice/152987' }] },
        { cells: ['149000', 'Old notice, read long ago', 'BASILAN MEDICAL CENTER', 'Competitive Bidding (Public Bidding)', '', '01-Nov-2026 12:00 AM', '20-Dec-2026 10:00 AM'], links: [] },
    ],
};
const now = Date.now();
const tables = {
    philgeps_opportunities: [{ ref_no: '13321380', title: 'Supply of Various Drugs', procuring_entity: 'PROVINCE OF ZAMBOANGA DEL NORTE', publish_date: '2026-11-03', closing_date: '2026-11-24 10:00:00', abc_amount: 3201900, detail_link: null, items_text: 'Description\n1 100 vial Rocuronium 50mg/5ml 500.00 50,000.00', details: { notice_type: 'Invitation to Bid (ITB)', documents_items: [] } }],
    ps_philgeps_snapshot: [{ synced_at: new Date(now).toISOString(), lists: { bidMatch }, notices: {
        152987: { matched: ['Rocuronium'], matched_items: [{ line: '1 Rocuronium Bromide 10mg/ml, 5ml 2500 Ampule 287,225.00', description: 'Rocuronium Bromide 10mg/ml, 5ml', quantity: 2500, unit: 'Ampule', total: 287225 }], schedule: { prebid: 'Not required', bidOpening: '26-Nov-2026 09:00 AM' }, address: 'Provincial Capitol, Tagum City', documents: [{ name: 'S20266637.pdf', size: 551936, url: 'https://philgeps.gov.ph/portal_documents/x.pdf', path: '152987/S20266637.pdf' }], read_at: now },
        149000: { matched: [], matched_items: [], schedule: {}, documents: [], read_at: now - 30 * 86400000 },
    } }],
    ps_tender_analysis: [{ ref: '152987', status: 'done', analyzed_at: new Date(now).toISOString(), documents_read: [{ name: 'S20266637.pdf', kind: 'text', pages: 12 }], result: { bid_data_sheet: { bid_security: 'Bid Securing Declaration' }, items: [{ our_products: ['Rocuronium'], item_no: '1', description: 'Rocuronium Bromide 10mg/ml, 5ml', quantity: 2500, unit: 'Ampule', unit_price: 114.89, total: 287225 }], accuracy: { percent: 100 } } }],
    screened_tenders: [{ source: 'ps', ref: '152987', added_by: '2mgincorporated', added_at: '2026-11-21T00:29:00Z' }, { source: 'philgeps', ref: '13321380', added_by: null, added_at: '2026-11-20T01:00:00Z' }],
};

test('PS-PhilGEPS dates and numbers as the CRM takes them', async () => {
    const { psMoment, psRef } = await import('./feed.mjs');
    assert.deepEqual(psMoment('26-Nov-2026 09:00 AM'), { day: '2026-11-26', moment: '2026-11-26 09:00:00' });
    assert.deepEqual(psMoment('23-Nov-2026 12:00 AM'), { day: '2026-11-23', moment: '2026-11-23 00:00:00' });
    assert.deepEqual(psMoment('1-Dec-2026 1:30 PM'), { day: '2026-12-01', moment: '2026-12-01 13:30:00' });
    assert.deepEqual(psMoment('soon'), { day: null, moment: null });
    assert.equal(psRef({ cells: ['x'], links: [{ href: 'https://philgeps.gov.ph/tenders/viewBidNotice/155565' }] }), '155565');
    assert.equal(psRef({ cells: ['149000'], links: [] }), '149000');
    assert.equal(psRef({ cells: ['Total'], links: [] }), null);
});

test('the bridge: reads the bidding system only, hands both portals and the screened list to the CRM, then only what changed', async () => {
    const asked = [];
    const old = await serve((req, url) => {
        asked.push(`${req.method} ${url.pathname}${url.search}`);
        if (req.headers.apikey !== DB_KEY) return { status: 401, body: { message: 'no' } };
        const name = url.pathname.replace('/rest/v1/', '');
        const offset = Number(url.searchParams.get('offset') || 0);
        // (its own filters, as PostgREST applies them: rows changed since, rows by their numbers)
        const since = /^gt\.(.+)$/.exec(url.searchParams.get('updated_at') || '')?.[1];
        const readSince = /^gt\.(.+)$/.exec(url.searchParams.get('analyzed_at') || '')?.[1];
        const refs = /^in\.\((.*)\)$/.exec(url.searchParams.get('ref') || '')?.[1]?.split(',');
        let rows = name === 'philgeps_opportunities' && since ? [] : tables[name] || [];
        if (readSince) rows = rows.filter((r) => Date.parse(r.analyzed_at) > Date.parse(readSince));
        if (refs) rows = rows.filter((r) => refs.includes(String(r.ref)));
        // (a column asked for under another name: "bidMatch:lists->bidMatch")
        if (name === 'ps_philgeps_snapshot' && /bidMatch:lists->bidMatch/.test(url.searchParams.get('select') || '')) {
            rows = rows.map(({ lists, ...rest }) => ({ ...rest, bidMatch: lists.bidMatch }));
        }
        return { body: rows.slice(offset, offset + 500) };
    });
    const got = { notices: [], marks: [], runs: [] };
    const crm = await serve((req, url, body) => {
        if (req.headers.authorization !== `Bearer ${KEY}`) return { status: 401, body: { error: { message: 'Not the robot.' } } };
        const at = url.pathname.replace('/webhooks/tender-finder/', '');
        if (at === 'feed-state') return { body: { since: got.runs.length ? new Date(now + 1000).toISOString() : null } };
        if (at === 'notices') {
            const sent = JSON.parse(body).notices;
            got.notices.push(...sent);
            return { body: { taken: sent.length, fresh: sent.length, matched: sent.length } };
        }
        if (at === 'screened') {
            got.marks.push(...JSON.parse(body).marks);
            return { body: { screened: JSON.parse(body).marks.length } };
        }
        if (at === 'run') {
            got.runs.push(JSON.parse(body));
            return { body: { ok: true } };
        }
        return { status: 404, body: { error: { message: 'No such address.' } } };
    });
    process.env.CRM_URL = crm.url;
    process.env.TENDER_FINDER_KEY = KEY;
    try {
        const { handOver } = await import('./feed.mjs');
        const first = await handOver({ base: old.url, key: DB_KEY });
        assert.equal(first.philgeps.taken, 1);
        assert.equal(first.ps.taken, 2);
        // Nothing was written to the bidding system: only reads
        assert.ok(asked.every((line) => line.startsWith('GET ')), asked.join(', '));
        const ps = got.notices.find((one) => one.ref_no === '152987');
        assert.equal(ps.source, 'ps');
        assert.equal(ps.title, 'Procurement of Drugs and Medicines');
        assert.equal(ps.procuring_entity, 'PROVINCE OF DAVAO DEL NORTE');
        assert.equal(ps.publish_date, '2026-11-23');
        assert.equal(ps.closing_date, '2026-11-26 09:00:00');
        assert.equal(ps.abc_amount, 1484125);
        assert.equal(ps.detail_link, 'https://philgeps.gov.ph/tenders/viewBidNotice/152987');
        assert.equal(ps.details.procurement_mode, 'Small Value Procurement');
        assert.equal(ps.details.bid_opening, '26-Nov-2026 09:00 AM');
        assert.deepEqual(ps.details.documents, [{ name: 'S20266637.pdf', size: 551936, path: '152987/S20266637.pdf', source: 'notice' }]);
        assert.equal(ps.details.documents_items[0].unit_price, 114.89);
        assert.equal(ps.details.documents_bid_data_sheet.bid_security, 'Bid Securing Declaration');
        assert.equal(got.notices.find((one) => one.ref_no === '13321380').source, 'philgeps');
        assert.deepEqual(got.marks, [
            { source: 'ps', ref: '152987', by: '2mgincorporated', at: '2026-11-21T00:29:00Z' },
            { source: 'philgeps', ref: '13321380', by: null, at: '2026-11-20T01:00:00Z' },
        ]);
        assert.equal(got.runs.at(-1).trigger, 'feed');
        assert.match(got.runs.at(-1).summary, /1 PhilGEPS and 2 PS-PhilGEPS tenders/);

        // The first time every reading is read once
        assert.ok(asked.some((line) => line.startsWith('GET /rest/v1/ps_tender_analysis?') && !line.includes('analyzed_at=gt.') && !line.includes('ref=in.')));
        // and of the snapshot only the Bid Match list and the notices (not My Opportunities, not the awards)
        assert.ok(asked.some((line) => line.includes('ps_philgeps_snapshot?') && decodeURIComponent(line).includes('bidMatch:lists->bidMatch')), asked.join('\n'));

        // An hour later: nothing was read again there, so no tender is handed over again, and the
        // readings are not read again whole (only the ones read since: none)
        got.notices.length = 0;
        asked.length = 0;
        const again = await handOver({ base: old.url, key: DB_KEY });
        assert.equal(again.philgeps.taken, 0);
        assert.equal(again.ps.taken, 0);
        assert.equal(got.notices.length, 0);
        const readingAsks = asked.filter((line) => line.includes('/ps_tender_analysis?'));
        assert.equal(readingAsks.length, 1, readingAsks.join('\n'));
        assert.match(readingAsks[0], /analyzed_at=gt\./);

        // Later still: the Sync read notice 152987's page again (its papers' reading did not change), and
        // the papers of 149000 were read for the first time. Both are handed over; the reading of 152987
        // is asked for by its number alone, so its lines from the papers come along.
        const notices = tables.ps_philgeps_snapshot[0].notices;
        notices[152987].read_at = now + 5000;
        tables.ps_tender_analysis.push({ ref: '149000', status: 'done', analyzed_at: new Date(now + 5000).toISOString(), documents_read: [], result: { items: [] } });
        got.notices.length = 0;
        asked.length = 0;
        const later = await handOver({ base: old.url, key: DB_KEY });
        assert.equal(later.ps.taken, 2);
        assert.equal(got.notices.find((one) => one.ref_no === '152987').details.documents_items[0].unit_price, 114.89);
        assert.ok(asked.some((line) => /ps_tender_analysis\?.*ref=in\.\(152987\)/.test(line)), asked.join('\n'));
        assert.ok(!asked.some((line) => /ref=in\.\([^)]*149000/.test(line)), 'a reading read since is not asked for twice');

        // A notice seen for the first time (first_seen is ISO text, not milliseconds) counts as changed
        const { psRefsSeenSince } = await import('./feed.mjs');
        const seen = { bidMatch, notices: { 152987: { read_at: now - 99999, first_seen: new Date(now + 9000).toISOString() } } };
        assert.deepEqual(psRefsSeenSince(seen, now), ['152987']);
    } finally {
        await old.close();
        await crm.close();
    }
});
