import { describe, expect, test } from "bun:test";
import { subscribePushSchemas, unsubscribePushSchemas } from "../../../src/schemas/push.schema.js";

const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};
const parse = (body: unknown) => subscribePushSchemas.body.safeParse(body);

describe("push subscription schema", () => {
  test("accepts what PushSubscription.toJSON() gives", () => {
    expect(parse(valid).success).toBe(true);
    expect(parse({ ...valid, expirationTime: null }).success).toBe(true); // extra browser fields are ignored
  });

  test("rejects an endpoint that is not a known push service", () => {
    expect(parse({ ...valid, endpoint: "https://evil.test/push" }).success).toBe(false);
    expect(parse({ ...valid, endpoint: "http://fcm.googleapis.com/x" }).success).toBe(false);
    const result = parse({ ...valid, endpoint: "https://169.254.169.254/" });
    expect(result.error?.issues[0]?.path).toEqual(["endpoint"]);
  });

  test("rejects missing or non-base64url keys", () => {
    expect(parse({ endpoint: valid.endpoint }).success).toBe(false);
    expect(parse({ ...valid, keys: { p256dh: valid.keys.p256dh } }).success).toBe(false);
    expect(parse({ ...valid, keys: { ...valid.keys, auth: "has spaces!" } }).success).toBe(false);
    expect(parse({ ...valid, keys: { ...valid.keys, auth: "" } }).success).toBe(false);
    expect(parse({ ...valid, keys: { ...valid.keys, p256dh: "x".repeat(256) } }).success).toBe(false);
  });

  test("unsubscribing needs an https URL but not an allowlisted one (nothing is called)", () => {
    expect(unsubscribePushSchemas.body.safeParse({ endpoint: "https://anything.test/x" }).success).toBe(true);
    expect(unsubscribePushSchemas.body.safeParse({ endpoint: "http://anything.test/x" }).success).toBe(false);
    expect(unsubscribePushSchemas.body.safeParse({}).success).toBe(false);
  });
});
