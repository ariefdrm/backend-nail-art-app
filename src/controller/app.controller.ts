import type { Request, Response } from "express";
import { index } from "../services/app.service.ts";

type T = Awaited<ReturnType<typeof index>>;

export async function indexApp(_req: Request, res: Response<T>): Promise<void> {
  const message = await index();

  res.status(200).json(message);
}
