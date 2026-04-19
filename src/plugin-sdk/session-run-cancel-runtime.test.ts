import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";
import {
  __testing as registryTesting,
  hasSessionRunCancelHandler,
} from "../gateway/session-run-cancel-registry.js";
import {
  cancelSessionRunTarget,
  registerDelegatedSessionRunCancelHandler,
  type SessionRunCancelTarget,
} from "./session-run-cancel-runtime.js";

function createContext(target: SessionRunCancelTarget): GatewayRequestContext {
  const controller = new AbortController();
  return {
    deps: {} as never,
    cron: {} as never,
    cronStorePath: "/tmp/cron.json",
    loadGatewayModelCatalog: async () => [],
    getHealthCache: () => null,
    refreshHealthSnapshot: async () => ({}) as never,
    logHealth: { error: () => {} },
    logGateway: {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => ({}) as never,
    } as never,
    incrementPresenceVersion: () => 1,
    getHealthVersion: () => 1,
    broadcast: vi.fn(),
    broadcastToConnIds: vi.fn(),
    nodeSendToSession: vi.fn(),
    nodeSendToAllSubscribed: vi.fn(),
    nodeSubscribe: vi.fn(),
    nodeUnsubscribe: vi.fn(),
    nodeUnsubscribeAll: vi.fn(),
    hasConnectedMobileNode: () => false,
    nodeRegistry: {} as never,
    agentRunSeq: new Map(),
    chatAbortControllers: new Map([
      [
        target.runId,
        {
          controller,
          sessionId: "sess-1",
          sessionKey: target.sessionKey,
          startedAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
        },
      ],
    ]),
    chatAbortedRuns: new Map(),
    chatRunBuffers: new Map([[target.runId, "partial"]]),
    chatDeltaSentAt: new Map([[target.runId, Date.now()]]),
    chatDeltaLastBroadcastLen: new Map([[target.runId, 7]]),
    addChatRun: vi.fn(),
    removeChatRun: vi.fn(),
    subscribeSessionEvents: vi.fn(),
    unsubscribeSessionEvents: vi.fn(),
    subscribeSessionMessageEvents: vi.fn(),
    unsubscribeSessionMessageEvents: vi.fn(),
    unsubscribeAllSessionEvents: vi.fn(),
    getSessionEventSubscriberConnIds: () => new Set(),
    registerToolEventRecipient: vi.fn(),
    dedupe: new Map(),
    wizardSessions: new Map(),
    findRunningWizard: () => null,
    purgeWizardSession: vi.fn(),
    getRuntimeSnapshot: () => ({}) as never,
    startChannel: async () => {},
    stopChannel: async () => {},
    markChannelLoggedOut: vi.fn(),
    wizardRunner: async () => {},
    broadcastVoiceWakeChanged: vi.fn(),
  } as GatewayRequestContext;
}

afterEach(() => {
  registryTesting.reset();
  vi.restoreAllMocks();
});

describe("session run cancel runtime", () => {
  it("aborts the owning OpenClaw run through the public seam", () => {
    const target: SessionRunCancelTarget = {
      kind: "session_run",
      sessionKey: "agent:main:main",
      runId: "run-1",
    };
    const context = createContext(target);

    const result = cancelSessionRunTarget({
      context,
      target,
      stopReason: "broker-cancel",
    });

    expect(result).toEqual({ aborted: true });
    expect(context.chatAbortControllers.has(target.runId)).toBe(false);
    expect(context.chatAbortedRuns.has(target.runId)).toBe(true);
  });

  it("returns not aborted when there is no active run", () => {
    const target: SessionRunCancelTarget = {
      kind: "session_run",
      sessionKey: "agent:main:main",
      runId: "run-missing",
    };
    const context = createContext({ ...target, runId: "different-run" });

    const result = cancelSessionRunTarget({ context, target });

    expect(result).toEqual({ aborted: false });
  });

  it("fans OpenClaw-side abort back out to registered delegated-task handlers", async () => {
    const target: SessionRunCancelTarget = {
      kind: "session_run",
      sessionKey: "agent:main:main",
      runId: "run-2",
    };
    const context = createContext(target);
    const handler = vi.fn().mockResolvedValue({ status: "cancelled" as const });
    registerDelegatedSessionRunCancelHandler(target, handler);
    expect(hasSessionRunCancelHandler(target)).toBe(true);

    const result = cancelSessionRunTarget({ context, target, stopReason: "user" });
    expect(result).toEqual({ aborted: true });

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith(target);
    });
    expect(hasSessionRunCancelHandler(target)).toBe(false);
  });

  it("allows handlers to report already-terminal without blocking the abort path", async () => {
    const target: SessionRunCancelTarget = {
      kind: "session_run",
      sessionKey: "agent:main:main",
      runId: "run-3",
    };
    const context = createContext(target);
    const handler = vi.fn().mockResolvedValue({
      status: "already-terminal" as const,
      reason: "broker task already finished",
    });
    registerDelegatedSessionRunCancelHandler(target, handler);

    const result = cancelSessionRunTarget({ context, target });
    expect(result).toEqual({ aborted: true });

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith(target);
    });
  });
});
