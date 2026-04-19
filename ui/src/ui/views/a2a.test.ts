/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { A2ATaskListEntry } from "../types.ts";
import { filterA2ATaskRows, renderA2A, sortA2ATaskRows, type A2AProps } from "./a2a.ts";

function buildRow(overrides: Partial<A2ATaskListEntry> = {}): A2ATaskListEntry {
  return {
    taskId: overrides.taskId ?? "task-1",
    summary: overrides.summary ?? "Delegate weekly review",
    intent: overrides.intent ?? "delegate",
    status: overrides.status ?? "running",
    updatedAt: overrides.updatedAt ?? 20,
    createdAt: overrides.createdAt ?? 10,
    targetNodeId: overrides.targetNodeId ?? "node-a",
    claimedBy: overrides.claimedBy ?? "bangtong",
    target: overrides.target ?? { sessionKey: "agent:worker", displayKey: "worker" },
    requester: overrides.requester ?? { sessionKey: "agent:main", displayKey: "main" },
    ...overrides,
  };
}

function buildProps(rows: A2ATaskListEntry[]): A2AProps {
  return {
    loading: false,
    dashboard: null,
    dashboardError: null,
    casesResult: { items: rows },
    casesError: null,
    view: "cases",
    filters: { query: "", status: "", intent: "", targetNodeId: "", claimedBy: "" },
    sortColumn: "updatedAt",
    sortDir: "desc",
    selectedCaseId: null,
    onRefresh: () => undefined,
    onViewChange: () => undefined,
    onFiltersChange: () => undefined,
    onSortChange: () => undefined,
    onSelectCase: () => undefined,
  };
}

describe("a2a view", () => {
  it("filters rows across common operator fields", () => {
    const rows = [
      buildRow(),
      buildRow({ taskId: "task-2", status: "failed", targetNodeId: "node-b" }),
    ];

    expect(
      filterA2ATaskRows(rows, {
        query: "weekly",
        status: "",
        intent: "",
        targetNodeId: "",
        claimedBy: "",
      }),
    ).toHaveLength(2);
    expect(
      filterA2ATaskRows(rows, {
        query: "",
        status: "failed",
        intent: "",
        targetNodeId: "",
        claimedBy: "",
      }),
    ).toHaveLength(1);
    expect(
      filterA2ATaskRows(rows, {
        query: "",
        status: "",
        intent: "",
        targetNodeId: "node-b",
        claimedBy: "",
      })[0]?.taskId,
    ).toBe("task-2");
  });

  it("sorts rows by configured columns", () => {
    const rows = [
      buildRow({ taskId: "task-1", updatedAt: 10 }),
      buildRow({ taskId: "task-2", updatedAt: 20 }),
    ];

    expect(sortA2ATaskRows(rows, "updatedAt", "desc")[0]?.taskId).toBe("task-2");
    expect(sortA2ATaskRows(rows, "updatedAt", "asc")[0]?.taskId).toBe("task-1");
  });

  it("renders the cases table and inspector hook", async () => {
    const onSelectCase = vi.fn();
    const container = document.createElement("div");

    render(
      renderA2A({
        ...buildProps([
          buildRow({ taskId: "task-1" }),
          buildRow({ taskId: "task-2", status: "failed" }),
        ]),
        selectedCaseId: "task-2",
        onSelectCase,
      }),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("A2A operator");
    expect(container.textContent).toContain("Case inspector entry");
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    expect(container.textContent).toContain("task-2");
  });
});
