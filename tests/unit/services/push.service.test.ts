import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";
import type { PushResult } from "../../../src/utils/web-push.js";

const ADMIN = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-09T01:00:00Z");
const CONFIG = { publicKey: "pub", privateKey: "priv", subject: "mailto:owner@nailpalace.test" };
const INPUT = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "pk", auth: "au" } };

let upsertResult: { id: string; createdAt: Date; created: boolean };
let subscriptions: { endpoint: string; p256dh: string; auth: string }[];
let claimed: { id: string; type: string; title: string; body: string; bookingId: string | null }[];
const calls = {
  upsert: [] as unknown[][],
  deleted: [] as unknown[][],
  deletedByEndpoint: [] as string[],
  claim: [] as unknown[][],
  listed: 0,
};

await mock.module("../../../src/repositories/push.repository.js", () => ({
  upsertSubscription: (...args: unknown[]) => {
    calls.upsert.push(args);
    return Promise.resolve(upsertResult);
  },
  deleteSubscription: (...args: unknown[]) => {
    calls.deleted.push(args);
    return Promise.resolve(1);
  },
  deleteByEndpoint: (endpoint: string) => {
    calls.deletedByEndpoint.push(endpoint);
    return Promise.resolve();
  },
  listSubscriptions: () => {
    calls.listed += 1;
    return Promise.resolve(subscriptions);
  },
  claimUnpushed: (...args: unknown[]) => {
    calls.claim.push(args);
    return Promise.resolve(claimed);
  },
}));

const push = await import("../../../src/services/push.service.js");

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected the call to fail");
}

const notification = (id: string) => ({
  id,
  type: "new_booking",
  title: "Reservasi baru",
  body: `isi ${id}`,
  bookingId: "b1",
});

beforeEach(() => {
  upsertResult = { id: "s1", createdAt: NOW, created: true };
  subscriptions = [
    { endpoint: "https://fcm.googleapis.com/fcm/send/one", p256dh: "p1", auth: "a1" },
    { endpoint: "https://updates.push.services.mozilla.com/two", p256dh: "p2", auth: "a2" },
  ];
  claimed = [notification("n1")];
  for (const key of ["upsert", "deleted", "deletedByEndpoint", "claim"] as const) calls[key].length = 0;
  calls.listed = 0;
});

describe("public key and subscriptions", () => {
  test("hands out the public key, or 404 when Web Push is not configured", () => {
    expect(push.getPublicKey(CONFIG)).toEqual({ public_key: "pub" });
    expect(() => push.getPublicKey(null)).toThrow(expect.objectContaining({ httpStatus: 404 }) as never);
  });

  test("registers a device and reports whether it is new", async () => {
    const created = await push.subscribe(ADMIN, INPUT, CONFIG);
    expect(calls.upsert[0]).toEqual([ADMIN, { endpoint: INPUT.endpoint, p256dh: "pk", auth: "au" }]);
    expect(created).toEqual({ subscription: { id: "s1", created_at: "2026-11-09T08:00:00+07:00" }, created: true });
    upsertResult = { ...upsertResult, created: false };
    expect((await push.subscribe(ADMIN, INPUT, CONFIG)).created).toBe(false);
  });

  test("404 when registering without Web Push configured, and nothing is stored", async () => {
    expect((await failure(push.subscribe(ADMIN, INPUT, null))).httpStatus).toBe(404);
    expect(calls.upsert).toHaveLength(0);
  });

  test("unsubscribing is scoped to the signed-in admin", async () => {
    await push.unsubscribe(ADMIN, INPUT.endpoint);
    expect(calls.deleted[0]).toEqual([ADMIN, INPUT.endpoint]);
  });
});

describe("dispatchPending", () => {
  const ok = (): Promise<PushResult> => Promise.resolve("ok");

  test("does nothing, and takes nothing, when Web Push is not configured", async () => {
    const result = await push.dispatchPending({ now: NOW, config: null, sender: ok });
    expect(result).toEqual({ notifications: 0, sent: 0, gone: 0, failed: 0 });
    expect(calls.claim).toHaveLength(0);
  });

  test("leaves notifications alone while nobody is subscribed", async () => {
    subscriptions = [];
    const result = await push.dispatchPending({ now: NOW, config: CONFIG, sender: ok });
    expect(result.notifications).toBe(0);
    expect(calls.claim).toHaveLength(0);
  });

  test("claims only fresh notifications (last 15 minutes)", async () => {
    await push.dispatchPending({ now: NOW, config: CONFIG, sender: ok });
    const [at, since, take] = calls.claim[0] as [Date, Date, number];
    expect(at).toEqual(NOW);
    expect(since).toEqual(new Date("2026-11-09T00:45:00Z"));
    expect(take).toBeGreaterThan(0);
  });

  test("sends every notification to every device with a payload that has no phone number", async () => {
    claimed = [notification("n1"), notification("n2")];
    const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
    const result = await push.dispatchPending({
      now: NOW,
      config: CONFIG,
      sender: (target, payload) => {
        sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
        return ok();
      },
    });
    expect(result).toEqual({ notifications: 2, sent: 4, gone: 0, failed: 0 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/one",
      "https://fcm.googleapis.com/fcm/send/one",
      "https://updates.push.services.mozilla.com/two",
      "https://updates.push.services.mozilla.com/two",
    ]);
    expect(sent[0]?.payload).toEqual({
      notification_id: "n1",
      booking_id: "b1",
      type: "new_booking",
      title: "Reservasi baru",
      body: "isi n1",
    });
  });

  test("deletes a subscription the push service says is gone, and keeps going", async () => {
    const result = await push.dispatchPending({
      now: NOW,
      config: CONFIG,
      sender: (target) => Promise.resolve<PushResult>(target.endpoint.includes("mozilla") ? "gone" : "ok"),
    });
    expect(result).toMatchObject({ sent: 1, gone: 1, failed: 0 });
    expect(calls.deletedByEndpoint).toEqual(["https://updates.push.services.mozilla.com/two"]);
  });

  test("a failed delivery is counted, deletes nothing, and does not stop the others", async () => {
    const result = await push.dispatchPending({
      now: NOW,
      config: CONFIG,
      sender: (target) => Promise.resolve<PushResult>(target.endpoint.includes("fcm") ? "failed" : "ok"),
    });
    expect(result).toMatchObject({ sent: 1, gone: 0, failed: 1 });
    expect(calls.deletedByEndpoint).toHaveLength(0);
  });

  test("with nothing to push it sends nothing", async () => {
    claimed = [];
    let calledSender = false;
    const result = await push.dispatchPending({
      now: NOW,
      config: CONFIG,
      sender: () => {
        calledSender = true;
        return ok();
      },
    });
    expect(result.notifications).toBe(0);
    expect(calledSender).toBe(false);
  });
});
