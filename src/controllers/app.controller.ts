import type { Request, Response } from "express";
import { index } from "../services/app.service.js";

type T = ReturnType<typeof index>;

export function indexApp(_req: Request, res: Response<T>): void {
  res.status(200).json(index());
}
