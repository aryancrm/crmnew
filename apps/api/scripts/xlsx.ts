// Reads the sheets of an Excel file (.xlsx) on disk as rows of text: the reader itself lives in
// src/reports/xlsx-read.ts (the API reads uploaded workbooks with it too).

import { readFileSync } from "node:fs";
import { readXlsxBytes, type Sheet } from "../src/reports/xlsx-read";

export type { Sheet };

/** Every sheet of an .xlsx file. */
export function readXlsx(path: string): Sheet[] {
  return readXlsxBytes(readFileSync(path));
}
