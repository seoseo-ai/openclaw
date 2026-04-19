/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import {
  createDefaultA2AFilters,
  hydrateA2AStateFromLocation,
  loadA2A,
  selectA2ACase,
  setA2AFilters,
  setA2ASort,
  setA2AView,
} from "./a2a.ts";

function createState() {
  return {
    client: {
      request: vi.fn(async (method: string) => {
        if (method === "a2a.dashboard") {
          return { summary: { total: 1 } };
        }
        return { items: [{ taskId: "task-1", updatedAt: 1 }] };
      }),
    },
    connected: true,
    hello: { features: { methods: ["a2a.dashboard", "a2a.task.list"] } },
    a2aView: "overview" as const,
    a2aDashboardLoading: false,
    a2aDashboard: null,
    a2aDashboardError: null,
    a2aCasesLoading: false,
    a2aCasesResult: null,
    a2aCasesError: null,
    a2aFilters: createDefaultA2AFilters(),
    a2aSortColumn: "updatedAt" as const,
    a2aSortDir: "desc" as const,
    a2aSelectedCaseId: null,
  };
}

describe("a2a controller", () => {
  it("hydrates and syncs view state with the URL", () => {
    window.history.replaceState(
      {},
      "",
      "/a2a?view=cases&case=task-2&a2a_q=broker&a2a_status=running&a2a_intent=delegate&a2a_target=node-1&a2a_worker=bangtong&a2a_sort=status&a2a_dir=asc",
    );
    const state = createState();

    hydrateA2AStateFromLocation(state as never);

    expect(state.a2aView).toBe("cases");
    expect(state.a2aSelectedCaseId).toBe("task-2");
    expect(state.a2aFilters.query).toBe("broker");
    expect(state.a2aSortColumn).toBe("status");
    expect(state.a2aSortDir).toBe("asc");

    setA2AView(state as never, "overview");
    setA2AFilters(state as never, { ...state.a2aFilters, status: "failed" });
    setA2ASort(state as never, "intent", "desc");
    selectA2ACase(state as never, "task-9");

    const url = new URL(window.location.href);
    expect(url.searchParams.get("view")).toBe("cases");
    expect(url.searchParams.get("case")).toBe("task-9");
    expect(url.searchParams.get("a2a_status")).toBe("failed");
    expect(url.searchParams.get("a2a_sort")).toBe("intent");
    expect(url.searchParams.get("a2a_dir")).toBe("desc");
  });

  it("loads dashboard and cases when the gateway advertises support", async () => {
    const state = createState();

    await loadA2A(state as never, { refresh: true });

    expect(state.client.request).toHaveBeenCalledWith("a2a.dashboard", { refresh: true });
    expect(state.client.request).toHaveBeenCalledWith("a2a.task.list", {
      refresh: true,
      limit: 200,
    });
    expect(state.a2aDashboard).toEqual({ summary: { total: 1 } });
    expect(state.a2aCasesResult).toEqual({ items: [{ taskId: "task-1", updatedAt: 1 }] });
    expect(state.a2aDashboardLoading).toBe(false);
    expect(state.a2aCasesLoading).toBe(false);
  });

  it("maps missing methods to friendly unavailable errors", async () => {
    const state = createState();
    state.hello = { features: { methods: [] } };
    state.client.request = vi.fn(async (_method: string) => {
      throw new GatewayRequestError({ message: "method not found", code: "method_not_found" });
    });

    await loadA2A(state as never);

    expect(state.a2aDashboardError).toContain("a2a.dashboard is not available");
    expect(state.a2aCasesError).toContain("a2a.task.list is not available");
  });
});
