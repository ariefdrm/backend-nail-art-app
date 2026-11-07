// Exercises the real Express app over HTTP. Needs no database.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../../src/app.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("http", () => {
  test("GET /health/live returns ok", async () => {
    const res = await fetch(`${base}/health/live`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("unknown route returns the error format with NOT_FOUND", async () => {
    const res = await fetch(`${base}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan" },
    });
  });

  test("malformed JSON returns 422 VALIDATION_ERROR", async () => {
    const res = await fetch(`${base}/api/v1/nope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  test("generates a request id and echoes a valid client one", async () => {
    const generated = await fetch(`${base}/health/live`);
    expect(generated.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await fetch(`${base}/health/live`, { headers: { "x-request-id": "abc-123" } });
    expect(echoed.headers.get("x-request-id")).toBe("abc-123");

    const unsafe = await fetch(`${base}/health/live`, { headers: { "x-request-id": "bad id\twith spaces" } });
    expect(unsafe.headers.get("x-request-id")).not.toContain("spaces");
  });

  test("does not advertise Express", async () => {
    const res = await fetch(`${base}/health/live`);
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});
