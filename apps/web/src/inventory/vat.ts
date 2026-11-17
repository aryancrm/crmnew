/** A medicine's VAT in a few words, as Inventory keeps it (shown wherever a medicine is picked or
 *  checked, so nobody looks it up by hand: Aryan, 17 Nov). */
export const VAT_WORDS: Record<string, string> = {
  vat12: "12% VAT in the price",
  exempt: "VAT-exempt",
  zero: "Zero-rated",
};
