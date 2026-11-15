// Words more than one screen uses.

import type { MoveRow } from "@2mg/api/types";

export const MOVE_WORDS: Record<MoveRow["kind"], string> = {
  receive: "Received",
  move_out: "Transferred",
  move_in: "Transferred in",
  count: "Adjusted",
  deliver: "Packed for an order",
  return: "Back from an order",
};
