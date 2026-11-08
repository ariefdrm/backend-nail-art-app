/**
 * Normalizes an Indonesian mobile number to E.164 (+62...), or returns null when it is not one.
 * Accepts 08..., 62..., +62... and tolerates spaces, dashes, dots and parentheses.
 * Landlines are rejected on purpose: the studio reaches customers through WhatsApp.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-.()]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let national: string;
  if (cleaned.startsWith("+62")) national = cleaned.slice(3);
  else if (cleaned.startsWith("62")) national = cleaned.slice(2);
  else if (cleaned.startsWith("0")) national = cleaned.slice(1);
  else return null;

  // Mobile numbers start with 8 and have 9 to 13 digits after the country code.
  return /^8\d{8,12}$/.test(national) ? `+62${national}` : null;
}
