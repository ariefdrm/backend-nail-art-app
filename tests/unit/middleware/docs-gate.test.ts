import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { createDocsGate, type DocsAccess } from "../../../src/middleware/docs-gate.js";
import type { AppError } from "../../../src/utils/errors.js";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

function run(access: DocsAccess, authorization?: string) {
  const headers: Record<string, string> = {};
  let outcome = "next" as "next" | AppError;
  const req = {
    header: (name: string) => (name === "authorization" ? authorization : undefined),
  } as unknown as Request;
  const res = { setHeader: (name: string, value: string) => (headers[name] = value) } as unknown as Response;
  createDocsGate(() => access)(req, res, (error?: unknown) => {
    outcome = error ? (error as AppError) : "next";
  });
  return { outcome, headers };
}

const production = { nodeEnv: "production", user: "docs", password: "a-long-enough-password" };

describe("docs gate", () => {
  test("is open outside production, with or without credentials", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(run({ nodeEnv, user: "docs", password: undefined }).outcome).toBe("next");
    }
  });

  test("production without DOCS_PASSWORD answers 404, as if the docs did not exist", () => {
    const { outcome } = run({ ...production, password: undefined }, basic("docs", "anything"));
    expect((outcome as AppError).httpStatus).toBe(404);
  });

  test("production asks for Basic credentials, and 401s a missing or malformed header", () => {
    for (const header of [
      undefined,
      "Bearer token",
      "Basic",
      "Basic !!!",
      `Basic ${Buffer.from("nocolon").toString("base64")}`,
    ]) {
      const { outcome, headers } = run(production, header);
      expect((outcome as AppError).httpStatus).toBe(401);
      expect(headers["WWW-Authenticate"]).toContain("Basic");
    }
  });

  test("production rejects a wrong user or a wrong password", () => {
    expect((run(production, basic("docs", "wrong-password-here")).outcome as AppError).httpStatus).toBe(401);
    expect((run(production, basic("admin", "a-long-enough-password")).outcome as AppError).httpStatus).toBe(401);
    expect((run(production, basic("", "")).outcome as AppError).httpStatus).toBe(401);
  });

  test("production lets the right credentials through, including a password containing a colon", () => {
    expect(run(production, basic("docs", "a-long-enough-password")).outcome).toBe("next");
    const withColon = { ...production, password: "pass:with:colons-1" };
    expect(run(withColon, basic("docs", "pass:with:colons-1")).outcome).toBe("next");
  });
});
