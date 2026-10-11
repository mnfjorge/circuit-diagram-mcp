"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface JsonSourceProps {
  json: string;
}

/** The diagram's JSON payload in a code box, with a button that copies it to the clipboard. */
export function JsonSource({ json }: JsonSourceProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json);
      setStatus("copied");
    } catch {
      // Clipboard access can be denied (insecure context, permissions policy).
      setStatus("failed");
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
  }, [json]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">JSON source</h2>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {status === "copied" ? "Copied!" : status === "failed" ? "Copy failed" : "Copy"}
        </button>
        <span className="sr-only" role="status">
          {status === "copied" ? "JSON copied to clipboard" : status === "failed" ? "Could not copy JSON" : ""}
        </span>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <code className="font-mono">{json}</code>
      </pre>
    </div>
  );
}
