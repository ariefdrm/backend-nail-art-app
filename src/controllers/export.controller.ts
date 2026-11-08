import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type { exportBookingsSchemas } from "../schemas/export.schema.js";
import * as exportService from "../services/export.service.js";

export async function exportBookings(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof exportBookingsSchemas>(res);
  const lines = exportService.exportBookings(query);

  // Read the first line before sending headers: a failure here is still an ordinary JSON error response.
  const first = await lines.next();
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${exportService.exportFilename(query)}"`);
  res.setHeader("Cache-Control", "no-store");

  async function* all(): AsyncGenerator<string> {
    if (!first.done) yield first.value;
    yield* lines;
  }
  // pipeline handles backpressure, and stops reading when the client goes away.
  try {
    await pipeline(Readable.from(all()), res);
  } catch (error) {
    // The client closed the connection mid-download: nothing to report. Anything else is a real failure.
    if ((error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
  }
}
