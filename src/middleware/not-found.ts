import type { RequestHandler } from "express";
import { AppError } from "../utils/errors.js";

export const notFound: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound("Endpoint tidak ditemukan"));
};
