import { describe, expect, test } from "bun:test";
import { startScheduler } from "../../../src/jobs/notification-scheduler.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startScheduler", () => {
  test("runs once at once, then on every interval, until stopped", async () => {
    let runs = 0;
    const handle = startScheduler(() => {
      runs += 1;
      return Promise.resolve();
    }, 20);
    await sleep(110);
    handle.stop();
    const stoppedAt = runs;
    expect(stoppedAt).toBeGreaterThanOrEqual(3);
    await sleep(80);
    expect(runs).toBe(stoppedAt);
  });

  test("never overlaps runs: a slow run makes later ticks wait", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const handle = startScheduler(async () => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(60);
      active -= 1;
    }, 10);
    await sleep(200);
    handle.stop();
    await sleep(80);
    expect(maxActive).toBe(1);
    expect(runs).toBeLessThan(6); // ~200ms / 60ms, not 200ms / 10ms
  });

  test("a failing run does not stop the schedule", async () => {
    let runs = 0;
    const handle = startScheduler(() => {
      runs += 1;
      return runs === 1 ? Promise.reject(new Error("db down")) : Promise.resolve();
    }, 20);
    await sleep(110);
    handle.stop();
    expect(runs).toBeGreaterThanOrEqual(3);
  });
});
