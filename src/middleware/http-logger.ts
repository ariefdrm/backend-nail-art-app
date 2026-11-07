import { pinoHttp } from "pino-http";
import { logger } from "../utils/logger.js";

// pino-http types `res` as a plain ServerResponse; at runtime it is Express's
// Response, whose `locals.requestId` is set by the request-id middleware.
function requestIdOf(res: object): string | undefined {
  return (res as { locals?: { requestId?: string } }).locals?.requestId;
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (_req, res) => requestIdOf(res) ?? "unknown",
  customProps: (_req, res) => ({ request_id: requestIdOf(res) }),
  // Keep health probes out of the logs.
  autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
});
