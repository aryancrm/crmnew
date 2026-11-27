// An HQ's name in a word (Aryan, 27-28 Nov: "the main thing is the Headquarter"; PLAN 257, 264-265),
// as the server names it (apps/api/src/team/hq-name.ts): the territory's last part that isn't the
// person's own name ("RX | TAFT" → TAFT), ON SITE when there is none. Never the territory's whole
// name ("RX | TAFT" is the Zoho-era name: "we are ending Zoho").

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

export const ON_SITE = "ON SITE";

export function hqName(area: string | null, person: string | null): string {
  const own = person ? plain(person) : null;
  const parts = (area ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && plain(part) !== own);
  if (parts.some((part) => plain(part) === "on site")) return ON_SITE;
  return parts.length > 1 ? (parts[parts.length - 1] as string) : ON_SITE;
}

/** A seat's HQ: a selling seat's, from its territory; none for a lead's seat or a seat with no
 *  territory (those show their person). */
export function hqOfSeat(seat: { lead?: boolean; area: { name: string } | null; person: { name: string } | null }): string | null {
  if (seat.lead || !seat.area) return null;
  return hqName(seat.area.name, seat.person?.name ?? null);
}
