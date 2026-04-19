import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRuntimeTimer } from "./runtime-timer.js";

describe("createRuntimeTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a timeout that fires onElapsed", () => {
    const timer = createRuntimeTimer();
    const onElapsed = vi.fn();

    const handle = timer.scheduleTimeout({
      id: "t1",
      timeoutMs: 5000,
      onElapsed,
    });

    expect(handle.id).toBe("t1");
    expect(handle.timeoutMs).toBe(5000);
    expect(handle.active).toBe(true);
    expect(timer.isActive("t1")).toBe(true);

    vi.advanceTimersByTime(5000);

    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(timer.isActive("t1")).toBe(false);
  });

  it("cancel prevents the callback from firing", () => {
    const timer = createRuntimeTimer();
    const onElapsed = vi.fn();

    timer.scheduleTimeout({ id: "t2", timeoutMs: 3000, onElapsed });
    expect(timer.isActive("t2")).toBe(true);

    timer.cancel("t2");
    expect(timer.isActive("t2")).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("cancel is a no-op for unknown ids", () => {
    const timer = createRuntimeTimer();
    expect(() => timer.cancel("nonexistent")).not.toThrow();
  });

  it("re-schedule replaces the previous timer", () => {
    const timer = createRuntimeTimer();
    const first = vi.fn();
    const second = vi.fn();

    timer.scheduleTimeout({ id: "t3", timeoutMs: 1000, onElapsed: first });
    timer.scheduleTimeout({ id: "t3", timeoutMs: 2000, onElapsed: second });

    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cancelAll(owner) cancels only matching timers", () => {
    const timer = createRuntimeTimer();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();

    timer.scheduleTimeout({ id: "a1", timeoutMs: 5000, onElapsed: a, owner: "task-A" });
    timer.scheduleTimeout({ id: "a2", timeoutMs: 5000, onElapsed: b, owner: "task-A" });
    timer.scheduleTimeout({ id: "b1", timeoutMs: 5000, onElapsed: c, owner: "task-B" });

    timer.cancelAll("task-A");

    expect(timer.isActive("a1")).toBe(false);
    expect(timer.isActive("a2")).toBe(false);
    expect(timer.isActive("b1")).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("cancelAll() without owner cancels everything", () => {
    const timer = createRuntimeTimer();
    const a = vi.fn();
    const b = vi.fn();

    timer.scheduleTimeout({ id: "x", timeoutMs: 5000, onElapsed: a, owner: "owner1" });
    timer.scheduleTimeout({ id: "y", timeoutMs: 5000, onElapsed: b });

    timer.cancelAll();

    expect(timer.isActive("x")).toBe(false);
    expect(timer.isActive("y")).toBe(false);

    vi.advanceTimersByTime(10000);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("isActive returns false for unknown ids", () => {
    const timer = createRuntimeTimer();
    expect(timer.isActive("nope")).toBe(false);
  });

  it("isActive returns false after timer has elapsed", () => {
    const timer = createRuntimeTimer();
    timer.scheduleTimeout({ id: "elapsed-test", timeoutMs: 1000, onElapsed: vi.fn() });

    vi.advanceTimersByTime(1000);
    expect(timer.isActive("elapsed-test")).toBe(false);
  });

  it("supports async onElapsed callbacks", async () => {
    const timer = createRuntimeTimer();
    const onElapsed = vi.fn().mockResolvedValue(undefined);

    timer.scheduleTimeout({ id: "async-t", timeoutMs: 1000, onElapsed });
    vi.advanceTimersByTime(1000);

    // Allow microtask queue to flush
    await vi.runAllTimersAsync();

    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("catches errors in onElapsed without breaking other timers", () => {
    const timer = createRuntimeTimer();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();

    timer.scheduleTimeout({ id: "bad", timeoutMs: 1000, onElapsed: bad });
    timer.scheduleTimeout({ id: "good", timeoutMs: 2000, onElapsed: good });

    vi.advanceTimersByTime(1000);
    expect(bad).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("validates id parameter", () => {
    const timer = createRuntimeTimer();
    expect(() => timer.scheduleTimeout({ id: "", timeoutMs: 1000, onElapsed: vi.fn() })).toThrow(
      "id must be a non-empty string",
    );
  });

  it("validates timeoutMs parameter", () => {
    const timer = createRuntimeTimer();
    expect(() => timer.scheduleTimeout({ id: "x", timeoutMs: -1, onElapsed: vi.fn() })).toThrow(
      "timeoutMs must be a non-negative finite number",
    );
    expect(() =>
      timer.scheduleTimeout({ id: "x", timeoutMs: Infinity, onElapsed: vi.fn() }),
    ).toThrow("timeoutMs must be a non-negative finite number");
  });

  it("validates onElapsed parameter", () => {
    const timer = createRuntimeTimer();
    expect(() =>
      timer.scheduleTimeout({
        id: "x",
        timeoutMs: 1000,
        onElapsed: "not a fn" as unknown as () => void,
      }),
    ).toThrow("onElapsed must be a function");
  });

  it("handles handle.unref() gracefully when available", () => {
    const timer = createRuntimeTimer();
    // Should not throw even though setTimeout handle may or may not have unref
    expect(() =>
      timer.scheduleTimeout({ id: "unref-test", timeoutMs: 5000, onElapsed: vi.fn() }),
    ).not.toThrow();
  });
});
