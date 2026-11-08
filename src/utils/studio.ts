export const STUDIO_NAME = "The Nail Palace";

/** First word of a customer name, for greetings in prepared messages. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
