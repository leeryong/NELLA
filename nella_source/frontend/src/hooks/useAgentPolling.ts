/**
 * useAgentPolling — auto-polls data more aggressively while the agent is active.
 *
 * Usage:
 *   useAgentPolling(loadFn, { idle: 15000, active: 2000 });
 *
 * Events (dispatched by AgentChat):
 *   "agent-active"   — CustomEvent<{active: boolean}>
 *   "agent-navigate" — CustomEvent (triggers immediate refresh)
 *
 * Set `enabled: false` to disable polling entirely — useful when the page is
 * not visible (App.tsx keeps all pages mounted, so each page must opt-out
 * when its path is not active).
 */
import { useEffect, useRef, useState } from "react";

interface Options {
  /** Polling interval (ms) when agent is idle. Default 15 000. */
  idle?: number;
  /** Polling interval (ms) when agent is active. Default 2 000. */
  active?: number;
  /** If true, run fetch immediately on mount. Default true. */
  immediate?: boolean;
  /** If false, skip all polling and event handling. Default true. */
  enabled?: boolean;
}

export function useAgentPolling(
  fn: () => void | Promise<void>,
  options: Options = {},
) {
  const { idle = 15_000, active = 2_000, immediate = true, enabled = true } = options;

  // Keep a stable ref so the interval always calls the latest version of fn
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  const [agentActive, setAgentActive] = useState(false);

  // Listen for agent lifecycle events
  useEffect(() => {
    if (!enabled) return;
    const onActive = (e: Event) => {
      setAgentActive((e as CustomEvent<{ active: boolean }>).detail.active);
    };
    const onNavigate = () => {
      // Immediate refresh when agent navigates to this page
      void fnRef.current();
    };
    window.addEventListener("agent-active", onActive);
    window.addEventListener("agent-navigate", onNavigate);
    return () => {
      window.removeEventListener("agent-active", onActive);
      window.removeEventListener("agent-navigate", onNavigate);
    };
  }, [enabled]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled) return;
    if (immediate) void fnRef.current();
    const ms = agentActive ? active : idle;
    const id = setInterval(() => void fnRef.current(), ms);
    return () => clearInterval(id);
  }, [agentActive, active, idle, immediate, enabled]);
}
