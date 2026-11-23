// node --test: the readings the robot hands to the CRM, on real line shapes (no browser, no CRM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemLine, toIsoDate, toTimestamp } = require('./parse');
const { extractSchedule } = require('./schedule');
const { matcherFor } = require('./molecules');

const ours = matcherFor([
    { name: 'Cetirizine', match: ['cetirizine'] },
    { name: 'Anastrozole', match: ['anastrozole', 'anastrazole'] },
    { name: 'Sitagliptin + Metformin', match: ['sitagliptin + metformin'] }
]);

test('our molecules in a notice, line by line', () => {
    assert.deepEqual(ours.matchMolecules('Supply of ANASTRAZOLE 1mg and cetirizine syrup'), ['Cetirizine', 'Anastrozole']);
    assert.deepEqual(ours.matchMolecules('Sitagliptin 50mg / Metformin 500mg tablet'), ['Sitagliptin + Metformin']);
    assert.deepEqual(ours.matchMolecules('Metformin 500mg tablet'), []);
    assert.deepEqual(
        ours.matchItemLines('Description\n7 1000 bottle Cetirizine 5mg/5ml, 60ml SYRUP 113.98 113,980.00\n8 50 box Gauze 10.00 500.00'),
        [{ line: '7 1000 bottle Cetirizine 5mg/5ml, 60ml SYRUP 113.98 113,980.00', products: ['Cetirizine'] }]
    );
});

test('an item line into its columns', () => {
    const priced = parseItemLine({ line: '7 1000 bottle Cetirizine 5mg/5ml, 60ml SYRUP 113.98 113,980.00', products: ['Cetirizine'] });
    assert.equal(priced.item_no, '7');
    assert.equal(priced.quantity, 1000);
    assert.equal(priced.unit, 'bottle');
    assert.equal(priced.unit_price, 113.98);
    assert.equal(priced.total, 113980);
    const noPrice = parseItemLine({ line: '21. 5000 TAB LOSARTAN 100 MG', products: [] });
    assert.equal(noPrice.quantity, 5000);
    assert.equal(noPrice.unit, 'TAB');
    assert.equal(noPrice.unit_price, undefined);
    // A line that fits no layout keeps its text only: the CRM shows it as written
    assert.deepEqual(parseItemLine({ line: 'Cetirizine as needed', products: ['Cetirizine'] }), { line: 'Cetirizine as needed', products: ['Cetirizine'] });
});

test('PhilGEPS dates as the CRM takes them (Philippine time, no zone)', () => {
    assert.equal(toIsoDate('20/10/2026'), '2026-10-20');
    assert.equal(toTimestamp('23/10/2026 01:00 PM'), '2026-10-23 13:00:00');
    assert.equal(toTimestamp('23/10/2026 12:05 AM'), '2026-10-23 00:05:00');
    assert.equal(toTimestamp('soon'), null);
});

test('the pre-bid and the bid opening as the notice writes them', () => {
    const text = 'The BAC will hold a Pre-Bid Conference on October 27, 2026 at 10:00am, which shall be open to bidders.\nBid opening shall be on November 10, 2026 at 2:00pm at the BAC office.';
    const schedule = extractSchedule(text);
    assert.match(schedule.pre_bid, /October 27, 2026/);
    assert.match(schedule.bid_opening, /November 10, 2026/);
    assert.deepEqual(extractSchedule(''), { pre_bid: null, bid_opening: null });
});
