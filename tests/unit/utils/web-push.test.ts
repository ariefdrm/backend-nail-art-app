import { describe, expect, test } from "bun:test";
import { createSender, type Deliver } from "../../../src/utils/web-push.js";

const target = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "pk", auth: "au" };
const config = { publicKey: "pub", privateKey: "priv", subject: "mailto:owner@nailpalace.test" };

describe("createSender", () => {
  test("hands the subscription, payload and VAPID details to the delivery function", async () => {
    let seen: Parameters<Deliver> | undefined;
    const send = createSender((...args) => {
      seen = args;
      return Promise.resolve({ statusCode: 201 });
    });
    expect(await send(target, '{"a":1}', config)).toBe("ok");
    expect(seen?.[0]).toEqual({ endpoint: target.endpoint, keys: { p256dh: "pk", auth: "au" } });
    expect(seen?.[1]).toBe('{"a":1}');
    expect(seen?.[2]).toMatchObject({
      vapidDetails: { subject: config.subject, publicKey: "pub", privateKey: "priv" },
      TTL: 3600,
      timeout: 10_000,
    });
  });

  test("404 and 410 mean the subscription is gone", async () => {
    for (const statusCode of [404, 410]) {
      const send = createSender(() => Promise.reject(Object.assign(new Error("gone"), { statusCode })));
      expect(await send(target, "{}", config)).toBe("gone");
    }
  });

  test("any other failure is 'failed' and never throws", async () => {
    for (const error of [
      Object.assign(new Error("rate"), { statusCode: 429 }),
      Object.assign(new Error("server"), { statusCode: 500 }),
      Object.assign(new Error("unauthorized"), { statusCode: 401 }),
      new Error("socket hang up"),
    ]) {
      const send = createSender(() => Promise.reject(error));
      expect(await send(target, "{}", config)).toBe("failed");
    }
  });
});
