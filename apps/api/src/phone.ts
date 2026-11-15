// A Philippine phone number written one way, whichever way it was typed: +63 917 555 1234,
// 63-917-555-1234, 9175551234 and 0917 555 1234 are all "0917 555 1234"; a Metro Manila line is
// "(02) 8825 5236", another area's "(032) 255 8000". Who someone is stays the last ten digits
// (customers/service.ts phoneKey), so every way of writing it finds the same person.

export function formatPhone(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("63") && (digits.length === 12 || digits.length === 11))
    digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && digits.startsWith("9")) digits = `0${digits}`;
  else if (digits.length === 9 && digits.startsWith("2")) digits = `0${digits}`;
  if (digits.length === 11 && digits.startsWith("09"))
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02"))
    return `(02) ${digits.slice(2, 6)} ${digits.slice(6)}`;
  if (digits.length === 10 && digits.startsWith("0"))
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6)}`;
  // Anything else (an extension, a foreign number) is kept as it was typed.
  return text;
}
