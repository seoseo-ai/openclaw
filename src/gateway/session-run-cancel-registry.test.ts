import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  clearSessionRunCancelHandlers,
  fanOutSessionRunCancel,
  hasSessionRunCancelHandler,
  registerSessionRunCancelHandler,
  type SessionRunCancelTarget,
} from "./session-run-cancel-registry.js";

function makeTarget(sessionKey = "main", runId = "run-1"): SessionRunCancelTarget {
  return { kind: "session_run", sessionKey, runId };
}

afterEach(() => {
  __testing.reset();
});

describe("SessionRunCancelRegistry", () => {
  describe("register / hasSessionRunCancelHandler", () => {
    it("tracks registered handlers and reports via hasSessionRunCancelHandler", () => {
      const target = makeTarget();
      expect(hasSessionRunCancelHandler(target)).toBe(false);

      const dispose = registerSessionRunCancelHandler(
        target,
        vi.fn().mockReturnValue({ status: "cancelled" }),
      );
      expect(hasSessionRunCancelHandler(target)).toBe(true);

      dispose();
      expect(hasSessionRunCancelHandler(target)).toBe(false);
    });

    it("supports multiple handlers per target", () => {
      const target = makeTarget();
      const d1 = registerSessionRunCancelHandler(
        target,
        vi.fn().mockReturnValue({ status: "cancelled" }),
      );
      const d2 = registerSessionRunCancelHandler(
        target,
        vi.fn().mockReturnValue({ status: "cancelled" }),
      );

      d1();
      expect(hasSessionRunCancelHandler(target)).toBe(true); // d2 still active
      d2();
      expect(hasSessionRunCancelHandler(target)).toBe(false);
    });
  });

  describe("fanOutSessionRunCancel (host → plugins)", () => {
    it("invokes all registered handlers for the target", async () => {
      const target = makeTarget();
      const h1 = vi.fn().mockReturnValue({ status: "cancelled" });
      const h2 = vi.fn().mockReturnValue({ status: "cancelled" });
      registerSessionRunCancelHandler(target, h1);
      registerSessionRunCancelHandler(target, h2);

      const result = await fanOutSessionRunCancel(target);

      expect(result.notified).toBe(2);
      expect(result.results).toEqual([{ status: "cancelled" }, { status: "cancelled" }]);
      expect(h1).toHaveBeenCalledWith(target);
      expect(h2).toHaveBeenCalledWith(target);
    });

    it("cleans up handlers after fan-out (one-shot)", async () => {
      const target = makeTarget();
      registerSessionRunCancelHandler(target, vi.fn().mockReturnValue({ status: "cancelled" }));

      await fanOutSessionRunCancel(target);
      expect(hasSessionRunCancelHandler(target)).toBe(false);

      // Second fan-out is a no-op.
      const result = await fanOutSessionRunCancel(target);
      expect(result).toEqual({ notified: 0, results: [] });
    });

    it("returns notified:0 when no handlers are registered", async () => {
      const result = await fanOutSessionRunCancel(makeTarget());
      expect(result).toEqual({ notified: 0, results: [] });
    });

    it("catches handler errors and reports no-active-run with reason", async () => {
      const target = makeTarget();
      const failing = vi.fn().mockRejectedValue(new Error("boom"));
      const passing = vi.fn().mockReturnValue({ status: "cancelled" });
      registerSessionRunCancelHandler(target, failing);
      registerSessionRunCancelHandler(target, passing);

      const result = await fanOutSessionRunCancel(target);

      expect(result.notified).toBe(2);
      expect(result.results[0]).toEqual({ status: "no-active-run", reason: "boom" });
      expect(result.results[1]).toEqual({ status: "cancelled" });
    });

    it("does not affect handlers for other targets", async () => {
      const t1 = makeTarget("s1", "r1");
      const t2 = makeTarget("s2", "r2");
      const h1 = vi.fn().mockReturnValue({ status: "cancelled" });
      const h2 = vi.fn().mockReturnValue({ status: "cancelled" });
      registerSessionRunCancelHandler(t1, h1);
      registerSessionRunCancelHandler(t2, h2);

      await fanOutSessionRunCancel(t1);

      expect(h1).toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
      expect(hasSessionRunCancelHandler(t2)).toBe(true);
    });

    it("handler returning already-terminal is preserved in results", async () => {
      const target = makeTarget();
      registerSessionRunCancelHandler(target, () => ({
        status: "already-terminal",
        reason: "task already completed",
      }));

      const result = await fanOutSessionRunCancel(target);

      expect(result.notified).toBe(1);
      expect(result.results[0]).toEqual({
        status: "already-terminal",
        reason: "task already completed",
      });
    });
  });

  describe("clearSessionRunCancelHandlers", () => {
    it("removes all handlers for a specific target without invoking them", async () => {
      const target = makeTarget();
      const handler = vi.fn().mockReturnValue({ status: "cancelled" });
      registerSessionRunCancelHandler(target, handler);

      clearSessionRunCancelHandlers(target);

      expect(hasSessionRunCancelHandler(target)).toBe(false);
      const result = await fanOutSessionRunCancel(target);
      expect(result).toEqual({ notified: 0, results: [] });
      expect(handler).not.toHaveBeenCalled();
    });

    it("clears all targets when called without argument", () => {
      registerSessionRunCancelHandler(
        makeTarget("a", "1"),
        vi.fn().mockReturnValue({ status: "cancelled" }),
      );
      registerSessionRunCancelHandler(
        makeTarget("b", "2"),
        vi.fn().mockReturnValue({ status: "cancelled" }),
      );

      clearSessionRunCancelHandlers();

      expect(hasSessionRunCancelHandler(makeTarget("a", "1"))).toBe(false);
      expect(hasSessionRunCancelHandler(makeTarget("b", "2"))).toBe(false);
    });
  });

  describe("integration: chat-abort fan-out hook", () => {
    it("abortChatRunById triggers fan-out via global registry", async () => {
      const { abortChatRunById } = await import("./chat-abort.js");

      const handler = vi.fn().mockReturnValue({ status: "cancelled" });
      const target = makeTarget("main", "run-1");
      registerSessionRunCancelHandler(target, handler);

      const entry = {
        controller: new AbortController(),
        sessionId: "sess-1",
        sessionKey: "main",
        startedAtMs: Date.now(),
        expiresAtMs: Date.now() + 10_000,
      };

      const ops = {
        chatAbortControllers: new Map([["run-1", entry]]),
        chatRunBuffers: new Map<string, string>(),
        chatDeltaSentAt: new Map<string, number>(),
        chatDeltaLastBroadcastLen: new Map<string, number>(),
        chatAbortedRuns: new Map<string, number>(),
        removeChatRun: vi.fn(),
        agentRunSeq: new Map<string, number>(),
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
      };

      const result = abortChatRunById(ops, {
        runId: "run-1",
        sessionKey: "main",
        stopReason: "user",
      });

      expect(result).toEqual({ aborted: true });
      // Fan-out is fire-and-forget; await a tick for the async handler.
      await new Promise((r) => setTimeout(r, 10));
      expect(handler).toHaveBeenCalledWith({
        kind: "session_run",
        sessionKey: "main",
        runId: "run-1",
      });
    });

    it("no-active-run: abortChatRunById returns aborted:false for unknown run", async () => {
      const { abortChatRunById } = await import("./chat-abort.js");

      const ops = {
        chatAbortControllers: new Map(),
        chatRunBuffers: new Map<string, string>(),
        chatDeltaSentAt: new Map<string, number>(),
        chatDeltaLastBroadcastLen: new Map<string, number>(),
        chatAbortedRuns: new Map<string, number>(),
        removeChatRun: vi.fn(),
        agentRunSeq: new Map<string, number>(),
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
      };

      const result = abortChatRunById(ops, {
        runId: "nonexistent",
        sessionKey: "main",
      });

      expect(result).toEqual({ aborted: false });
    });
  });
});
