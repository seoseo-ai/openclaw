import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export type SessionRunCancelTarget = {
  kind: "session_run";
  sessionKey: string;
  runId: string;
};

export type SessionRunCancelStatus = "cancelled" | "no-active-run" | "already-terminal";

export type SessionRunCancelHandlerResult = {
  status: SessionRunCancelStatus;
  reason?: string;
};

export type SessionRunCancelHandler = (
  target: SessionRunCancelTarget,
) => SessionRunCancelHandlerResult | Promise<SessionRunCancelHandlerResult>;

type RegistryState = {
  handlers: Map<string, Set<SessionRunCancelHandler>>;
};

const SESSION_RUN_CANCEL_REGISTRY_KEY: unique symbol = Symbol.for(
  "openclaw.sessionRunCancelRegistry",
) as unknown as typeof SESSION_RUN_CANCEL_REGISTRY_KEY;

function getRegistryState(): RegistryState {
  return resolveGlobalSingleton<RegistryState>(SESSION_RUN_CANCEL_REGISTRY_KEY, () => ({
    handlers: new Map(),
  }));
}

function targetKey(target: Pick<SessionRunCancelTarget, "sessionKey" | "runId">): string {
  return `${target.sessionKey}\0${target.runId}`;
}

export function registerSessionRunCancelHandler(
  target: SessionRunCancelTarget,
  handler: SessionRunCancelHandler,
): () => void {
  const state = getRegistryState();
  const key = targetKey(target);
  let set = state.handlers.get(key);
  if (!set) {
    set = new Set();
    state.handlers.set(key, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) {
      state.handlers.delete(key);
    }
  };
}

export async function fanOutSessionRunCancel(
  target: SessionRunCancelTarget,
): Promise<{ notified: number; results: SessionRunCancelHandlerResult[] }> {
  const state = getRegistryState();
  const key = targetKey(target);
  const set = state.handlers.get(key);
  if (!set || set.size === 0) {
    return { notified: 0, results: [] };
  }
  state.handlers.delete(key);
  const results: SessionRunCancelHandlerResult[] = [];
  for (const handler of set) {
    try {
      results.push(await handler(target));
    } catch (error) {
      results.push({
        status: "no-active-run",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    notified: results.length,
    results,
  };
}

export function hasSessionRunCancelHandler(target: SessionRunCancelTarget): boolean {
  const state = getRegistryState();
  const set = state.handlers.get(targetKey(target));
  return Boolean(set && set.size > 0);
}

export function clearSessionRunCancelHandlers(target?: SessionRunCancelTarget): void {
  const state = getRegistryState();
  if (!target) {
    state.handlers.clear();
    return;
  }
  state.handlers.delete(targetKey(target));
}

export const __testing = {
  reset() {
    clearSessionRunCancelHandlers();
  },
};
