import { abortChatRunById, type ChatAbortOps } from "../gateway/chat-abort.js";
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";
import {
  registerSessionRunCancelHandler,
  type SessionRunCancelHandler,
  type SessionRunCancelHandlerResult,
  type SessionRunCancelStatus,
  type SessionRunCancelTarget,
} from "../gateway/session-run-cancel-registry.js";

function createChatAbortOps(context: GatewayRequestContext): ChatAbortOps {
  return {
    chatAbortControllers: context.chatAbortControllers,
    chatRunBuffers: context.chatRunBuffers,
    chatDeltaSentAt: context.chatDeltaSentAt,
    chatDeltaLastBroadcastLen: context.chatDeltaLastBroadcastLen,
    chatAbortedRuns: context.chatAbortedRuns,
    removeChatRun: context.removeChatRun,
    agentRunSeq: context.agentRunSeq,
    broadcast: context.broadcast,
    nodeSendToSession: context.nodeSendToSession,
  };
}

export type {
  SessionRunCancelHandler,
  SessionRunCancelHandlerResult,
  SessionRunCancelStatus,
  SessionRunCancelTarget,
};

export function registerDelegatedSessionRunCancelHandler(
  target: SessionRunCancelTarget,
  handler: SessionRunCancelHandler,
): () => void {
  return registerSessionRunCancelHandler(target, handler);
}

export function cancelSessionRunTarget(params: {
  context: GatewayRequestContext;
  target: SessionRunCancelTarget;
  stopReason?: string;
}): { aborted: boolean } {
  return abortChatRunById(createChatAbortOps(params.context), {
    runId: params.target.runId,
    sessionKey: params.target.sessionKey,
    stopReason: params.stopReason,
  });
}
