import { randomInt } from "node:crypto";
import { toJakartaIso } from "./datetime.js";

// No 0/O, 1/I/L: the code is read aloud and typed by customers.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SUFFIX_LENGTH = 4;

/** NP-YYYYMMDD-XXXX, where the date is the appointment day in WIB and XXXX is random. */
export function generateBookingCode(startAt: Date): string {
  const day = toJakartaIso(startAt).slice(0, 10).replaceAll("-", "");
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `NP-${day}-${suffix}`;
}
