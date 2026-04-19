import { html, nothing, type TemplateResult } from "lit";
import { formatDurationHuman, formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type {
  A2AAlertEntry,
  A2ACaseFilterState,
  A2ADashboardResult,
  A2APartyRef,
  A2AQueuePressure,
  A2ARecentOutcomeEntry,
  A2ATaskListEntry,
  A2ATaskListResult,
  A2AWorkerHealthEntry,
} from "../types.ts";

export type A2AProps = {
  loading: boolean;
  dashboard: A2ADashboardResult | null;
  dashboardError: string | null;
  casesResult: A2ATaskListResult | null;
  casesError: string | null;
  view: "overview" | "cases";
  filters: A2ACaseFilterState;
  sortColumn: "updatedAt" | "createdAt" | "status" | "intent" | "targetNodeId";
  sortDir: "asc" | "desc";
  selectedCaseId: string | null;
  onRefresh: () => void;
  onViewChange: (next: "overview" | "cases") => void;
  onFiltersChange: (next: A2ACaseFilterState) => void;
  onSortChange: (column: A2AProps["sortColumn"], dir: A2AProps["sortDir"]) => void;
  onSelectCase: (caseId: string | null) => void;
};

export function normalizeA2ATaskRows(result: A2ATaskListResult | null): A2ATaskListEntry[] {
  const items = result?.items ?? result?.tasks ?? [];
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

export function filterA2ATaskRows(
  rows: A2ATaskListEntry[],
  filters: A2ACaseFilterState,
): A2ATaskListEntry[] {
  const query = normalizeLowercaseStringOrEmpty(filters.query);
  const status = normalizeLowercaseStringOrEmpty(filters.status);
  const intent = normalizeLowercaseStringOrEmpty(filters.intent);
  const targetNodeId = normalizeLowercaseStringOrEmpty(filters.targetNodeId);
  const claimedBy = normalizeLowercaseStringOrEmpty(filters.claimedBy);
  return rows.filter((row) => {
    const rowStatus = normalizeLowercaseStringOrEmpty(resolveTaskStatus(row));
    const rowIntent = normalizeLowercaseStringOrEmpty(row.intent);
    const rowTargetNode = normalizeLowercaseStringOrEmpty(resolveTargetNodeId(row));
    const rowClaimedBy = normalizeLowercaseStringOrEmpty(resolveClaimedBy(row));
    const haystack = [
      row.taskId,
      row.correlationId,
      row.summary,
      row.resultSummary,
      row.errorCode,
      row.errorMessage,
      row.requester?.displayKey,
      row.requester?.sessionKey,
      row.target?.displayKey,
      row.target?.sessionKey,
      row.intent,
      row.targetNodeId,
      row.claimedBy,
    ]
      .map((value) => normalizeLowercaseStringOrEmpty(value))
      .join(" ");
    return (
      (!query || haystack.includes(query)) &&
      (!status || rowStatus === status) &&
      (!intent || rowIntent.includes(intent)) &&
      (!targetNodeId || rowTargetNode.includes(targetNodeId)) &&
      (!claimedBy || rowClaimedBy.includes(claimedBy))
    );
  });
}

export function sortA2ATaskRows(
  rows: A2ATaskListEntry[],
  column: A2AProps["sortColumn"],
  dir: A2AProps["sortDir"],
): A2ATaskListEntry[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].toSorted((a, b) => {
    let diff = 0;
    switch (column) {
      case "createdAt":
        diff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
        break;
      case "status":
        diff = resolveTaskStatus(a).localeCompare(resolveTaskStatus(b));
        break;
      case "intent":
        diff = (a.intent ?? "").localeCompare(b.intent ?? "");
        break;
      case "targetNodeId":
        diff = resolveTargetNodeId(a).localeCompare(resolveTargetNodeId(b));
        break;
      case "updatedAt":
      default:
        diff = (resolveUpdatedAt(a) ?? 0) - (resolveUpdatedAt(b) ?? 0);
        break;
    }
    if (diff !== 0) {
      return diff * factor;
    }
    return a.taskId.localeCompare(b.taskId) * factor;
  });
}

export function renderA2A(props: A2AProps) {
  const allRows = normalizeA2ATaskRows(props.casesResult);
  const filteredRows = filterA2ATaskRows(allRows, props.filters);
  const sortedRows = sortA2ATaskRows(filteredRows, props.sortColumn, props.sortDir);
  const selected =
    allRows.find((row) => row.taskId === props.selectedCaseId) ?? sortedRows[0] ?? null;
  const queuePressure = deriveQueuePressure(props.dashboard, allRows);
  const workerHealth = props.dashboard?.workerHealth?.entries ?? [];
  const outcomes = props.dashboard?.recentOutcomes?.items ?? deriveRecentOutcomes(allRows);
  const alerts = props.dashboard?.alerts ?? deriveAlerts(props.dashboard, allRows, workerHealth);
  const summaryCards = buildSummaryCards(props.dashboard, allRows, workerHealth);

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px; align-items: center;">
        <div>
          <div class="card-title">A2A operator</div>
          <div class="card-sub">
            Broker health, queue pressure, and case triage for agent-to-agent work.
          </div>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <button
            class="btn btn--sm ${props.view === "overview" ? "active" : ""}"
            @click=${() => props.onViewChange("overview")}
          >
            Overview
          </button>
          <button
            class="btn btn--sm ${props.view === "cases" ? "active" : ""}"
            @click=${() => props.onViewChange("cases")}
          >
            Cases
          </button>
          <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      ${props.dashboardError || props.casesError
        ? html`<div class="callout danger" style="margin-top: 12px;">
            ${[props.dashboardError, props.casesError].filter(Boolean).join(" ")}
          </div>`
        : nothing}
      ${props.view === "overview"
        ? renderOverviewSurface(summaryCards, queuePressure, workerHealth, outcomes, alerts)
        : renderCasesSurface({ props, allRows, sortedRows, selected })}
    </section>
  `;
}

function renderOverviewSurface(
  summaryCards: Array<{ label: string; value: string; tone?: string }>,
  queuePressure: A2AQueuePressure,
  workerHealth: A2AWorkerHealthEntry[],
  outcomes: A2ARecentOutcomeEntry[],
  alerts: A2AAlertEntry[],
) {
  return html`
    <div class="grid" style="margin-top: 16px; gap: 16px;">
      <div class="card" style="padding: 16px;">
        <div class="card-title">Summary</div>
        <div class="card-sub">Top-line signals for operator scan workflows.</div>
        <div
          style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:14px;"
        >
          ${summaryCards.map(
            (card) => html`<div class="callout ${card.tone ?? ""}" style="margin:0;">
              <div class="muted" style="font-size: 12px;">${card.label}</div>
              <div style="font-size: 22px; font-weight: 700; margin-top: 4px;">${card.value}</div>
            </div>`,
          )}
        </div>
      </div>
      <div class="card" style="padding: 16px;">
        <div class="card-title">Queue pressure</div>
        <div class="card-sub">Backlog, waiting states, and oldest work item age.</div>
        <div
          style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:14px;"
        >
          ${renderMetric("Queued", queuePressure.queued)}
          ${renderMetric("Running", queuePressure.running)}
          ${renderMetric("Waiting reply", queuePressure.waitingReply)}
          ${renderMetric("Waiting external", queuePressure.waitingExternal)}
          ${renderMetric("Stale", queuePressure.stale)}
          ${renderMetric("Oldest age", formatAge(queuePressure.oldestAgeMs))}
        </div>
      </div>
      <div class="card" style="padding: 16px;">
        <div class="card-title">Worker health</div>
        <div class="card-sub">Heartbeat freshness and per-worker queue load.</div>
        <div style="margin-top: 14px; display:grid; gap:10px;">
          ${workerHealth.length > 0
            ? workerHealth.slice(0, 8).map(
                (entry) => html`<div class="row" style="justify-content: space-between; gap: 12px;">
                  <div>
                    <div style="font-weight: 600;">${entry.label ?? entry.workerId}</div>
                    <div class="muted" style="font-size:12px;">
                      ${entry.targetNodeId ?? "unassigned node"} · heartbeat
                      ${formatRelativeTimestamp(entry.lastHeartbeatAt ?? null)}
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <span class="pill ${entry.status === "healthy" ? "success" : "warn"}"
                      >${entry.status ?? "unknown"}</span
                    >
                    <div class="muted" style="font-size:12px; margin-top:4px;">
                      queue ${entry.queueDepth ?? 0}, active ${entry.activeTasks ?? 0}
                    </div>
                  </div>
                </div>`,
              )
            : html`<div class="muted">No worker health entries reported yet.</div>`}
        </div>
      </div>
      <div class="card" style="padding: 16px;">
        <div class="card-title">Recent outcomes</div>
        <div class="card-sub">Latest completed, failed, cancelled, and timed out tasks.</div>
        <div style="margin-top:14px; display:grid; gap:10px;">
          ${outcomes.length > 0
            ? outcomes.slice(0, 8).map(
                (entry) => html`<div class="row" style="justify-content: space-between; gap:12px;">
                  <div>
                    <div style="font-weight: 600;">${entry.summary ?? entry.taskId}</div>
                    <div class="muted" style="font-size:12px;">
                      ${entry.target?.displayKey ?? entry.target?.sessionKey ?? "unknown target"}
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <span class="pill ${toneForStatus(entry.status)}">${entry.status}</span>
                    <div class="muted" style="font-size:12px; margin-top:4px;">
                      ${formatRelativeTimestamp(entry.at ?? null)}
                    </div>
                  </div>
                </div>`,
              )
            : html`<div class="muted">No recent outcomes yet.</div>`}
        </div>
      </div>
      <div class="card" style="padding: 16px; grid-column: 1 / -1;">
        <div class="card-title">Alerts</div>
        <div class="card-sub">
          Failures, stale work, and worker degradation that need attention.
        </div>
        <div style="margin-top: 14px; display:grid; gap:10px;">
          ${alerts.length > 0
            ? alerts.map(
                (alert) => html`<div class="callout ${toneForAlert(alert)}" style="margin:0;">
                  <div style="font-weight: 600;">${alert.title}</div>
                  ${alert.description
                    ? html`<div style="margin-top:4px;">${alert.description}</div>`
                    : nothing}
                  ${alert.taskId
                    ? html`<div class="mono muted" style="margin-top:6px; font-size:12px;">
                        ${alert.taskId}
                      </div>`
                    : nothing}
                </div>`,
              )
            : html`<div class="muted">No active alerts.</div>`}
        </div>
      </div>
    </div>
  `;
}

function renderCasesSurface(params: {
  props: A2AProps;
  allRows: A2ATaskListEntry[];
  sortedRows: A2ATaskListEntry[];
  selected: A2ATaskListEntry | null;
}) {
  const { props, allRows, sortedRows, selected } = params;
  return html`
    <div
      class="grid"
      style="margin-top: 16px; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);"
    >
      <div class="card" style="padding: 16px; min-width: 0;">
        <div class="row" style="justify-content: space-between; gap: 12px; align-items: end;">
          <div>
            <div class="card-title">Cases</div>
            <div class="card-sub">Shared filters, sorting, and read-only quick actions.</div>
          </div>
          <div class="muted" style="font-size:12px;">
            ${sortedRows.length} of ${allRows.length} shown
          </div>
        </div>
        <div
          style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-top:14px;"
        >
          ${renderFilterField("Search", props.filters.query, (value) =>
            props.onFiltersChange({ ...props.filters, query: value }),
          )}
          ${renderFilterField("Status", props.filters.status, (value) =>
            props.onFiltersChange({ ...props.filters, status: value }),
          )}
          ${renderFilterField("Intent", props.filters.intent, (value) =>
            props.onFiltersChange({ ...props.filters, intent: value }),
          )}
          ${renderFilterField("Target node", props.filters.targetNodeId, (value) =>
            props.onFiltersChange({ ...props.filters, targetNodeId: value }),
          )}
          ${renderFilterField("Claimed by", props.filters.claimedBy, (value) =>
            props.onFiltersChange({ ...props.filters, claimedBy: value }),
          )}
        </div>
        <div class="data-table-wrapper" style="margin-top: 16px;">
          <div class="data-table-container">
            <table class="data-table">
              <thead>
                <tr>
                  ${sortHeader(props, "updatedAt", "Updated")}
                  ${sortHeader(props, "createdAt", "Created")}
                  ${sortHeader(props, "status", "Status")} ${sortHeader(props, "intent", "Intent")}
                  ${sortHeader(props, "targetNodeId", "Target")}
                  <th>Summary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${sortedRows.length > 0
                  ? sortedRows.map((row) => renderCaseRow(props, row))
                  : html`<tr>
                      <td colspan="7" class="muted" style="padding: 20px; text-align:center;">
                        No cases matched the current filters.
                      </td>
                    </tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card" style="padding: 16px;">
        <div class="card-title">Case inspector entry</div>
        <div class="card-sub">
          Drill-in path wired now, full inspector follows in a later issue.
        </div>
        ${selected
          ? html`
              <div style="margin-top:14px; display:grid; gap:10px;">
                <div>
                  <div style="font-weight:700;">${selected.summary ?? selected.taskId}</div>
                  <div class="mono muted" style="font-size:12px;">${selected.taskId}</div>
                </div>
                <div class="row" style="gap: 8px; flex-wrap: wrap;">
                  <span class="pill ${toneForStatus(resolveTaskStatus(selected))}"
                    >${resolveTaskStatus(selected)}</span
                  >
                  <span class="pill">${selected.intent ?? "unknown intent"}</span>
                </div>
                <div class="muted" style="font-size:12px;">
                  ${describeParty("Requester", selected.requester)}<br />
                  ${describeParty("Target", selected.target)}
                </div>
                <div class="callout" style="margin:0;">
                  This hook preserves the selected case id in the URL and gives operators a stable
                  entry point for the forthcoming full inspector.
                </div>
                ${selected.errorMessage
                  ? html`<div class="callout danger" style="margin:0;">
                      ${selected.errorMessage}
                    </div>`
                  : nothing}
                ${renderRawPayload(selected)}
              </div>
            `
          : html`<div class="muted" style="margin-top:14px;">
              Select a case to preview its drill-in path.
            </div>`}
      </div>
    </div>
  `;
}

function renderMetric(label: string, value: string | number | null | undefined) {
  return html`<div class="callout" style="margin:0;">
    <div class="muted" style="font-size:12px;">${label}</div>
    <div style="font-size:20px; font-weight:700; margin-top:4px;">${value ?? "0"}</div>
  </div>`;
}

function renderFilterField(label: string, value: string, onInput: (value: string) => void) {
  return html`<label class="field">
    <span>${label}</span>
    <input
      .value=${value}
      @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
    />
  </label>`;
}

function sortHeader(props: A2AProps, column: A2AProps["sortColumn"], label: string) {
  const active = props.sortColumn === column;
  const nextDir = active && props.sortDir === "asc" ? "desc" : "asc";
  return html`<th
    data-sortable
    data-sort-dir=${active ? props.sortDir : ""}
    @click=${() => props.onSortChange(column, active ? nextDir : "desc")}
  >
    ${label}
    <span class="data-table-sort-icon">${icons.arrowUpDown}</span>
  </th>`;
}

function renderCaseRow(props: A2AProps, row: A2ATaskListEntry) {
  const updatedAt = resolveUpdatedAt(row);
  return html`<tr
    class=${props.selectedCaseId === row.taskId ? "selected" : ""}
    @click=${() => props.onSelectCase(row.taskId)}
    style="cursor:pointer;"
  >
    <td>${formatRelativeTimestamp(updatedAt ?? null)}</td>
    <td>${formatRelativeTimestamp(row.createdAt ?? null)}</td>
    <td>
      <span class="pill ${toneForStatus(resolveTaskStatus(row))}">${resolveTaskStatus(row)}</span>
    </td>
    <td>${row.intent ?? "-"}</td>
    <td>
      <div>
        ${resolveTargetNodeId(row) || row.target?.displayKey || row.target?.sessionKey || "-"}
      </div>
      <div class="muted" style="font-size:12px;">${resolveClaimedBy(row) || "unclaimed"}</div>
    </td>
    <td>
      <div style="font-weight:600;">${row.summary ?? row.resultSummary ?? row.taskId}</div>
      <div class="muted" style="font-size:12px;">${row.errorCode ?? row.correlationId ?? ""}</div>
    </td>
    <td>
      <div class="row" style="gap:6px;">
        <button
          class="btn btn--sm"
          title="Copy task id"
          @click=${(event: Event) => {
            event.stopPropagation();
            void copyText(row.taskId);
          }}
        >
          ${icons.copy}
        </button>
        <button
          class="btn btn--sm"
          title="Open case preview"
          @click=${(event: Event) => {
            event.stopPropagation();
            props.onSelectCase(row.taskId);
          }}
        >
          Open
        </button>
      </div>
    </td>
  </tr>`;
}

function renderRawPayload(row: A2ATaskListEntry): TemplateResult {
  const payload = JSON.stringify(row.raw ?? row, null, 2);
  return html`
    <details>
      <summary class="btn btn--sm">Raw drilldown</summary>
      <div class="callout" style="margin-top:10px;">
        <pre style="margin:0; white-space:pre-wrap; word-break:break-word;">${payload}</pre>
      </div>
    </details>
  `;
}

function buildSummaryCards(
  dashboard: A2ADashboardResult | null,
  rows: A2ATaskListEntry[],
  workers: A2AWorkerHealthEntry[],
) {
  const statuses = rows.map((row) => resolveTaskStatus(row));
  const total = dashboard?.summary?.total ?? rows.length;
  const running =
    dashboard?.summary?.running ?? statuses.filter((status) => status === "running").length;
  const waiting =
    dashboard?.summary?.waiting ??
    statuses.filter((status) => status === "waiting_reply" || status === "waiting_external").length;
  const failed =
    dashboard?.summary?.failed ??
    statuses.filter((status) => status === "failed" || status === "timed_out").length;
  const stale = dashboard?.summary?.stale ?? deriveStaleCount(rows, workers);
  const unhealthy =
    dashboard?.summary?.workersUnhealthy ??
    workers.filter((entry) => entry.status && entry.status !== "healthy").length;
  return [
    { label: "Total cases", value: String(total) },
    { label: "Running", value: String(running), tone: running > 0 ? "info" : "" },
    { label: "Waiting", value: String(waiting), tone: waiting > 0 ? "warning" : "" },
    { label: "Failed", value: String(failed), tone: failed > 0 ? "danger" : "" },
    { label: "Stale", value: String(stale), tone: stale > 0 ? "warning" : "" },
    { label: "Unhealthy workers", value: String(unhealthy), tone: unhealthy > 0 ? "danger" : "" },
  ];
}

function deriveQueuePressure(
  dashboard: A2ADashboardResult | null,
  rows: A2ATaskListEntry[],
): A2AQueuePressure {
  if (dashboard?.queuePressure) {
    return dashboard.queuePressure;
  }
  const statuses = rows.map((row) => resolveTaskStatus(row));
  const openRows = rows.filter((row) => !isTerminalStatus(resolveTaskStatus(row)));
  const oldest = openRows.reduce<number | null>((acc, row) => {
    const createdAt = row.createdAt ?? null;
    if (createdAt == null) {
      return acc;
    }
    return acc == null ? createdAt : Math.min(acc, createdAt);
  }, null);
  return {
    queued: openRows.length,
    running: statuses.filter((status) => status === "running").length,
    waitingReply: statuses.filter((status) => status === "waiting_reply").length,
    waitingExternal: statuses.filter((status) => status === "waiting_external").length,
    stale: deriveStaleCount(rows, []),
    oldestAgeMs: oldest == null ? null : Date.now() - oldest,
  };
}

function deriveRecentOutcomes(rows: A2ATaskListEntry[]): A2ARecentOutcomeEntry[] {
  return rows
    .filter((row) => isTerminalStatus(resolveTaskStatus(row)))
    .toSorted((a, b) => (resolveUpdatedAt(b) ?? 0) - (resolveUpdatedAt(a) ?? 0))
    .slice(0, 8)
    .map((row) => ({
      taskId: row.taskId,
      status: resolveTaskStatus(row),
      summary: row.summary ?? row.resultSummary ?? row.errorMessage ?? row.taskId,
      at: resolveUpdatedAt(row),
      target: row.target ?? null,
    }));
}

function deriveAlerts(
  dashboard: A2ADashboardResult | null,
  rows: A2ATaskListEntry[],
  workers: A2AWorkerHealthEntry[],
): A2AAlertEntry[] {
  if (dashboard?.alerts && dashboard.alerts.length > 0) {
    return dashboard.alerts;
  }
  const alerts: A2AAlertEntry[] = [];
  for (const row of rows) {
    const status = resolveTaskStatus(row);
    if (status === "failed" || status === "timed_out") {
      alerts.push({
        severity: "error",
        title: `${status} case`,
        description: row.errorMessage ?? row.summary ?? row.taskId,
        taskId: row.taskId,
      });
    }
  }
  const staleRows = rows.filter((row) => isStaleRow(row));
  if (staleRows.length > 0) {
    alerts.push({
      severity: "warning",
      title: "Stale active work",
      description: `${staleRows.length} active cases have not updated recently.`,
    });
  }
  const unhealthyWorkers = workers.filter((entry) => entry.status && entry.status !== "healthy");
  if (unhealthyWorkers.length > 0) {
    alerts.push({
      severity: "warning",
      title: "Worker degradation",
      description: `${unhealthyWorkers.length} workers are stale or offline.`,
    });
  }
  return alerts.slice(0, 6);
}

function deriveStaleCount(rows: A2ATaskListEntry[], workers: A2AWorkerHealthEntry[]): number {
  return (
    rows.filter((row) => isStaleRow(row)).length +
    workers.filter((entry) => entry.status === "stale" || entry.status === "offline").length
  );
}

function isStaleRow(row: A2ATaskListEntry): boolean {
  const status = resolveTaskStatus(row);
  if (isTerminalStatus(status)) {
    return false;
  }
  const updatedAt = resolveUpdatedAt(row);
  if (!updatedAt) {
    return false;
  }
  return Date.now() - updatedAt > 15 * 60 * 1000;
}

function resolveTaskStatus(row: A2ATaskListEntry): string {
  return row.executionStatus ?? row.status ?? "accepted";
}

function resolveUpdatedAt(row: A2ATaskListEntry): number | null {
  return (
    row.updatedAt ??
    row.heartbeatAt ??
    row.completedAt ??
    row.startedAt ??
    row.acceptedAt ??
    row.createdAt ??
    null
  );
}

function resolveTargetNodeId(row: A2ATaskListEntry): string {
  return row.targetNodeId ?? row.target?.displayKey ?? row.target?.sessionKey ?? "";
}

function resolveClaimedBy(row: A2ATaskListEntry): string {
  return row.claimedBy ?? "";
}

function describeParty(label: string, party?: A2APartyRef | null) {
  return `${label}: ${party?.displayKey ?? party?.sessionKey ?? "unknown"}`;
}

function formatAge(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? formatDurationHuman(value) : "n/a";
}

function toneForStatus(status: string): string {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "timed_out") {
    return "danger";
  }
  if (status === "waiting_reply" || status === "waiting_external") {
    return "warn";
  }
  return "";
}

function toneForAlert(alert: A2AAlertEntry): string {
  if (alert.severity === "error") {
    return "danger";
  }
  if (alert.severity === "warning") {
    return "warning";
  }
  return "";
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "timed_out"
  );
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
  }
}
