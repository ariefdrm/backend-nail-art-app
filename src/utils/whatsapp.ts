/**
 * Builds a wa.me link that opens a chat with the number and a prefilled message.
 * The backend never sends WhatsApp messages itself (PRD non-goal): the person
 * opening the link reviews the text and presses send.
 *
 * `phone` is the stored E.164 number (e.g. +6281234567890); wa.me wants digits only.
 */
export function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
