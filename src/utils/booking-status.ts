export type BookingStatusName = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

/** Statuses that occupy the artist's time (the same ones the no-overlap constraint covers). */
export const ACTIVE_STATUSES: readonly BookingStatusName[] = ["pending", "confirmed"];

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

const TRANSITIONS: Record<BookingStatusName, readonly BookingStatusName[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as BookingStatusName] ?? []).includes(to as BookingStatusName);
}

/**
 * completed and no_show release the slot, so they are only valid once the appointment time has come;
 * otherwise the owner could free a future slot and invite a double booking by mistake.
 */
export function requiresStarted(to: string): boolean {
  return to === "completed" || to === "no_show";
}
