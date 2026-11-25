// node --test: the paper reader (papers/lib/psDocs.mjs, unchanged) inside this worker, on a real
// PDF price schedule and on the same page as a picture only (a scan, read by OCR).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.SUPABASE_URL = 'http://crm.invalid';
process.env.SUPABASE_KEY = 'the-crm-keeps-it';
process.env.PAPERS_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-'));
const { createClient, configure } = await import('./supabase-shim/index.mjs');
const { readDocuments, rememberDownload } = await import('./lib/psDocs.mjs');
const { buildMatcher } = await import('./lib/products.mjs');
configure({ crm: { paper: async () => null } });

// Our medicines as the CRM hands them to the reader
const matcher = buildMatcher([
    { generic_name: 'Letrozole', brand_name: 'Letrozole', dosage: '2.5 mg' },
    { generic_name: 'Imatinib mesylate', brand_name: 'Imatinib', dosage: '400 mg' },
]);
const ours = [
    ['Letrozole', '1', 12000, 'tablet', 22.5, 270000],
    ['Imatinib', '2', 3000, 'tablet', 95, 285000],
];

async function readFile(name) {
    const bytes = fs.readFileSync(path.join(here, 'checks', name));
    const key = `13000001/${name}`;
    rememberDownload('philgeps-documents', key, bytes);
    const out = await readDocuments(createClient(), 'philgeps-documents', [{ name, path: key, size: bytes.length }], matcher, { ocrUntil: Date.now() + 120000 });
    return { out, lines: (out.result?.items || []).map((i) => [i.our_products[0], i.item_no, i.quantity, i.unit, i.unit_price, i.total]) };
}

test('a PDF price schedule: our medicines with quantity, unit, price and total; another medicine left out', async () => {
    const { out, lines } = await readFile('price-schedule.pdf');
    assert.equal(out.status, 'done');
    assert.deepEqual(out.read, [{ name: 'price-schedule.pdf', kind: 'text', pages: 1 }]);
    assert.deepEqual(lines, ours);
    assert.equal(out.result.accuracy.percent, 100);
});

test('the same page as a scan (a picture, no text): read by OCR to the same lines', async () => {
    const { out, lines } = await readFile('price-schedule-scan.pdf');
    assert.equal(out.status, 'done');
    assert.equal(out.read[0].ocr_pages, 1);
    assert.deepEqual(lines, ours);
});
