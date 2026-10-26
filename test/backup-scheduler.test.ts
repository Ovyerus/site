import { describe, expect, test } from "vitest";
import { scheduleBackups } from "../scripts/backup-scheduler.mjs";

const env = {
  EMDASH_BACKUPS_ENABLED: "true",
  FLY_MACHINE_ID: "primary",
  PRIMARY_MACHINE_ID: "primary",
  EMDASH_READ_ONLY: "false",
};
function timers() {
  const scheduled: {
    callback: () => Promise<void>;
    delay: number;
    unref: number;
  }[] = [];
  const install = (callback: () => Promise<void>, delay: number) => {
    const timer = { callback, delay, unref: 0 };
    scheduled.push(timer);
    return {
      unref: () => {
        timer.unref++;
      },
    };
  };
  return { scheduled, setTimeout: install, setInterval: install };
}

describe("backup scheduler", () => {
  test("registers no work unless explicitly enabled on writable fixed primary", () => {
    for (const change of [
      { EMDASH_BACKUPS_ENABLED: "false" },
      { FLY_MACHINE_ID: "replica" },
      { PRIMARY_MACHINE_ID: "different" },
      { EMDASH_READ_ONLY: "true" },
    ]) {
      const fake = timers();
      expect(
        scheduleBackups({
          ...fake,
          env: { ...env, ...change },
          load: async () => {
            throw Error("unexpected import");
          },
        }),
      ).toBeNull();
      expect(fake.scheduled).toEqual([]);
    }
  });

  test("timers are lazy and unref; first delay and hourly tick request due-only backup", async () => {
    const fake = timers(),
      calls: unknown[] = [];
    let imports = 0;
    const scheduled = scheduleBackups({
      ...fake,
      env,
      load: async () => {
        imports++;
        return {
          runBackup: async (args: unknown) => {
            calls.push(args);
          },
        };
      },
    });
    expect(scheduled).not.toBeNull();
    expect(imports).toBe(0);
    expect(fake.scheduled.map((timer) => [timer.delay, timer.unref])).toEqual([
      [300_000, 1],
      [3_600_000, 1],
    ]);
    await fake.scheduled[0].callback();
    await fake.scheduled[1].callback();
    expect(imports).toBe(2);
    expect(calls).toEqual([
      { env, onlyIfDue: true },
      { env, onlyIfDue: true },
    ]);
  });

  test("overlapping ticks skip and errors redact sensitive details, then permit retry", async () => {
    const fake = timers(),
      logs: string[] = [];
    let count = 0,
      release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduled = scheduleBackups({
      ...fake,
      env,
      log: (message: string) => logs.push(message),
      load: async () => ({
        runBackup: async () => {
          count++;
          if (count === 1) {
            started();
            await wait;
            throw new TypeError("credential fixture-secret");
          }
        },
      }),
    });
    const first = scheduled!.tick();
    await entered;
    await scheduled!.tick();
    expect(count).toBe(1);
    release();
    await first;
    expect(logs).toEqual([
      JSON.stringify({ event: "backup-failed", error: "TypeError" }),
    ]);
    await scheduled!.tick();
    expect(count).toBe(2);
  });
});
