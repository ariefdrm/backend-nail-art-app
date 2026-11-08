import { createHmac } from "node:crypto";

const PURPOSE = "csv-export-v1";

/**
 * A stable, non-reversible stand-in for a phone number, so exported rows of the same customer can be linked without
 * revealing who it is. Keyed with the server secret (separated by purpose from the secret's other uses), so the mapping
 * cannot be rebuilt from a list of phone numbers; it changes only if the secret is rotated.
 */
export function customerRef(phone: string, secret: string): string {
  const key = createHmac("sha256", secret).update(PURPOSE).digest();
  return createHmac("sha256", key).update(phone).digest("hex").slice(0, 16);
}
