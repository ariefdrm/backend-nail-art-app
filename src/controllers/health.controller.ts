import type { Request, Response } from "express";
import { isReady } from "../services/health.service.js";

export function live(_req: Request, res: Response): void {
  res.status(200).json({ status: "ok" });
}

export async function ready(_req: Request, res: Response): Promise<void> {
  if (await isReady()) {
    res.status(200).json({ status: "ok" });
  } else {
    res.status(503).json({ status: "unavailable" });
  }
}
