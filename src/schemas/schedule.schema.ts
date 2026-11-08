import { z } from "zod";
import { addDays } from "../utils/datetime.js";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOfDay = z.string().regex(HHMM, "Gunakan format HH:mm, misalnya 09:30");

const hourEntry = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    is_open: z.boolean(),
    open_time: timeOfDay.nullish(),
    close_time: timeOfDay.nullish(),
    break_start: timeOfDay.nullish(),
    break_end: timeOfDay.nullish(),
  })
  .superRefine((hour, ctx) => {
    if (!hour.is_open) return; // closed days are stored without times
    // Only compare values that already passed the HH:mm format check, so a malformed time yields
    // one clear error instead of a misleading ordering error.
    const valid = (value: string | null | undefined) => (value && HHMM.test(value) ? value : undefined);
    const open = valid(hour.open_time);
    const close = valid(hour.close_time);
    const bs = valid(hour.break_start);
    const be = valid(hour.break_end);
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (!hour.open_time) issue("open_time", "Wajib diisi untuk hari buka");
    if (!hour.close_time) issue("close_time", "Wajib diisi untuk hari buka");
    if (open && close && open >= close) issue("close_time", "Jam tutup harus setelah jam buka");

    if (Boolean(hour.break_start) !== Boolean(hour.break_end)) {
      issue(
        hour.break_start ? "break_end" : "break_start",
        "Jam istirahat harus diisi berpasangan (mulai dan selesai)",
      );
    } else if (bs && be) {
      if (bs >= be) issue("break_end", "Istirahat selesai harus setelah istirahat mulai");
      if (open && bs < open) issue("break_start", "Istirahat tidak boleh dimulai sebelum jam buka");
      if (close && be > close) issue("break_end", "Istirahat tidak boleh berakhir setelah jam tutup");
    }
  })
  .transform((hour) => ({
    day_of_week: hour.day_of_week,
    is_open: hour.is_open,
    open_time: hour.is_open ? (hour.open_time ?? null) : null,
    close_time: hour.is_open ? (hour.close_time ?? null) : null,
    break_start: hour.is_open ? (hour.break_start ?? null) : null,
    break_end: hour.is_open ? (hour.break_end ?? null) : null,
  }));

export const replaceBusinessHoursSchemas = {
  body: z.object({
    hours: z
      .array(hourEntry)
      .length(7, "Wajib memuat tepat 7 hari (0 sampai 6)")
      .superRefine((hours, ctx) => {
        const days = new Set(hours.map((h) => h.day_of_week));
        if (days.size !== hours.length) {
          ctx.addIssue({ code: "custom", message: "Setiap hari (0 sampai 6) hanya boleh muncul sekali" });
        }
      }),
  }),
};

export type BusinessHourInput = z.output<typeof hourEntry>;

const MAX_BLOCK_DAYS = 366;
const instant = z.iso.datetime({ offset: true, message: "Gunakan format tanggal-waktu ISO 8601 dengan offset" });

export const blockedSlotSchemas = {
  body: z
    .object({
      artist_id: z.uuid().nullish(),
      start_at: instant.transform((value) => new Date(value)),
      end_at: instant.transform((value) => new Date(value)),
      reason: z.string().trim().max(255).optional(),
      acknowledge_conflicts: z.boolean().default(false),
    })
    .superRefine((slot, ctx) => {
      // Zod runs object refinements even when a field failed; skip until both are real dates.
      if (!(slot.start_at instanceof Date) || !(slot.end_at instanceof Date)) return;
      if (slot.end_at <= slot.start_at) {
        ctx.addIssue({ code: "custom", path: ["end_at"], message: "end_at harus setelah start_at" });
      } else if (slot.end_at > addDays(slot.start_at, MAX_BLOCK_DAYS)) {
        ctx.addIssue({ code: "custom", path: ["end_at"], message: `Rentang blokir maksimal ${MAX_BLOCK_DAYS} hari` });
      }
    }),
};

export type BlockedSlotInput = z.output<typeof blockedSlotSchemas.body>;

export const listBlockedSlotsSchemas = {
  query: z
    .object({
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
    })
    .superRefine((query, ctx) => {
      if (query.date_from && query.date_to && query.date_from > query.date_to) {
        ctx.addIssue({ code: "custom", path: ["date_to"], message: "date_to tidak boleh sebelum date_from" });
      }
    }),
};

export const blockedSlotIdSchemas = { params: z.object({ id: z.uuid() }) };
