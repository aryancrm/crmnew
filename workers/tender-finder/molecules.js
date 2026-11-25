// Our molecules by name, for the robot. The list is the CRM's own medicines (asked through
// crm.js on every run), so a medicine added in the CRM is looked for from the next run.
// From the bidding team's tender finder (molecules.js); only where the list comes from changed.
const crm = require('./crm');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each alias is a word or phrase; "a+b" requires every part (combination products)
function compile(list) {
    return list.map(({ name, match }) => ({
        name,
        alternatives: match.map((alias) =>
            alias.split('+').map((part) =>
                new RegExp(`\\b${escapeRegex(part.trim()).replace(/\s+/g, '[\\s-]+')}\\b`, 'i')
            )
        )
    }));
}

function matcherFor(list) {
    const compiled = compile(list);

    // Returns the names of our products mentioned in the text, e.g. ["Paclitaxel", "Carboplatin"]
    function matchMolecules(text) {
        if (!text) return [];
        return compiled
            .filter(({ alternatives }) => alternatives.some((parts) => parts.every((re) => re.test(text))))
            .map(({ name }) => name);
    }

    // Lines of an item list that mention our products, e.g.
    // { line: "7 1000 bottle Cetirizine 5mg/5ml, 60ml SYRUP 113.98 113,980.00", products: ["Cetirizine"] }
    function matchItemLines(text) {
        if (!text) return [];
        return text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
                const products = matchMolecules(line);
                return products.length ? [{ line, products }] : [];
            });
    }

    return { matchMolecules, matchItemLines };
}

// The matcher for the CRM's medicines as they are now
async function loadMatcher() {
    const list = await crm.molecules();
    if (!list.length) throw new Error('The CRM has no medicine with a generic name: nothing to look for');
    return matcherFor(list);
}

module.exports = { matcherFor, loadMatcher };
