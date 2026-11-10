import { describe, expect, it } from "vitest";

import { withResponseFloor } from "./recovery-timing";

function clock(steps: number[]) {
  let index = 0;
  return () => steps[Math.min(index++, steps.length - 1)];
}

describe("withResponseFloor", () => {
  it("waits for the rest of the floor when the work is fast", async () => {
    const waits: number[] = [];
    const result = await withResponseFloor(500, async () => "ok", {
      now: clock([1000, 1100]),
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(result).toBe("ok");
    expect(waits).toEqual([400]);
  });

  it("does not wait when the work already took longer", async () => {
    const waits: number[] = [];
    await withResponseFloor(500, async () => 1, {
      now: clock([0, 700]),
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([]);
  });

  it("still waits when the work throws, and rethrows", async () => {
    const waits: number[] = [];
    let message = "";

    try {
      await withResponseFloor(
        500,
        async () => {
          throw new Error("boom");
        },
        {
          now: clock([0, 100]),
          wait: async (ms) => {
            waits.push(ms);
          },
        },
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("boom");
    expect(waits).toEqual([400]);
  });
});
