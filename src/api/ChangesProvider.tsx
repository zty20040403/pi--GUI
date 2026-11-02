import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChangeIndex, ChangeScope } from "../../shared/changes";
import { errorInfo, type ErrorValue } from "../../shared/errors";
import { useChat } from "./ChatProvider";
import { useFiles } from "./FileProvider";
import { changeIndex } from "./changes";
export type ReviewSelection = { scope: ChangeScope; turnId?: string; path?: string; split: boolean };
const empty = (): ReviewSelection => ({ scope: "turn", split: false });
const Context = createContext<{ index: ChangeIndex; error: ErrorValue; loading: boolean; revision: number; selection: ReviewSelection; select: (value: Partial<ReviewSelection>) => void; openTurn: (turnId: string, path?: string) => void; refresh: () => void } | null>(null);
export function useChanges() { const value = useContext(Context); if (!value) throw new Error("缺少 ChangesProvider"); return value; }
function savedSelection(key: string): ReviewSelection {
  try { const value = JSON.parse(sessionStorage.getItem(`pi-desk.review:${key}`) ?? "null"); if (value && ["turn", "session", "git"].includes(value.scope)) return { scope: value.scope, turnId: typeof value.turnId === "string" ? value.turnId : undefined, path: typeof value.path === "string" ? value.path : undefined, split: value.split === true }; } catch {}
  return empty();
}
export function ChangesProvider({ children }: { children: ReactNode }) {
  const { state, subscribeRecords } = useChat(); const { showChanges } = useFiles(); const cwd = state.cwd; const sessionId = state.session.sessionId;
  const key = `${cwd}:${sessionId ?? ""}`;
  const [snapshot, setSnapshot] = useState<{ key: string; index: ChangeIndex; loading: boolean; error: ErrorValue; revision: number }>({ key: "", index: { turns: [], git: false }, loading: false, error: "", revision: 0 });
  const [captureError, setCaptureError] = useState<ErrorValue>("");
  const [selected, setSelected] = useState({ key, value: savedSelection(key) });
  const selection = selected.key === key ? selected.value : savedSelection(key);
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    setSelected({ key, value: savedSelection(key) }); setCaptureError("");
  }, [key]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined; let busy = false; let dirty = false; const controller = new AbortController();
    if (!sessionId || state.connection !== "ready") { refreshRef.current = () => {}; return; }
    setSnapshot({ key, index: { turns: [], git: false }, loading: true, error: "", revision: 0 });
    const load = async () => {
      if (!active) return;
      if (busy) { dirty = true; return; }
      busy = true;
      try {
        const index = await changeIndex(cwd, sessionId, controller.signal);
        if (active) setSnapshot((prior) => ({ key, index, loading: false, error: "", revision: prior.revision + 1 }));
      } catch (error) { if (active && !controller.signal.aborted) setSnapshot((prior) => ({ ...prior, key, loading: false, error: errorInfo(error) })); }
      finally { busy = false; if (active && dirty) { dirty = false; schedule(); } }
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = undefined; void load(); }, 180); };
    refreshRef.current = schedule; void load();
    const unsubscribe = subscribeRecords((event) => {
      if (event.cwd !== cwd) return;
      if (event.record.type === "desk_changes_changed" && event.record.sessionId === sessionId) { setCaptureError(event.record.error ? errorInfo(event.record.error) : ""); schedule(); }
      if (["agent_settled", "desk_process_exit"].includes(event.record.type)) schedule();
    });
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); unsubscribe(); refreshRef.current = () => {}; };
  }, [key, cwd, sessionId, state.connection, subscribeRecords]);
  function select(value: Partial<ReviewSelection>) {
    const next = { ...selection, ...value }; setSelected({ key, value: next });
    try { sessionStorage.setItem(`pi-desk.review:${key}`, JSON.stringify(next)); } catch {}
  }
  const current = snapshot.key === key ? snapshot : { index: { turns: [], git: false }, error: "", loading: true, revision: 0 };
  return <Context.Provider value={{ ...current, error: captureError || current.error, selection, select, refresh,
    openTurn: (turnId, path) => { select({ scope: "turn", turnId, path }); showChanges(); } }}>{children}</Context.Provider>;
}
