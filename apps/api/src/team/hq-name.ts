// An HQ's name in a word (Aryan, 27-28 Nov, PLAN 257 and 264), on its own so every screen's code can
// name an HQ the same way: the territory's last part that isn't the person's own name.

export const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** An HQ with no territory of its own: the on-site sellers'. */
export const ON_SITE = "ON SITE";

/** The HQ in a word: the territory's last part that isn't the person's own name ("RX | NCL" → NCL;
 *  "B2C | Rachelle Upao" → ON SITE; "B2C | ON SITE | 2", a second on-site HQ → ON SITE). */
export function hqOf(area: string | null, person: string | null): string {
  const own = person ? plain(person) : null;
  const parts = (area ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && plain(part) !== own);
  if (parts.some((part) => plain(part) === "on site")) return ON_SITE;
  return parts.length > 1 ? (parts[parts.length - 1] as string) : ON_SITE;
}
