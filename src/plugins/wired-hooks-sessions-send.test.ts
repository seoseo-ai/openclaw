import { describe, expect, it, vi } from "vitest";
import { createHookRunnerWithRegistry } from "./hooks.test-helpers.js";

const sessionsSendEvent = {
  sessionKey: "agent:test:target",
  target: {
    sessionKey: "agent:test:target",
    displayKey: "agent:test:target",
  },
  message: "delegate this",
  task: {
    intent: "delegate",
    instructions: "Ask another worker",
    requester: {
      sessionKey: "agent:test:requester",
      channel: "discord",
    },
    runtime: {
      waitRunId: "wait-run-1",
      announceTimeoutMs: 10_000,
      maxPingPongTurns: 2,
    },
  },
  rawParams: {
    sessionKey: "agent:test:target",
    message: "delegate this",
  },
};

const sessionsSendCtx = {
  toolName: "sessions_send",
  toolCallId: "call-1",
  sessionKey: "agent:test:requester",
};

describe("sessions_send hook runner", () => {
  it("stops at the first handled sessions_send hook", async () => {
    const first = vi.fn().mockResolvedValue({
      handled: true,
      mode: "delegated",
      dispatch: {
        kind: "a2a-broker",
        taskId: "task-1",
        waitRunId: "wait-run-1",
      },
    });
    const second = vi.fn().mockResolvedValue({
      handled: true,
      mode: "direct",
      result: { status: "ok" },
    });
    const { runner } = createHookRunnerWithRegistry([
      { hookName: "sessions_send", handler: first },
      { hookName: "sessions_send", handler: second },
    ]);

    const result = await runner.runSessionsSend(sessionsSendEvent, sessionsSendCtx);

    expect(result).toEqual({
      handled: true,
      mode: "delegated",
      dispatch: {
        kind: "a2a-broker",
        taskId: "task-1",
        waitRunId: "wait-run-1",
      },
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("continues after a declined hook and returns the next handled result", async () => {
    const declining = vi.fn().mockResolvedValue({
      handled: false,
      reason: "plugin disabled",
    });
    const handled = vi.fn().mockResolvedValue({
      handled: true,
      mode: "delegated",
      dispatch: {
        kind: "a2a-broker",
        taskId: "task-2",
      },
    });
    const { runner } = createHookRunnerWithRegistry([
      { hookName: "sessions_send", handler: declining },
      { hookName: "sessions_send", handler: handled },
    ]);

    const result = await runner.runSessionsSend(sessionsSendEvent, sessionsSendCtx);

    expect(result).toEqual({
      handled: true,
      mode: "delegated",
      dispatch: {
        kind: "a2a-broker",
        taskId: "task-2",
      },
    });
    expect(declining).toHaveBeenCalledTimes(1);
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("returns a declined result when every sessions_send hook declines", async () => {
    const { runner } = createHookRunnerWithRegistry([
      {
        hookName: "sessions_send",
        handler: vi.fn().mockResolvedValue({
          handled: false,
          reason: "missing broker config",
        }),
      },
    ]);

    const result = await runner.runSessionsSend(sessionsSendEvent, sessionsSendCtx);

    expect(result).toEqual({
      handled: false,
      reason: "missing broker config",
    });
  });
});
