import { describe, expect, test } from "bun:test";
import {
  cancelledContent,
  conflictContent,
  newBookingContent,
  unconfirmedContent,
  upcomingContent,
  type BookingFacts,
} from "../../../src/services/notification.messages.js";

const facts: BookingFacts = {
  bookingCode: "NP-20261110-A7K2",
  customerName: "  Siti   Rahayu ",
  serviceName: "Gel Polish",
  startAt: new Date("2026-11-10T03:00:00Z"), // Tuesday 10:00 WIB
};
const ID = "11111111-1111-4111-8111-111111111111";

describe("notification messages", () => {
  test("a new booking names the first name, service, WIB time and code", () => {
    const content = newBookingContent(facts);
    expect(content.type).toBe("new_booking");
    expect(content.title).toBe("Reservasi baru");
    expect(content.body).toBe(
      "Siti memesan Gel Polish pada Selasa, 10 November 2026 pukul 10.00 WIB (NP-20261110-A7K2). Menunggu konfirmasi.",
    );
  });

  test("keys are one per event so a repeat can be skipped", () => {
    expect(newBookingContent(facts).dedupeKey).toBe("new_booking:NP-20261110-A7K2");
    expect(cancelledContent(facts).dedupeKey).toBe("booking_cancelled:NP-20261110-A7K2");
    expect(unconfirmedContent(facts, ID, 15).dedupeKey).toBe(`unconfirmed_reminder:${ID}`);
    expect(upcomingContent(facts, ID).dedupeKey).toBe(`upcoming_reminder:${ID}`);
    expect(conflictContent(facts, ID).dedupeKey).toBe(`schedule_conflict:${ID}`);
  });

  test("each kind says what happened", () => {
    expect(cancelledContent(facts).body).toContain("Siti membatalkan Gel Polish");
    expect(unconfirmedContent(facts, ID, 15).body).toContain("lebih dari 15 menit");
    expect(upcomingContent(facts, ID).body).toContain("dimulai Selasa, 10 November 2026 pukul 10.00 WIB");
    expect(conflictContent(facts, ID).body).toContain("bertabrakan dengan waktu yang diblokir");
  });

  test("nothing carries a phone number, the surname, or any text the customer typed", () => {
    const all = [
      newBookingContent(facts),
      cancelledContent(facts),
      unconfirmedContent(facts, ID, 15),
      upcomingContent(facts, ID),
      conflictContent(facts, ID),
    ];
    for (const content of all) {
      expect(`${content.title} ${content.body}`).not.toContain("Rahayu");
      expect(`${content.title} ${content.body}`).not.toMatch(/\+?62\d{6,}|08\d{6,}/);
    }
  });

  test("fits the database columns even for a very long name and service", () => {
    const long = { ...facts, customerName: "N".repeat(100), serviceName: "S".repeat(120) };
    for (const content of [newBookingContent(long), unconfirmedContent(long, ID, 15), conflictContent(long, ID)]) {
      expect(content.title.length).toBeLessThanOrEqual(120);
      expect(content.body.length).toBeLessThanOrEqual(500);
      expect(content.dedupeKey.length).toBeLessThanOrEqual(120);
    }
  });
});
