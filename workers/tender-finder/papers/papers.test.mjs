// node --test: the whole papers run against a stand-in PhilGEPS and a stand-in CRM on this
// computer. Nothing here reaches the real PhilGEPS or a real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startPhilgeps } from './checks/stand-in-philgeps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = 'a-key-for-the-stand-in-crm-0123456789';
const pdf = fs.readFileSync(path.join(here, 'checks', 'price-schedule.pdf'));

// A stand-in CRM: the robot's door only, remembering what it was handed
async function startCrm(notices) {
    const got = { files: [], notices: new Map(), logins: [], runs: [], cleared: false };
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const json = (value, status = 200) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(value));
        };
        if (req.headers.authorization !== `Bearer ${KEY}`) return json({ error: { message: 'Not the robot.' } }, 401);
        const at = url.pathname.replace('/webhooks/tender-finder/', '');
        if (at === 'papers' && req.method === 'GET') return json(notices.map((o) => ({ ...o, details: got.notices.get(o.ref_no)?.details || o.details })));
        if (at === 'products') return json([
            { generic_name: 'Letrozole', brand_name: 'Letrozole', dosage: '2.5 mg' },
            { generic_name: 'Imatinib mesylate', brand_name: 'Imatinib', dosage: '400 mg' },
        ]);
        if (at === 'login-state') {
            const last = [...got.logins].reverse().find((one) => ['ok', 'rejected', 'cleared'].includes(one.outcome));
            return json({ state: !last ? 'never' : last.outcome === 'rejected' ? 'refused' : 'ok', at: null, said: last?.detail || null });
        }
        if (at === 'logins' && req.method === 'GET') return json(got.logins.map((one) => ({ at: one.at, outcome: one.outcome, detail: one.detail })).reverse());
        if (at === 'logins') {
            got.logins.push({ ...JSON.parse(body), at: new Date().toISOString() });
            return json({ ok: true });
        }
        if (at === 'papers/file' && req.method === 'POST') {
            got.files.push({ ref: url.searchParams.get('ref'), path: url.searchParams.get('path'), name: url.searchParams.get('name'), kind: url.searchParams.get('kind'), bytes: body });
            return json({ id: got.files.length });
        }
        if (at === 'papers/file') {
            const kept = got.files.find((one) => one.path === url.searchParams.get('path'));
            if (!kept) return json({ error: { message: 'No such paper.' } }, 404);
            res.writeHead(200, { 'content-type': 'application/octet-stream' });
            return res.end(kept.bytes);
        }
        if (at === 'notices') {
            for (const one of JSON.parse(body).notices) got.notices.set(one.ref_no, one);
            return json({ taken: 1, fresh: 0, matched: 1 });
        }
        if (at === 'run') {
            got.runs.push(JSON.parse(body));
            return json({ ok: true });
        }
        return json({ error: { message: 'No such address.' } }, 404);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, got, close: () => new Promise((resolve) => server.close(resolve)) };
}

// One run of papers.mjs as the workflow makes it: its own process
function runPapers(env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(here, 'papers.mjs')], {
            env: { PATH: process.env.PATH, HOME: process.env.HOME, PAPERS_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'papers-test-')), ...env },
            cwd: path.join(here, '..'),
        });
        let out = '';
        child.stdout.on('data', (chunk) => (out += chunk));
        child.stderr.on('data', (chunk) => (out += chunk));
        child.on('close', (code) => resolve({ code, out }));
    });
}

const notice = (ref, title) => ({ ref_no: ref, title, procuring_entity: 'East Avenue Medical Center', publish_date: '2026-11-20', closing_date: '2099-12-01 13:00:00', abc_amount: 600000, matched_molecules: [], items_text: 'Description\nPlease see the attached bidding documents', details: { notice_type: 'Invitation to Bid (ITB)' } });

test('papers: logs in once, orders only what is free, keeps and reads the file, logs out', async () => {
    const site = await startPhilgeps({ file: { name: 'Price Schedule.pdf', bytes: pdf } });
    const crm = await startCrm([notice(site.refs.free, 'Supply of Letrozole and Imatinib'), notice(site.refs.paid, 'Bid documents sold'), notice(site.refs.closed, 'Closed notice')]);
    const env = { CRM_URL: crm.url, TENDER_FINDER_KEY: KEY, PHILGEPS_TEST_HOST: site.host, PHILGEPS_USERNAME: 'company', PHILGEPS_PASSWORD: 'right-password' };
    try {
        const run = await runPapers(env);
        assert.equal(run.code, 0, run.out);
        // One log-in, one password sent, and nobody left logged in
        assert.equal(site.state.logins, 1);
        assert.equal(site.state.posts, 1);
        assert.equal(site.state.loggedIn.size, 0, 'the account is logged out');
        assert.deepEqual(crm.got.logins.map((one) => one.outcome), ['started', 'ok']);
        // Only the free notice was ordered; the one that asks a payment and the closed one were not
        assert.deepEqual([...site.state.orders.keys()], [site.refs.free]);
        const free = crm.got.notices.get(site.refs.free).details;
        assert.equal(free.documents_status, 'downloaded');
        assert.deepEqual(free.documents.map((d) => [d.name, d.source, d.size]), [['Price Schedule.pdf', 'order', pdf.length]]);
        // The file reached the CRM whole, and was read: our two medicines, not the third line
        assert.equal(crm.got.files.length, 1);
        assert.ok(crm.got.files[0].bytes.equals(pdf));
        assert.equal(crm.got.files[0].kind, 'paper');
        assert.deepEqual(free.documents_items.map((i) => [i.our_products[0], i.quantity, i.unit_price, i.total]), [['Letrozole', 12000, 22.5, 270000], ['Imatinib', 3000, 95, 285000]]);
        assert.equal(free.documents_accuracy.percent, 100);
        assert.equal(crm.got.notices.get(site.refs.paid).details.documents_status, 'needs-payment');
        assert.equal(crm.got.notices.get(site.refs.closed).details.documents_status, 'closed');
        assert.match(crm.got.runs.at(-1).summary, /3 of 3 screened notices looked at, 1 files kept/);
        assert.equal(crm.got.runs.at(-1).status, 'success');

        for (const one of crm.got.logins) one.at = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
        // The next run, an hour later: the free one is done, the closed one is left alone, the one that asks a
        // payment was looked at today. No log-in at all, and the file is not downloaded twice.
        const again = await runPapers(env);
        assert.equal(again.code, 0, again.out);
        assert.equal(site.state.logins, 1);
        assert.match(again.out, /none waiting for its papers/);
        assert.equal(site.state.downloads, 1);
        assert.equal(site.state.orders.size, 1);
        assert.equal(site.state.loggedIn.size, 0);
        assert.equal(crm.got.files.length, 1);
    } finally {
        await site.close();
        await crm.close();
    }
});

test('papers: a refused password is recorded, logged out of, and never sent again by itself', async () => {
    const site = await startPhilgeps({ file: { name: 'Price Schedule.pdf', bytes: pdf } });
    const crm = await startCrm([notice(site.refs.free, 'Supply of Letrozole and Imatinib')]);
    const env = { CRM_URL: crm.url, TENDER_FINDER_KEY: KEY, PHILGEPS_TEST_HOST: site.host, PHILGEPS_USERNAME: 'company', PHILGEPS_PASSWORD: 'wrong-password' };
    try {
        const run = await runPapers(env);
        assert.equal(site.state.posts, 1, run.out);
        assert.equal(site.state.refused, 1);
        assert.deepEqual(crm.got.logins.map((one) => one.outcome), ['started', 'rejected']);
        assert.equal(site.state.orders.size, 0);
        assert.equal(crm.got.runs.at(-1).status, 'failed');
        // An hour later: no password is sent at all
        const later = await runPapers(env);
        assert.equal(site.state.posts, 1, later.out);
        assert.match(later.out, /not tried again until a person says so/);
        // A person, the password put right, says to try again: one new log-in, and the work is done
        // (the guard also keeps log-ins a minute apart: these were two hours ago)
        for (const one of crm.got.logins) one.at = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
        crm.got.logins.push({ site: 'philgeps', outcome: 'cleared', detail: 'By Jimmy', at: new Date().toISOString() });
        const fixed = await runPapers({ ...env, PHILGEPS_PASSWORD: 'right-password' });
        assert.equal(fixed.code, 0, fixed.out);
        assert.equal(site.state.posts, 2);
        assert.equal(site.state.orders.size, 1);
        assert.equal(site.state.loggedIn.size, 0);
    } finally {
        await site.close();
        await crm.close();
    }
});

test('papers: with no PhilGEPS log-in set, PhilGEPS is never asked anything', async () => {
    const site = await startPhilgeps({ file: { name: 'Price Schedule.pdf', bytes: pdf } });
    const crm = await startCrm([notice(site.refs.free, 'Supply of Letrozole and Imatinib')]);
    try {
        const run = await runPapers({ CRM_URL: crm.url, TENDER_FINDER_KEY: KEY, PHILGEPS_TEST_HOST: site.host });
        assert.equal(run.code, 0, run.out);
        assert.match(run.out, /no PhilGEPS log-in is set/);
        assert.equal(site.state.requests, 0);
        assert.equal(crm.got.logins.length, 0);
    } finally {
        await site.close();
        await crm.close();
    }
});
