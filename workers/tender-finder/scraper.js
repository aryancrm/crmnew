// The tender finder's robot: reads the public PhilGEPS list of open "Drugs and Medicines" tenders,
// each new tender's notice page (item list, budget, details) and its bid supplements, keeps the
// lines that ask for our molecules, and hands everything to the CRM (docs/PLAN.md 24).
//
// From the bidding team's tender finder (github.com/kenshiiir0/Hospital-Bidding-System, scraper.js).
// The reading of PhilGEPS is its code unchanged; what changed: nothing is written to Supabase (the
// CRM keeps it: crm.js), our molecules come from the CRM's medicines (molecules.js), and the
// logged-in part (the tender papers, OCR, PS-PhilGEPS) is not here yet: it needs the company's
// PhilGEPS log-ins.
//
//   node scraper.js                      one run: read PhilGEPS, hand in to the CRM
//   node scraper.js --dry-run            first results page only, nothing sent, prints the matches
//   node scraper.js --full               re-check every tender's bid supplements
//   node scraper.js --from-file=x.json   no browser: hand in a saved list (to test the CRM's door)
//   node scraper.js --trigger=schedule   who started it, kept with the run in the CRM
const fs = require('node:fs');
const { loadMatcher } = require('./molecules');
const { extractSchedule } = require('./schedule');
const { parseItemLine, toIsoDate, toTimestamp } = require('./parse');
const crm = require('./crm');

// Public (no-login) PhilGEPS pages live under /GEPSNONPILOT/. The /GEPS/ equivalents redirect to log-in.aspx.
const OPEN_OPPORTUNITIES_URL = 'https://notices.philgeps.gov.ph/GEPSNONPILOT/Tender/SplashOpenOpportunitiesUI.aspx?ClickFrom=OpenOpp&menuIndex=3';
const CATEGORY_NAME = 'Drugs and Medicines';
const MAX_PAGES = 60; // ~20 rows per page; safety cap in case the pager never ends
const DETAIL_CONCURRENCY = 4; // detail pages opened in parallel
// Public list of a tender's bid bulletins/addenda. The files themselves need a PhilGEPS log-in, so only the list is read.
const SUPPLEMENTS_URL = (ref) =>
    `https://notices.philgeps.gov.ph/GEPSNONPILOT/Tender/SplashBidSupplementsListUI.aspx?menuIndex=3&directFrom=BidAbstract&refID=${ref}`;

const DRY_RUN = process.argv.includes('--dry-run');
// Supplement lists checked less than this long ago are reused. --full re-checks every tender.
const SUPPLEMENTS_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const FULL_RUN = process.argv.includes('--full');
const ROWS_PER_PAGE = 20;
// Tries to open the first PhilGEPS page (it flickers to a redirect loop for new visitors)
const OPEN_TRIES = 8;
const FROM_FILE = (process.argv.find((a) => a.startsWith('--from-file=')) || '').slice('--from-file='.length);

function progress(percent, stage, warning) {
    console.log(`${String(Math.round(percent)).padStart(3)}% ${stage}${warning ? ` (${warning})` : ''}`);
}

// Read the item list (Description + Line Items), ABC and notice details from a tender's
// Bid Notice Abstract page. Returns null for closed/error pages so the tender is retried on the next run.
async function fetchDetails(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return page.evaluate(() => {
        const text = document.body.innerText;
        if (!text.includes('Bid Notice Abstract')) return null;
        const start = text.search(/\n\s*Description\s*\n/);
        const end = text.search(/\n\s*Created by/);
        const items = start >= 0 ? text.slice(start, end > start ? end : undefined) : '';
        const abc = /Approved Budget for the Contract:\s*PHP\s*([\d,]+(?:\.\d+)?)/.exec(text);

        // Header rows are "Label:<tab>value" (or "Label<tab>value" for the boxed fields)
        const field = (label) => {
            const m = new RegExp(`${label}:?\\t([^\\n]*)`).exec(text);
            return m ? m[1].replace('Printable Version', '').trim() || null : null;
        };
        const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
        const afterTitle = lines(text.slice(text.indexOf('Bid Notice Abstract') + 'Bid Notice Abstract'.length));
        // Contact block: name, designation, address, phones, email; ends at the Status box
        const contact = /Contact Person:\t([\s\S]*?)\n\s*Status/.exec(text);
        const contactLines = contact ? lines(contact[1]) : [];
        const status = /\tStatus\t\s*\n+\s*([^\n]+)/.exec(text);

        return {
            items_text: items.replace(/[\t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(),
            abc_amount: abc ? Number(abc[1].replace(/,/g, '')) : null,
            details: {
                notice_type: afterTitle[0] || null,
                solicitation_no: field('Solicitation Number'),
                procurement_mode: field('Procurement Mode'),
                classification: field('Classification'),
                area_of_delivery: field('Area of Delivery'),
                delivery_period: field('Delivery Period'),
                client_agency: field('Client Agency'),
                contact_name: contactLines[0] || null,
                contact_info: contactLines.slice(1),
                status: status ? status[1].trim() : null,
                last_updated: field('Last Updated / Time')
            }
        };
    });
}

// Bid supplements (bulletins, addenda) listed for a tender: [{ no, title, type, published }]
async function fetchSupplements(page, ref) {
    await page.goto(SUPPLEMENTS_URL(ref), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const rows = await page.evaluate(() => {
        const header = Array.from(document.querySelectorAll('tr'))
            .find((tr) => tr.cells.length >= 4 && /Bid Supplement No\./.test(tr.cells[0].innerText));
        if (!header) return [];
        const table = header.closest('table');
        return Array.from(table.rows)
            .slice(Array.from(table.rows).indexOf(header) + 1)
            .map((tr) => Array.from(tr.cells).map((td) => td.innerText.trim()))
            .filter((cells) => cells.length >= 4 && cells[0]);
    });
    return rows.map(([no, title, type, published]) => ({ no, title, type, published: toIsoDate(published) }));
}

// Bid supplements (bulletins, addenda) listed for a tender: [{ no, title, type, published }]
async function fetchSupplements(page, ref) {
    await page.goto(SUPPLEMENTS_URL(ref), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const rows = await page.evaluate(() => {
        const header = Array.from(document.querySelectorAll('tr'))
            .find((tr) => tr.cells.length >= 4 && /Bid Supplement No\./.test(tr.cells[0].innerText));
        if (!header) return [];
        const table = header.closest('table');
        return Array.from(table.rows)
            .slice(Array.from(table.rows).indexOf(header) + 1)
            .map((tr) => Array.from(tr.cells).map((td) => td.innerText.trim()))
            .filter((cells) => cells.length >= 4 && cells[0]);
    });
    return rows.map(([no, title, type, published]) => ({ no, title, type, published: toIsoDate(published) }));
}

// Run fn over items with a few browser tabs in parallel
async function withPages(browser, items, fn) {
    const queue = [...items];
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
        const page = await browser.newPage();
        for (let item = queue.shift(); item; item = queue.shift()) await fn(page, item);
        await page.close();
    }));
}

// Click an ASP.NET postback link and wait for the resulting page load
async function postBack(page, clickFn, arg) {
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
        page.evaluate(clickFn, arg)
    ]);
}


// Flag the tenders that mention our molecules and keep the item lines that ask for them, plus the
// pre-bid / bid opening schedule as the notice writes it
function matchOurs(opportunities, { matchMolecules, matchItemLines }) {
    for (const o of opportunities) {
        o.matched_molecules = matchMolecules(`${o.title}\n${o.items_text || ''}`);
        if (o.details) {
            o.details = {
                ...o.details,
                matched_items: matchItemLines(o.items_text).map(parseItemLine),
                ...extractSchedule(o.items_text)
            };
        }
    }
    return opportunities.filter((o) => o.matched_molecules.length > 0);
}

// Reads PhilGEPS with the browser. Returns every open tender of the category, each new one with its
// notice page read, the ones asking for our molecules with their bid supplements.
async function readPhilgeps(matcher) {
    // Loaded here so --from-file works on a computer without Chrome
    const puppeteer = require('puppeteer');
    console.log('Launching browser worker...');
    progress(2, 'Starting browser');
    // Keep Chrome's sandbox on: the scraper loads third-party pages
    const browser = await puppeteer.launch({ headless: true });

    try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // STEP 1: Open the public category list (also establishes the ASP.NET session)
    console.log('Opening PhilGEPS open opportunities (public)...');
    progress(4, 'Opening PhilGEPS');
    // A network error here means PhilGEPS itself is down (e.g. its error page redirecting to itself), not our code.
    // It flickers: without cookies the page opens ~2 times in 3, but the cookies a failed load leaves
    // behind make every retry fail too (measured 2026-10-21), so each retry starts with no cookies.
    for (let attempt = 1; ; attempt++) {
        try {
            if (attempt > 1) {
                const cookies = await page.cookies(OPEN_OPPORTUNITIES_URL);
                if (cookies.length) await page.deleteCookie(...cookies);
            }
            await page.goto(OPEN_OPPORTUNITIES_URL, { waitUntil: 'networkidle2', timeout: 45000 });
            break;
        } catch (err) {
            if (attempt >= OPEN_TRIES) throw new Error(`The PhilGEPS website is down right now (${err.message.split(' at ')[0]}). This is on PhilGEPS's side, not ours. Try again in 5–10 minutes.`);
            console.warn(`PhilGEPS did not open (${err.message.split(' at ')[0]}); retrying in 3 s`);
            progress(4, `Connecting to PhilGEPS (try ${attempt + 1} of ${OPEN_TRIES})`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }

    // STEP 2: Category list is paged alphabetically: click "D", then the count link for Drugs and Medicines
    console.log(`Navigating to ${CATEGORY_NAME} category...`);
    progress(6, `Opening ${CATEGORY_NAME}`);
    await postBack(page, () => __doPostBack('pgCtrlOpp$dLB', ''));
    // The category's count link ("543") tells how many results pages to expect
    const tenderCount = await page.evaluate((name) => {
        const row = Array.from(document.querySelectorAll('tr'))
            .find(tr => tr.cells.length === 3 && tr.cells[1].innerText.trim() === name);
        return row?.querySelector('a') ? Number(row.querySelector('a').innerText.replace(/\D/g, '')) || null : null;
    }, CATEGORY_NAME);
    const expectedPages = tenderCount ? Math.ceil(tenderCount / ROWS_PER_PAGE) : null;
    await postBack(page, (name) => {
        const row = Array.from(document.querySelectorAll('tr'))
            .find(tr => tr.cells.length === 3 && tr.cells[1].innerText.trim() === name);
        if (!row) throw new Error(`Category "${name}" not found on PhilGEPS category list`);
        row.querySelector('a').click();
    }, CATEGORY_NAME);

    // STEP 3: Extract every results page
    const byRef = new Map();
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const { rows, hasNext, url } = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('a[href*="refID="]')).map(a => {
                const cells = Array.from(a.closest('tr').cells).map(td => td.innerText.trim().replace(/\s+/g, ' '));
                return { href: a.href, refId: new URL(a.href).searchParams.get('refID'), cells };
            });
            const hasNext = Array.from(document.querySelectorAll('a'))
                .some(a => (a.getAttribute('href') || '').includes('nextLB'));
            return { rows, hasNext, url: location.href };
        });

        // Guard: never store junk from a log-in or error page
        if (pageNo === 1 && rows.length === 0) {
            throw new Error(`No tender rows found — PhilGEPS returned ${url} (log-in/error page or layout change)`);
        }

        for (const { href, refId, cells } of rows) {
            // cells: [#, Publish, Closing, "Title, Drugs and Medicines, Procuring Entity"]
            const [, publish, closing, combined = ''] = cells;
            const marker = `, ${CATEGORY_NAME}, `;
            const split = combined.lastIndexOf(marker);
            byRef.set(refId, {
                ref_no: refId,
                publish_date: toIsoDate(publish),
                closing_date: toTimestamp(closing),
                title: split >= 0 ? combined.slice(0, split) : combined,
                procuring_entity: split >= 0 ? combined.slice(split + marker.length) : null,
                category: CATEGORY_NAME,
                detail_link: href,
                items_text: null, // filled from the detail page
                abc_amount: null,
                details: null
            });
        }
        console.log(`Page ${pageNo}: ${rows.length} rows (total ${byRef.size})`);
        // Results pages: 10% to 40%
        progress(10 + 30 * Math.min(1, pageNo / (expectedPages || pageNo + 1)),
            `Reading tender list (page ${pageNo}${expectedPages ? ` of ${expectedPages}` : ''})`);

        // PhilGEPS flickered to its error page mid-list: keep what was read, and say the list is incomplete
        if (/ErrorPage/i.test(url)) {
            console.warn(`PhilGEPS showed its error page at results page ${pageNo}`);
            progress(40, 'Tender list incomplete', `PhilGEPS stopped responding at page ${pageNo}${expectedPages ? ` of ${expectedPages}` : ''}; the tender list may be incomplete`);
            break;
        }
        if (!hasNext || DRY_RUN) break;
        await postBack(page, () => __doPostBack('pgCtrlDetailedSearch$nextLB', ''));
    }

    // Deduped by ref_no, so the CRM is handed each tender once.
    const opportunities = Array.from(byRef.values());
    console.log(`Found ${opportunities.length} opportunities on PhilGEPS.`);

    // STEP 4: Open the detail page of each tender the CRM has not read yet to read its item list
    const stored = new Map();
    if (!DRY_RUN) {
        const refs = opportunities.map((o) => o.ref_no);
        for (let i = 0; i < refs.length; i += 200) {
            for (const row of await crm.known('philgeps', refs.slice(i, i + 200))) stored.set(row.ref_no, row);
        }
    }
    const pending = opportunities.filter((o) => !stored.has(o.ref_no));
    console.log(`Reading item lists of ${pending.length} new tenders...`);
    // Detail pages: 40% to 65%
    let detailsRead = 0;
    progress(40, `Reading item lists (0 of ${pending.length} new tenders)`);
    await withPages(browser, pending, async (detailPage, o) => {
        try {
            Object.assign(o, await fetchDetails(detailPage, o.detail_link));
        } catch (err) {
            console.warn(`Could not read ${o.ref_no}: ${err.message}`);
        }
        detailsRead++;
        progress(40 + 25 * detailsRead / pending.length, `Reading item lists (${detailsRead} of ${pending.length} new tenders)`);
    });

    // STEP 5: What the CRM already read is used again; then the tenders that mention our molecules
    for (const o of opportunities) {
        const known = stored.get(o.ref_no);
        if (known) Object.assign(o, { items_text: known.items_text, abc_amount: known.abc_amount, details: known.details });
    }
    const matched = matchOurs(opportunities, matcher);
    console.log(`${matched.length} of ${opportunities.length} tenders mention our medicines.`);

    // STEP 6: Bid supplements of the tenders we show, re-read since agencies add bulletins until closing,
    // except lists checked within SUPPLEMENTS_MAX_AGE_MS. A failed read keeps the list from the previous run.
    const checkedBefore = Date.now() - SUPPLEMENTS_MAX_AGE_MS;
    const staleSupplements = matched.filter((o) =>
        FULL_RUN || !(Date.parse(o.details?.supplements_checked_at) > checkedBefore));
    console.log(`Reading bid supplements of ${staleSupplements.length} matching tenders (${matched.length - staleSupplements.length} checked recently)...`);
    // Supplement lists: 67% to 82%
    let supplementsRead = 0;
    progress(67, `Checking bid supplements (0 of ${staleSupplements.length})`);
    await withPages(browser, staleSupplements, async (supplementsPage, o) => {
        try {
            o.details = {
                ...(o.details || {}),
                supplements: await fetchSupplements(supplementsPage, o.ref_no),
                supplements_checked_at: new Date().toISOString()
            };
        } catch (err) {
            console.warn(`Could not read supplements of ${o.ref_no}: ${err.message}`);
        }
        supplementsRead++;
        progress(67 + 15 * supplementsRead / staleSupplements.length, `Checking bid supplements (${supplementsRead} of ${staleSupplements.length})`);
    });

    return opportunities;
    } finally {
        // Always release Chrome, even if navigation or extraction throws
        await browser.close();
    }
}

// One run: read (PhilGEPS, or a saved list), hand in to the CRM, tell the CRM how it went
async function run({ trigger = 'manual' } = {}) {
    try {
        const matcher = await loadMatcher();
        let opportunities;
        if (FROM_FILE) {
            opportunities = JSON.parse(fs.readFileSync(FROM_FILE, 'utf8'));
            matchOurs(opportunities, matcher);
        } else {
            opportunities = await readPhilgeps(matcher);
        }
        const matched = opportunities.filter((o) => (o.matched_molecules || []).length > 0);
        if (DRY_RUN) {
            for (const o of matched) {
                console.log(`  ${o.ref_no} ${o.procuring_entity}: ${o.matched_molecules.join(', ')}`);
                for (const item of o.details?.matched_items || []) console.log(`      ${item.item_no ? '' : '(unparsed) '}${item.line}`);
            }
            return;
        }
        progress(95, 'Handing in to the CRM');
        const taken = await crm.send(opportunities);
        const summary = `${opportunities.length} tenders read, ${taken.matched} mention our medicines, ${taken.fresh} new`;
        await crm.run({ source: 'philgeps', trigger, status: 'success', summary, found: opportunities.length, matched: taken.matched, fresh: taken.fresh });
        progress(100, summary);
    } catch (err) {
        if (!DRY_RUN) await crm.run({ source: 'philgeps', trigger, status: 'failed', summary: err.message }).catch(() => {});
        throw err;
    }
}

// Same check the dashboard makes before Refresh: PhilGEPS down redirects to its error page. It flickers
// between working and down, so it only counts as down when 3 tries 2 s apart all fail.
// Returns null when the site answers normally, else the reason.
async function philgepsDownReason() {
    let reason = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(OPEN_OPPORTUNITIES_URL, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
            if (/ErrorPage|log-in\.aspx/i.test(res.headers.get('location') || '')) reason = 'PhilGEPS is showing its error page';
            else if (res.status >= 500) reason = `PhilGEPS answered with server error ${res.status}`;
            else return null;
        } catch (err) {
            reason = `PhilGEPS could not be reached (${err.message})`;
        }
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return reason;
}

module.exports = { run, matchOurs, philgepsDownReason };

if (require.main === module) {
    const trigger = (process.argv.find((a) => a.startsWith('--trigger=')) || '').slice('--trigger='.length) || 'manual';
    run({ trigger }).catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    });
}
