import { afterEach, describe, expect, it, vi } from "vitest";
import { withSerializableRetry } from "./transaction";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("withSerializableRetry", () => {
  it("reruns the complete operation, including a rejected commit promise", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts += 1;
      events.push("begin", "authorize", "read", "write");
      // Models the outer transaction promise failing AFTER its callback returns.
      await Promise.resolve();
      events.push("commit");
      if (attempts === 1) throw { code: "40001" };
      return "committed";
    });
    const result = withSerializableRetry(operation);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("committed");
    expect(events).toEqual([...Array(2)].flatMap(() => ["begin", "authorize", "read", "write", "commit"]));
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 99])("caps total attempts and delay with retries=%s", async (retries) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const timer = vi.spyOn(globalThis, "setTimeout");
    const failure = { code: "40P01" };
    const operation = vi.fn().mockRejectedValue(failure);
    const result = withSerializableRetry(operation, retries);
    const assertion = expect(result).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await assertion;
    expect(operation).toHaveBeenCalledTimes(4);
    expect(timer.mock.calls.map((call) => call[1])).toEqual([99.5, 149.5, 249.5]);
  });

  it.each([0, 1, 2])("retains the retries parameter (%s)", async (retries) => {
    vi.useFakeTimers();
    const failure = { code: "P2034" };
    const operation = vi.fn().mockRejectedValue(failure);
    const assertion = expect(withSerializableRetry(operation, retries)).rejects.toBe(failure);
    await vi.runAllTimersAsync(); await assertion;
    expect(operation).toHaveBeenCalledTimes(retries + 1);
  });

  it.each(["P0001", "23505", "23514", "08006", "ECONNRESET"])("does not replay %s", async (code) => {
    const failure = { code };
    const operation = vi.fn().mockRejectedValue(failure);
    await expect(withSerializableRetry(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("runs the post-commit external effect once after a failed attempt and successful retry", async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce({ code: "40001" })
      .mockResolvedValue({ id: "committed" });
    const external = vi.fn();
    const committed = withSerializableRetry(operation).then((result) => {
      external(result);
      return result;
    });
    expect(external).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await expect(committed).resolves.toEqual({ id: "committed" });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(external).toHaveBeenCalledExactlyOnceWith({ id: "committed" });
  });

  it.each([-1, 1.5, NaN, Infinity])("rejects invalid retry count %s before running", async (retries) => {
    const operation = vi.fn();
    await expect(withSerializableRetry(operation, retries)).rejects.toBeInstanceOf(RangeError);
    expect(operation).not.toHaveBeenCalled();
  });
});
