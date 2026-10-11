"use client";

import { Fragment, useCallback, useMemo, useState, useSyncExternalStore } from "react";

export interface ConnectionRow {
  key: string;
  /** Shared by both reciprocal rows for the same physical connection. */
  connectionId: string;
  component: string;
  pin: string;
  otherComponent: string;
  otherPin: string;
}

export interface ConnectionsTableProps {
  diagramId: string;
  rows: ConnectionRow[];
}

interface ComponentGroup {
  component: string;
  rows: ConnectionRow[];
}

function storageKey(diagramId: string): string {
  return `connections-completed:${diagramId}`;
}

// Reads/writes go through useSyncExternalStore so the checked state stays in sync with
// localStorage (including "storage" events fired by our own writes) without ever calling
// setState from inside an effect, and so the server-rendered "all unchecked" snapshot matches
// the client's first paint before hydration picks up the real, persisted value.
const storeListeners = new Set<() => void>();

function subscribeToStorage(onChange: () => void): () => void {
  storeListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    storeListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCompletedRaw(diagramId: string): string {
  try {
    return window.localStorage.getItem(storageKey(diagramId)) ?? "{}";
  } catch {
    return "{}";
  }
}

function getServerSnapshot(): string {
  return "{}";
}

function writeCompleted(diagramId: string, next: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(storageKey(diagramId), JSON.stringify(next));
  } catch {
    // Ignore storage write failures (e.g. private browsing quota).
  }
  storeListeners.forEach((listener) => listener());
}

function groupByComponent(rows: ConnectionRow[]): ComponentGroup[] {
  const groups: ComponentGroup[] = [];
  const indexByComponent = new Map<string, number>();
  for (const row of rows) {
    let index = indexByComponent.get(row.component);
    if (index === undefined) {
      index = groups.length;
      indexByComponent.set(row.component, index);
      groups.push({ component: row.component, rows: [] });
    }
    groups[index].rows.push(row);
  }
  return groups;
}

export function ConnectionsTable({ diagramId, rows }: ConnectionsTableProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const completedRaw = useSyncExternalStore(
    subscribeToStorage,
    useCallback(() => readCompletedRaw(diagramId), [diagramId]),
    getServerSnapshot,
  );
  const completed = useMemo<Record<string, boolean>>(() => {
    try {
      return JSON.parse(completedRaw);
    } catch {
      return {};
    }
  }, [completedRaw]);

  const toggleRow = useCallback(
    (connectionId: string) => {
      writeCompleted(diagramId, { ...completed, [connectionId]: !completed[connectionId] });
    },
    [diagramId, completed],
  );

  const uncheckAll = useCallback(() => {
    writeCompleted(diagramId, {});
  }, [diagramId]);

  const toggleGroup = useCallback((component: string) => {
    setCollapsed((prev) => ({ ...prev, [component]: !prev[component] }));
  }, []);

  const groups = useMemo(() => groupByComponent(rows), [rows]);
  const connectionIds = useMemo(() => [...new Set(rows.map((row) => row.connectionId))], [rows]);
  const completedCount = connectionIds.filter((id) => completed[id]).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-zinc-500">
          {completedCount} of {connectionIds.length} connections completed.
        </p>
        <button
          type="button"
          onClick={uncheckAll}
          disabled={completedCount === 0}
          className="shrink-0 text-sm text-zinc-500 underline hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline dark:hover:text-zinc-300"
        >
          Uncheck all
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 print:overflow-visible print:rounded-none">
        <table className="w-full text-left text-sm print:text-xs">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="w-10 px-4 py-2 font-medium" />
              <th className="px-4 py-2 font-medium print:py-1">Component</th>
              <th className="px-4 py-2 font-medium print:py-1">Pin</th>
              <th className="px-4 py-2 font-medium print:py-1">Connected to</th>
              <th className="px-4 py-2 font-medium print:py-1">Pin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-2 text-zinc-500" colSpan={5}>
                  No connections.
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const isCollapsed = collapsed[group.component] ?? false;
                const groupCompletedCount = group.rows.filter((row) => completed[row.connectionId]).length;
                return (
                  <Fragment key={group.component}>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                      <td colSpan={5} className="px-2 py-1.5 print:py-0.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.component)}
                          className="flex w-full items-center gap-2 text-left font-medium text-zinc-700 dark:text-zinc-300"
                          aria-expanded={!isCollapsed}
                        >
                          <span
                            className={`inline-block transition-transform print:hidden ${isCollapsed ? "-rotate-90" : ""}`}
                            aria-hidden
                          >
                            ▾
                          </span>
                          <span>{group.component}</span>
                          <span className="font-normal text-zinc-500">
                            ({groupCompletedCount}/{group.rows.length})
                          </span>
                        </button>
                      </td>
                    </tr>
                    {group.rows.map((row) => {
                      const isCompleted = completed[row.connectionId] ?? false;
                      return (
                        <tr
                          key={row.key}
                          // Collapsing is a screen-only convenience; a printout lists every row.
                          className={`border-b border-zinc-200 last:border-0 dark:border-zinc-800 ${
                            isCollapsed ? "hidden print:table-row" : ""
                          } ${isCompleted ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}
                        >
                          <td className="px-4 py-2 print:py-0.5">
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={() => toggleRow(row.connectionId)}
                              aria-label={`Mark ${row.component} ${row.pin} to ${row.otherComponent} ${row.otherPin} as completed`}
                              className="size-4 accent-emerald-600"
                            />
                          </td>
                          <td
                            className={`px-4 py-2 print:py-0.5 ${isCompleted ? "text-zinc-400 line-through dark:text-zinc-500" : ""}`}
                          >
                            {row.component}
                          </td>
                          <td
                            className={`px-4 py-2 print:py-0.5 font-mono ${isCompleted ? "text-zinc-400 line-through dark:text-zinc-500" : ""}`}
                          >
                            {row.pin}
                          </td>
                          <td
                            className={`px-4 py-2 print:py-0.5 ${isCompleted ? "text-zinc-400 line-through dark:text-zinc-500" : ""}`}
                          >
                            {row.otherComponent}
                          </td>
                          <td
                            className={`px-4 py-2 print:py-0.5 font-mono ${isCompleted ? "text-zinc-400 line-through dark:text-zinc-500" : ""}`}
                          >
                            {row.otherPin}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
