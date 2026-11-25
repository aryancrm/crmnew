// Reading a tender notice's item lines and dates: plain functions, no browser. From the bidding
// team's tender finder (github.com/kenshiiir0/Hospital-Bidding-System, scraper.js), unchanged.

// "7 1000 bottle Cetirizine 5mg/5ml, 60ml SYRUP 113.98 113,980.00" -> columns.
// Item lists aren't uniform across agencies, so lines that don't fit keep only the raw text.
function parseItemLine({ line, products }) {
    const num = (s) => Number(s.replace(/,/g, ''));
    // quantity × unit price gives the total (1% for rounded prices)
    const adds = (quantity, unitPrice, total) => quantity > 0 && Math.abs(quantity * unitPrice - total) <= total * 0.01;
    const parsed = parseItemColumns({ line, products });
    // A priced row is taken as is when its quantity × unit price gives its total (a row whose own numbers
    // never add up keeps these columns)
    if (parsed.unit_price != null && adds(parsed.quantity, parsed.unit_price, parsed.total)) return parsed;

    // Any other layout ending in "<unit price> <total>": the quantity is the number that times the unit price
    // gives the total, the one nearest the price when several do, e.g. "500 TABLET Amlodipine 5 mg Tablet 2
    // 1,000.00", or "55100000 vial Vancomycin ..., 1gram 3000 450.00 1,350,000.00" (55100000 is a stock number)
    const tail = /^(.*\S)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+\.\d{2})$/.exec(line);
    if (!tail) return parsed;
    const [, rest, priceText, totalText] = tail;
    const unitPrice = num(priceText);
    const total = num(totalText);
    const quantity = (rest.match(/\d[\d,]*/g) || []).map(num).findLast((q) => adds(q, unitPrice, total));
    if (quantity == null) return parsed;
    // "<stock no.> <unit> <description> <quantity>" (PhilGEPS RFQ tables: Stock/Property No. | Unit | Description | Qty)
    const stock = /^(\S*\d\S*)\s+([A-Za-z][A-Za-z.'’]*)\s+(.+?)\s+([\d,]+)$/.exec(rest);
    if (stock && num(stock[4]) === quantity) {
        return { line, products, item_no: stock[1], unit: stock[2], description: stock[3], quantity, unit_price: unitPrice, total };
    }
    const base = parseItemColumns({ line: rest, products });
    return {
        ...base,
        line,
        description: base.description || rest,
        quantity: adds(base.quantity, unitPrice, total) ? base.quantity : quantity,
        unit_price: unitPrice,
        total
    };
}

function parseItemColumns({ line, products }) {
    const num = (s) => Number(s.replace(/,/g, ''));
    // Item numbers come as "7", "21." or "3.)"
    const ITEM = String.raw`(\d+)[.)]*`;
    const UNIT = String.raw`([A-Za-z][A-Za-z.'’]*)`;
    const QTY = String.raw`([\d,]+(?:\.\d+)?)`;
    const PRICE = String.raw`([\d,]+\.\d{2})`;
    // Item | Quantity | Unit | Description | Unit Price | Total
    const priced = new RegExp(`^${ITEM}\\s+${QTY}\\s+${UNIT}\\s+(.+?)\\s+${PRICE}\\s+${PRICE}$`).exec(line);
    if (priced) {
        return {
            line,
            products,
            item_no: priced[1],
            quantity: num(priced[2]),
            unit: priced[3],
            description: priced[4],
            unit_price: num(priced[5]),
            total: num(priced[6])
        };
    }
    // Item | Quantity | Unit | Description, e.g. "21. 5000 TAB LOSARTAN 100 MG"
    const qtyFirst = new RegExp(`^${ITEM}\\s+${QTY}\\s+${UNIT}\\s+(.+)$`).exec(line);
    if (qtyFirst) {
        return { line, products, item_no: qtyFirst[1], quantity: num(qtyFirst[2]), unit: qtyFirst[3], description: qtyFirst[4] };
    }
    // Item | Description | Quantity | Unit (RFQs without prices), e.g. "9 MIDAZOLAM 5MG/ML AMPULE 10’S 40 BX"
    // (a strength or volume like "60 ml" at the end is part of the description, not a quantity)
    const qtyLast = new RegExp(`^${ITEM}\\s+(.+?)\\s+([\\d,]+)\\s+(?!(?:mg|ml|mcg|g|kg|l|iu|units?|%)\\.?$)([A-Za-z]{1,12}\\.?)$`, 'i').exec(line);
    if (qtyLast) {
        return { line, products, item_no: qtyLast[1], description: qtyLast[2], quantity: num(qtyLast[3]), unit: qtyLast[4] };
    }
    // The remaining layouts have no fixed column order, so their unit must be a known one; otherwise
    // "1 BUPIVACAINE ..." would read as quantity 1 of unit "BUPIVACAINE" and "500 mg" as 500 of unit "mg".
    const KNOWN_UNIT = String.raw`((?:tab|tablet|cap|capsule|bottle|btl|botl|bot|vial|vl|amp|ampule|ampoule|box|bx|pc|piece|pack|sachet|tube|inhaler|nebule|syringe|bag|kit|set|unit|each|ea)(?:e?s)?\.?(?:\s?\/\s?(?:vial|amp|bottle|bot)s?)?)`;
    // Item | Description | Quantity | Unit | Unit Price | Total, e.g. "6 Propofol, Inj: 10mg/ml, 20ml 120 amps 390.00 46,800.00"
    const descPriced = new RegExp(`^${ITEM}\\s+(.+?)\\s+${QTY}\\s+${KNOWN_UNIT}\\s+${PRICE}\\s+${PRICE}$`, 'i').exec(line);
    if (descPriced) {
        return {
            line,
            products,
            item_no: descPriced[1],
            description: descPriced[2],
            quantity: num(descPriced[3]),
            unit: descPriced[4],
            unit_price: num(descPriced[5]),
            total: num(descPriced[6])
        };
    }
    // Quantity | Unit | Description with no item number, e.g. "2,325 tab Amlodipine Besilate 10mg tab"
    const noItem = new RegExp(`^${QTY}\\s+${KNOWN_UNIT}\\s+(.+)$`, 'i').exec(line);
    if (noItem) {
        return { line, products, quantity: num(noItem[1]), unit: noItem[2], description: noItem[3] };
    }
    // Description | Quantity | Unit with no item number, e.g. "Cetirizine 10mg tab 200 box"
    const descNoItem = new RegExp(`^(.*[A-Za-z].*?)\\s+([\\d,]+)\\s+${KNOWN_UNIT}$`, 'i').exec(line);
    if (descNoItem) {
        return { line, products, description: descNoItem[1], quantity: num(descNoItem[2]), unit: descNoItem[3] };
    }
    return { line, products };
}

// "20/10/2026" -> "2026-10-20"
function toIsoDate(dmy) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dmy || '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// "23/10/2026 01:00 PM" -> "2026-10-23 13:00:00" (Philippine local time, column is TIMESTAMP without zone)
function toTimestamp(dmyTime) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(dmyTime || '');
    if (!m) return null;
    let hour = Number(m[4]) % 12;
    if (m[6].toUpperCase() === 'PM') hour += 12;
    return `${m[3]}-${m[2]}-${m[1]} ${String(hour).padStart(2, '0')}:${m[5]}:00`;
}

module.exports = { parseItemLine, parseItemColumns, toIsoDate, toTimestamp };
