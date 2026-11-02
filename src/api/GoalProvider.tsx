import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { GoalSummary } from "../../shared/extensions";
import { useChat } from "./ChatProvider";
import { fileRequest } from "./files";
type ContextValue = { goals: GoalSummary[]; error: string; pausing: boolean; pause: () => Promise<void> };
const Context = createContext<ContextValue | null>(null);
export function useGoals() { const value = useContext(Context); if (!value) throw new Error("缺少 GoalProvider"); return value; }
export function GoalProvider({ children }: { children: ReactNode }) {
  const { state, send } = useChat(); const [data, setData] = useState<{ cwd: string; goals: GoalSummary[]; error: string }>({ cwd: "", goals: [], error: "" });
  const [pausing, setPausing] = useState(false); const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!state.cwd || state.connection !== "ready") return;
    const cwd = state.cwd; const abort = new AbortController(); let loading = false;
    const load = async () => {
      if (loading || abort.signal.aborted) return; loading = true;
      try { const response = await fileRequest(`/api/goals?${new URLSearchParams({ cwd })}`, { signal: abort.signal }); const result = await response.json(); if (!abort.signal.aborted) setData({ cwd, goals: result.goals, error: "" }); }
      catch (error) { if (!abort.signal.aborted) setData({ cwd, goals: [], error: (error as Error).message }); }
      finally { loading = false; }
    };
    refresh.current = load; void load(); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2500);
    return () => { abort.abort(); clearInterval(timer); };
  }, [state.cwd, state.connection]);
  async function pause() { if (pausing) return; setPausing(true); try { await send("/goal-pause"); await refresh.current(); } finally { setPausing(false); } }
  return <Context.Provider value={{ goals: data.cwd === state.cwd ? data.goals : [], error: data.cwd === state.cwd ? data.error : "", pausing, pause }}>{children}</Context.Provider>;
}
