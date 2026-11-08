import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { getEnv } from "../config/env.js";

let client: PrismaClient | undefined;

/** Lazy singleton so importing the app does not require DATABASE_URL. */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
  });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Prisma's own error code, e.g. "P2025" (record not found). */
export function prismaErrorCode(err: unknown): string | undefined {
  const code = asRecord(err)?.["code"];
  return typeof code === "string" ? code : undefined;
}

/**
 * PostgreSQL SQLSTATE of a database error raised through the pg driver adapter,
 * e.g. "23503" (foreign key violation) or "23P01" (exclusion violation).
 */
export function sqlState(err: unknown): string | undefined {
  const cause = asRecord(asRecord(asRecord(asRecord(err)?.["meta"])?.["driverAdapterError"])?.["cause"]);
  const code = cause?.["originalCode"];
  return typeof code === "string" ? code : undefined;
}
