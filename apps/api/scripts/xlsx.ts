// Reads the sheets of an Excel file (.xlsx) as rows of text, without a library: an .xlsx is a zip
// of XML files. Enough for the company's price list: shared and inline text, numbers, hidden
// sheets. Formulas give their last saved value.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** The files inside a zip, by name. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  // The end of the central directory: the last 22+ bytes, found from the end.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--)
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0) throw new Error("Not an .xlsx (no zip directory).");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("A broken .xlsx (zip directory).");
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const text = (xml: string) =>
  xml.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code[0] === "#"
      ? String.fromCodePoint(
          code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)),
        )
      : (ENTITIES[code] ?? whole),
  );
/** All the text runs (<t>…</t>) inside a piece of XML, joined. */
const runs = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((found) => text(found[1] ?? "")).join("");
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
/** "AB12" → 27 (the column, from 0). */
const column = (ref: string) => {
  let value = 0;
  for (const letter of /^[A-Z]+/.exec(ref)?.[0] ?? "A") value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
};

export type Sheet = {
  name: string;
  hidden: boolean;
  /** Each row as its cells' text, by column from 0; `number` is the row's number in Excel. */
  rows: { number: number; cells: string[] }[];
};

/** Every sheet of an .xlsx file. */
export function readXlsx(path: string): Sheet[] {
  const files = unzip(readFileSync(path));
  const read = (name: string) => files.get(name)?.toString("utf8") ?? "";
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((found) =>
    runs(found[1] ?? ""),
  );
  const targets = new Map(
    [...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)].map((found) => [
      attr(found[0], "Id"),
      attr(found[0], "Target"),
    ]),
  );
  return [...read("xl/workbook.xml").matchAll(/<sheet\s[^>]*\/?>/g)].map((found) => {
    const tag = found[0];
    const target = targets.get(attr(tag, "r:id")) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const rows: Sheet["rows"] = [];
    for (const row of read(path).matchAll(/<row\s([^>]*)>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of (row[2] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = ` ${cell[1] ?? ""}`;
        const body = cell[2] ?? "";
        const type = attr(head, "t");
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const shown =
          type === "s"
            ? (shared[Number(value)] ?? "")
            : type === "inlineStr"
              ? runs(body)
              : value !== undefined
                ? text(value)
                : "";
        cells[column(attr(head, "r") ?? "A")] = shown;
      }
      rows.push({ number: Number(attr(` ${row[1]}`, "r")), cells: Array.from(cells, (one) => one ?? "") });
    }
    return { name: text(attr(tag, "name") ?? ""), hidden: attr(tag, "state") === "hidden", rows };
  });
}
