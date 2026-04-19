import { GatewayRequestError } from "../gateway.ts";
import type { A2ACaseFilterState, A2ADashboardResult, A2ATaskListResult } from "../types.ts";

export type A2AState = {
  client: { request<T>(method: string, params: Record<string, unknown>): Promise<T> } | null;
  connected: boolean;
  hello?: { features?: { methods?: string[] } } | null;
  a2aView: "overview" | "cases";
  a2aDashboardLoading: boolean;
  a2aDashboard: A2ADashboardResult | null;
  a2aDashboardError: string | null;
  a2aCasesLoading: boolean;
  a2aCasesResult: A2ATaskListResult | null;
  a2aCasesError: string | null;
  a2aFilters: A2ACaseFilterState;
  a2aSortColumn: "updatedAt" | "createdAt" | "status" | "intent" | "targetNodeId";
  a2aSortDir: "asc" | "desc";
  a2aSelectedCaseId: string | null;
};

export function createDefaultA2AFilters(): A2ACaseFilterState {
  return {
    query: "",
    status: "",
    intent: "",
    targetNodeId: "",
    claimedBy: "",
  };
}

function supportsMethod(state: Pick<A2AState, "hello">, method: string): boolean {
  const methods = state.hello?.features?.methods;
  if (!Array.isArray(methods) || methods.length === 0) {
    return true;
  }
  return methods.includes(method);
}

function formatUnavailableMessage(method: string): string {
  return `${method} is not available on this gateway yet.`;
}

function normalizeView(value: string | null): "overview" | "cases" {
  return value === "cases" ? "cases" : "overview";
}

export function hydrateA2AStateFromLocation(state: A2AState) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  state.a2aView = normalizeView(url.searchParams.get("view"));
  state.a2aSelectedCaseId = url.searchParams.get("case")?.trim() || null;
  state.a2aFilters = {
    query: url.searchParams.get("a2a_q")?.trim() || "",
    status: url.searchParams.get("a2a_status")?.trim() || "",
    intent: url.searchParams.get("a2a_intent")?.trim() || "",
    targetNodeId: url.searchParams.get("a2a_target")?.trim() || "",
    claimedBy: url.searchParams.get("a2a_worker")?.trim() || "",
  };
  const sort = url.searchParams.get("a2a_sort")?.trim();
  if (
    sort === "updatedAt" ||
    sort === "createdAt" ||
    sort === "status" ||
    sort === "intent" ||
    sort === "targetNodeId"
  ) {
    state.a2aSortColumn = sort;
  }
  const dir = url.searchParams.get("a2a_dir")?.trim();
  if (dir === "asc" || dir === "desc") {
    state.a2aSortDir = dir;
  }
}

export function syncA2AStateToLocation(
  state: Pick<
    A2AState,
    "a2aView" | "a2aSelectedCaseId" | "a2aFilters" | "a2aSortColumn" | "a2aSortDir"
  >,
) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("view", state.a2aView);
  if (state.a2aSelectedCaseId) {
    url.searchParams.set("case", state.a2aSelectedCaseId);
  } else {
    url.searchParams.delete("case");
  }
  const params: Array<[string, string]> = [
    ["a2a_q", state.a2aFilters.query],
    ["a2a_status", state.a2aFilters.status],
    ["a2a_intent", state.a2aFilters.intent],
    ["a2a_target", state.a2aFilters.targetNodeId],
    ["a2a_worker", state.a2aFilters.claimedBy],
  ];
  for (const [key, value] of params) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.set("a2a_sort", state.a2aSortColumn);
  url.searchParams.set("a2a_dir", state.a2aSortDir);
  window.history.replaceState({}, "", url.toString());
}

export function setA2AView(state: A2AState, next: "overview" | "cases") {
  state.a2aView = next;
  syncA2AStateToLocation(state);
}

export function setA2AFilters(state: A2AState, next: A2ACaseFilterState) {
  state.a2aFilters = next;
  syncA2AStateToLocation(state);
}

export function setA2ASort(
  state: A2AState,
  column: A2AState["a2aSortColumn"],
  dir: A2AState["a2aSortDir"],
) {
  state.a2aSortColumn = column;
  state.a2aSortDir = dir;
  syncA2AStateToLocation(state);
}

export function selectA2ACase(state: A2AState, caseId: string | null) {
  state.a2aSelectedCaseId = caseId;
  if (caseId) {
    state.a2aView = "cases";
  }
  syncA2AStateToLocation(state);
}

export async function loadA2A(state: A2AState, opts?: { refresh?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }

  if (!supportsMethod(state, "a2a.dashboard")) {
    state.a2aDashboard = null;
    state.a2aDashboardError = formatUnavailableMessage("a2a.dashboard");
  } else {
    state.a2aDashboardLoading = true;
    state.a2aDashboardError = null;
    try {
      state.a2aDashboard = await state.client.request<A2ADashboardResult>("a2a.dashboard", {
        refresh: opts?.refresh === true,
      });
    } catch (error) {
      state.a2aDashboard = null;
      state.a2aDashboardError = formatA2AError(error, "a2a.dashboard");
    } finally {
      state.a2aDashboardLoading = false;
    }
  }

  if (!supportsMethod(state, "a2a.task.list")) {
    state.a2aCasesResult = null;
    state.a2aCasesError = formatUnavailableMessage("a2a.task.list");
    return;
  }

  state.a2aCasesLoading = true;
  state.a2aCasesError = null;
  try {
    state.a2aCasesResult = await state.client.request<A2ATaskListResult>("a2a.task.list", {
      refresh: opts?.refresh === true,
      limit: 200,
    });
  } catch (error) {
    state.a2aCasesResult = null;
    state.a2aCasesError = formatA2AError(error, "a2a.task.list");
  } finally {
    state.a2aCasesLoading = false;
  }
}

function formatA2AError(error: unknown, method: string): string {
  if (error instanceof GatewayRequestError) {
    const message = error.message || String(error);
    if (
      error.gatewayCode === "method_not_found" ||
      message.includes("method not found") ||
      message.includes("unknown method")
    ) {
      return formatUnavailableMessage(method);
    }
    return message;
  }
  return String(error);
}
