import { createSubsystemLogger } from "../../logging/subsystem.js";
import type {
  PluginTimerElapsedCallback,
  PluginTimerHandle,
  PluginWatchdogTimer,
} from "./types-core.js";

const log = createSubsystemLogger("plugin-timer");

type ActiveTimer = {
  id: string;
  owner: string | undefined;
  timeoutMs: number;
  handle: ReturnType<typeof setTimeout>;
  startedAt: number;
  onElapsed: PluginTimerElapsedCallback;
  settled: boolean;
};

function makeHandle(timer: ActiveTimer): PluginTimerHandle {
  return Object.freeze({
    id: timer.id,
    timeoutMs: timer.timeoutMs,
    get active() {
      return !timer.settled;
    },
  });
}

/**
 * Create a new plugin-facing watchdog timer seam.
 *
 * Each call produces an independent timer registry.  The typical lifecycle is:
 * 1. Plugin calls `scheduleTimeout` for each delegated task.
 * 2. On task completion, plugin calls `cancel(id)` or `cancelAll(owner)`.
 * 3. On process shutdown, `cancelAll()` (no owner) cleans up everything.
 */
export function createRuntimeTimer(): PluginWatchdogTimer {
  const timers = new Map<string, ActiveTimer>();

  function cancelInternal(id: string, reason: "cancel" | "elapsed"): boolean {
    const timer = timers.get(id);
    if (!timer || timer.settled) {
      return false;
    }
    timer.settled = true;
    clearTimeout(timer.handle);
    if (reason === "cancel") {
      log.debug("timer cancelled", { id, owner: timer.owner });
    }
    return true;
  }

  function elapsed(timer: ActiveTimer): void {
    if (timer.settled) {
      return;
    }
    timer.settled = true;
    timers.delete(timer.id);
    log.debug("timer elapsed", { id: timer.id, owner: timer.owner });
    try {
      const result = timer.onElapsed();
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          log.error("timer onElapsed rejected", {
            id: timer.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      log.error("timer onElapsed threw", {
        id: timer.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const api: PluginWatchdogTimer = {
    scheduleTimeout(opts) {
      const { id, timeoutMs, onElapsed, owner } = opts;

      if (!id || typeof id !== "string") {
        throw new Error("PluginWatchdogTimer.scheduleTimeout: id must be a non-empty string");
      }
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error(
          "PluginWatchdogTimer.scheduleTimeout: timeoutMs must be a non-negative finite number",
        );
      }
      if (typeof onElapsed !== "function") {
        throw new Error("PluginWatchdogTimer.scheduleTimeout: onElapsed must be a function");
      }

      // Re-schedule: cancel existing timer with the same id
      cancelInternal(id, "cancel");

      const setTimeoutMs = Math.max(0, Math.floor(timeoutMs));
      const handle = setTimeout(() => {
        const timer = timers.get(id);
        if (timer) {
          elapsed(timer);
        }
      }, setTimeoutMs);

      // Keep the timer handle from keeping the process alive
      if (handle && typeof handle === "object" && "unref" in handle) {
        handle.unref();
      }

      const timer: ActiveTimer = {
        id,
        owner,
        timeoutMs: setTimeoutMs,
        handle,
        startedAt: Date.now(),
        onElapsed,
        settled: false,
      };
      timers.set(id, timer);

      log.debug("timer scheduled", { id, owner, timeoutMs: setTimeoutMs });
      return makeHandle(timer);
    },

    cancel(id: string): void {
      cancelInternal(id, "cancel");
      timers.delete(id);
    },

    isActive(id: string): boolean {
      const timer = timers.get(id);
      return timer !== undefined && !timer.settled;
    },

    cancelAll(ownerOrNothing?: string): void {
      const targetOwner = ownerOrNothing;
      for (const [id, timer] of timers) {
        if (targetOwner === undefined || timer.owner === targetOwner) {
          cancelInternal(id, "cancel");
          timers.delete(id);
        }
      }
    },
  };

  return api;
}
