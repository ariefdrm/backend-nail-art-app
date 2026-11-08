import { describe, expect, test } from "bun:test";
import {
  blockedSlotSchemas,
  listBlockedSlotsSchemas,
  replaceBusinessHoursSchemas,
} from "../../../src/schemas/schedule.schema.js";

const closed = (day: number) => ({ day_of_week: day, is_open: false });
const open = (day: number, extra: Record<string, unknown> = {}) => ({
  day_of_week: day,
  is_open: true,
  open_time: "10:00",
  close_time: "20:00",
  ...extra,
});
const week = (override: Record<number, unknown> = {}) =>
  Array.from({ length: 7 }, (_, day) => override[day] ?? closed(day));

function hoursIssues(hours: unknown): string[] {
  const result = replaceBusinessHoursSchemas.body.safeParse({ hours });
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("business hours schema", () => {
  test("accepts a full week and normalizes closed days to null times", () => {
    const parsed = replaceBusinessHoursSchemas.body.parse({
      hours: week({
        0: { day_of_week: 0, is_open: false, open_time: "10:00", close_time: "20:00", break_start: "12:00" },
        1: open(1, { break_start: "12:00", break_end: "13:00" }),
      }),
    });
    expect(parsed.hours[0]).toEqual({
      day_of_week: 0,
      is_open: false,
      open_time: null,
      close_time: null,
      break_start: null,
      break_end: null,
    });
    expect(parsed.hours[1]).toMatchObject({ open_time: "10:00", break_start: "12:00", break_end: "13:00" });
    expect(parsed.hours[2]?.break_start).toBeNull();
  });

  test.each([
    ["fewer than 7 days", week().slice(0, 6), "Wajib memuat tepat 7 hari"],
    ["more than 7 days", [...week(), closed(0)], "Wajib memuat tepat 7 hari"],
    ["duplicate days", week({ 3: closed(2) }), "hanya boleh muncul sekali"],
    ["day 7", week({ 6: closed(7) }), "<=6"],
    ["open day without times", week({ 1: { day_of_week: 1, is_open: true } }), "Wajib diisi untuk hari buka"],
    ["close before open", week({ 1: open(1, { open_time: "20:00", close_time: "10:00" }) }), "setelah jam buka"],
    ["close equal to open", week({ 1: open(1, { open_time: "10:00", close_time: "10:00" }) }), "setelah jam buka"],
    ["time without leading zero", week({ 1: open(1, { open_time: "9:00" }) }), "format HH:mm"],
    ["time out of range", week({ 1: open(1, { close_time: "24:00" }) }), "format HH:mm"],
    ["break with only a start", week({ 1: open(1, { break_start: "12:00" }) }), "berpasangan"],
    ["break with only an end", week({ 1: open(1, { break_end: "13:00" }) }), "berpasangan"],
    [
      "break ending before it starts",
      week({ 1: open(1, { break_start: "13:00", break_end: "12:00" }) }),
      "setelah istirahat mulai",
    ],
    ["break before opening", week({ 1: open(1, { break_start: "09:00", break_end: "10:30" }) }), "sebelum jam buka"],
    ["break after closing", week({ 1: open(1, { break_start: "19:30", break_end: "20:30" }) }), "setelah jam tutup"],
  ])("rejects %s", (_label, hours, message) => {
    expect(hoursIssues(hours).join("\n")).toContain(message);
  });

  test("reports the failing row in the field path, with one clear error for a malformed time", () => {
    const issues = hoursIssues(week({ 2: open(2, { open_time: "bad" }) }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^hours\.2\.open_time: .*HH:mm/);
  });

  test("a malformed time never produces an ordering error", () => {
    const issues = hoursIssues(week({ 1: open(1, { close_time: "nope", break_start: "x", break_end: "y" }) }));
    expect(issues.join("\n")).not.toContain("setelah");
  });
});

describe("blocked slot schema", () => {
  const base = { start_at: "2026-11-10T10:00:00+07:00", end_at: "2026-11-10T12:00:00+07:00" };

  test("parses instants, trims the reason and defaults acknowledge_conflicts to false", () => {
    const parsed = blockedSlotSchemas.body.parse({ ...base, reason: "  Cuti  " });
    expect(parsed.start_at.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(parsed.reason).toBe("Cuti");
    expect(parsed.acknowledge_conflicts).toBe(false);
    expect(parsed.artist_id).toBeUndefined();
  });

  test("accepts any ISO offset and a null artist (whole studio)", () => {
    const parsed = blockedSlotSchemas.body.parse({
      start_at: "2026-11-10T03:00:00Z",
      end_at: "2026-11-10T05:00:00Z",
      artist_id: null,
      acknowledge_conflicts: true,
    });
    expect(parsed.artist_id).toBeNull();
    expect(parsed.acknowledge_conflicts).toBe(true);
  });

  test.each([
    ["end equal to start", { end_at: base.start_at }, "end_at harus setelah start_at"],
    ["end before start", { end_at: "2026-11-10T09:00:00+07:00" }, "end_at harus setelah start_at"],
    ["a range over 366 days", { end_at: "2027-11-12T10:00:00+07:00" }, "maksimal 366 hari"],
    ["a date without time", { start_at: "2026-11-10" }, "ISO 8601"],
    ["a time without offset", { start_at: "2026-11-10T10:00:00" }, "ISO 8601"],
    ["a non-uuid artist", { artist_id: "nope" }, "uuid"],
    ["a reason over 255 chars", { reason: "x".repeat(256) }, "255"],
  ])("rejects %s", (_label, patch, message) => {
    const result = blockedSlotSchemas.body.safeParse({ ...base, ...patch });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(message);
  });

  test("a malformed date is a validation error, never an exception", () => {
    for (const patch of [{ start_at: "garbage" }, { end_at: 12345 }, { start_at: null }, { start_at: undefined }]) {
      expect(() => blockedSlotSchemas.body.safeParse({ ...base, ...patch })).not.toThrow();
      expect(blockedSlotSchemas.body.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });

  test("allows exactly 366 days", () => {
    expect(blockedSlotSchemas.body.safeParse({ ...base, end_at: "2027-11-11T10:00:00+07:00" }).success).toBe(true);
  });
});

describe("blocked slot list query", () => {
  test("accepts empty, single and ordered dates", () => {
    expect(listBlockedSlotsSchemas.query.safeParse({}).success).toBe(true);
    expect(listBlockedSlotsSchemas.query.safeParse({ date_from: "2026-11-10" }).success).toBe(true);
    expect(listBlockedSlotsSchemas.query.safeParse({ date_from: "2026-11-10", date_to: "2026-11-10" }).success).toBe(
      true,
    );
  });

  test("rejects reversed or malformed dates", () => {
    expect(listBlockedSlotsSchemas.query.safeParse({ date_from: "2026-11-11", date_to: "2026-11-10" }).success).toBe(
      false,
    );
    expect(listBlockedSlotsSchemas.query.safeParse({ date_from: "10-11-2026" }).success).toBe(false);
  });
});
