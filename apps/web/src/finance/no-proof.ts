// Why an order goes without its proof of payment, as the MedRep says it (the hub asked the same
// on every order): Finance reads it before confirming.

import type { NoProofReason } from "@2mg/api/types";

export const NO_PROOF_REASONS: { value: NoProofReason; label: string }[] = [
  { value: "on_terms", label: "Customer is on payment terms" },
  { value: "payment_to_follow", label: "Payment to follow" },
  { value: "paid_no_slip", label: "Paid, no slip yet" },
  { value: "other", label: "Other" },
];

export const noProofWords = (reason: NoProofReason | null, note: string | null) =>
  reason
    ? [NO_PROOF_REASONS.find((one) => one.value === reason)?.label, note].filter(Boolean).join(": ")
    : null;
