import { useEffect, useRef } from "react";

const EVENT_NAME = "nella-agent-tool-result";
const STORAGE_KEY = "nella.agent.lastToolResult";
const REPLAY_WINDOW_MS = 10_000;

export interface AgentToolResultDetail {
  name?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  ts?: number;
}

/**
 * 페이지가 NELLA 에이전트의 도구 실행 결과를 구독하기 위한 훅.
 *
 * - `nella-agent-tool-result` window 이벤트를 listen
 * - 페이지 마운트 직후 sessionStorage의 최신 결과(10초 이내)도 한 번 replay
 *   → 에이전트가 페이지를 막 띄운 직후 도착해도 놓치지 않음
 * - `toolNames` 필터로 해당 페이지가 관심 있는 도구만 받아봄
 * - `enabled: false`면 구독 자체를 안 함 — App.tsx가 모든 페이지를 마운트해두기
 *   때문에 비활성 페이지가 reload 트리거를 발생시키지 않도록 차단
 *
 * @param toolNames  관심 있는 도구 이름들 (또는 "*"로 전체 수신)
 * @param handler    매칭된 결과를 처리하는 콜백 — 항상 최신 ref로 호출되므로 deps에 안 넣어도 됨
 * @param enabled    false면 listen/replay 모두 스킵. 기본 true.
 */
export function useAgentToolResult(
  toolNames: readonly string[] | "*",
  handler: (detail: AgentToolResultDetail) => void,
  enabled: boolean = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const matches = (name: string | undefined): boolean => {
      if (!name) return false;
      if (toolNames === "*") return true;
      return toolNames.includes(name);
    };

    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<AgentToolResultDetail>).detail;
      if (matches(detail?.name)) handlerRef.current(detail);
    };
    window.addEventListener(EVENT_NAME, onEvent);

    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AgentToolResultDetail;
        if (
          matches(parsed.name) &&
          parsed.ts &&
          Date.now() - parsed.ts < REPLAY_WINDOW_MS
        ) {
          handlerRef.current(parsed);
        }
      }
    } catch {
      /* ignore */
    }

    return () => window.removeEventListener(EVENT_NAME, onEvent);
    // toolNames 배열 참조 변경에 매번 재구독하지 않도록 — 사용처에서 안정적인 배열을 넘긴다는 전제.
    // 변경이 잦으면 useMemo로 감싸야 함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
