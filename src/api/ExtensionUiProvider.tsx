import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { emptyUi, type UiRequest, type UiSnapshot } from "../../shared/extensions";
import { useChat } from "./ChatProvider";
import { applyUi, plainUi } from "./extension-ui-state";
export type PendingDialog = UiRequest & { cwd: string };
type Toast = { id: string; message: string; level: "info" | "warning" | "error"; cwd: string };
type Groups = Record<string, UiSnapshot>;
type ContextValue = { current: UiSnapshot; pending: PendingDialog[]; toasts: Toast[]; dismiss: (id: string) => void; answer: (dialog: PendingDialog, payload: Record<string, unknown>) => Promise<void> };
const Context = createContext<ContextValue | null>(null);
export function useExtensionUi() { const value = useContext(Context); if (!value) throw new Error("缺少 ExtensionUiProvider"); return value; }
function normalized(value: UiSnapshot): UiSnapshot {
  return { ...emptyUi(), ...value, statuses: Object.fromEntries(Object.entries(value.statuses ?? {}).map(([key, text]) => [key, plainUi(text)])),
    widgets: Object.fromEntries(Object.entries(value.widgets ?? {}).map(([key, widget]) => [key, { ...widget, lines: widget.lines.map(plainUi) }])), title: value.title ? plainUi(value.title) : undefined };
}
export function ExtensionUiProvider({ children }: { children: ReactNode }) {
  const { state, subscribeRecords, answerUi } = useChat(); const [groups, setGroups] = useState<Groups>({}); const live = useRef(groups); live.current = groups;
  const [toasts, setToasts] = useState<Toast[]>([]); const seen = useRef(new Set<string>()); const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const update = (fn: (value: Groups) => Groups) => { const next = fn(live.current); live.current = next; setGroups(next); };
  useEffect(() => {
    const unsubscribe = subscribeRecords(({ cwd, record, seq }) => {
      if (record.type === "desk_ui_states" && Array.isArray(record.states)) {
        const next: Groups = {}; for (const row of record.states) if (typeof row.cwd === "string" && row.state) next[row.cwd] = normalized(row.state); update(() => next); return;
      }
      if (record.type === "desk_ui_state" && record.state) {
        if ((live.current[cwd]?.seq ?? -1) <= record.state.seq) update((rows) => ({ ...rows, [cwd]: normalized(record.state) })); return;
      }
      if (record.type === "desk_ui_resolved") { update((rows) => ({ ...rows, [cwd]: { ...(rows[cwd] ?? emptyUi()), dialogs: (rows[cwd]?.dialogs ?? []).filter((dialog) => dialog.id !== record.id) } })); return; }
      if (record.type === "desk_process_exit") { update((rows) => { const next = { ...rows }; delete next[cwd]; return next; }); return; }
      if (record.type !== "extension_ui_request") return;
      if (record.method === "notify" && typeof record.message === "string") {
        const id = `${cwd}:${record.id}`;
        if (!seen.current.has(id)) {
          seen.current.add(id); const level = ["error", "warning"].includes(record.notifyType) ? record.notifyType : "info";
          setToasts((rows) => [...rows.slice(-4), { id, cwd, level, message: plainUi(record.message) }]);
          timers.current.set(id, setTimeout(() => { setToasts((rows) => rows.filter((row) => row.id !== id)); timers.current.delete(id); }, level === "error" ? 8000 : 5000));
        }
      }
      update((rows) => ({ ...rows, [cwd]: applyUi(rows[cwd] ?? emptyUi(), record as UiRequest, seq) }));
    });
    return () => { unsubscribe(); for (const timer of timers.current.values()) clearTimeout(timer); };
  }, [subscribeRecords]);
  const pending = Object.entries(groups).flatMap(([cwd, snapshot]) => snapshot.dialogs.map((dialog) => ({ ...dialog, cwd }))).sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0));
  return <Context.Provider value={{ current: groups[state.cwd] ?? emptyUi(), pending, toasts, dismiss: (id) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setToasts((rows) => rows.filter((row) => row.id !== id)); },
    answer: (dialog, payload) => answerUi(dialog.cwd, { type: "extension_ui_response", id: dialog.id, ...payload }) }}>{children}</Context.Provider>;
}
