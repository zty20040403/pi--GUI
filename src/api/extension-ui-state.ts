import { emptyUi, type UiRequest, type UiSnapshot } from "../../shared/extensions";
export const plainUi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
export function applyUi(state: UiSnapshot = emptyUi(), request: UiRequest, seq?: number): UiSnapshot {
  if (seq !== undefined && seq <= state.seq) return state;
  const next = { ...state, seq: seq ?? state.seq };
  switch (request.method) {
    case "select": case "confirm": case "input": case "editor":
      return state.dialogs.some((row) => row.id === request.id) ? next : { ...next, dialogs: [...state.dialogs, { ...request, requestedAt: request.requestedAt ?? Date.now() }] };
    case "setStatus": {
      if (typeof request.statusKey !== "string") return next;
      const statuses = { ...state.statuses }; if (typeof request.statusText === "string") statuses[request.statusKey] = plainUi(request.statusText); else delete statuses[request.statusKey]; return { ...next, statuses };
    }
    case "setWidget": {
      if (typeof request.widgetKey !== "string") return next;
      const widgets = { ...state.widgets };
      if (Array.isArray(request.widgetLines) && request.widgetLines.every((line) => typeof line === "string")) widgets[request.widgetKey] = { lines: request.widgetLines.map(plainUi), placement: request.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor" };
      else delete widgets[request.widgetKey]; return { ...next, widgets };
    }
    case "setTitle": return typeof request.title === "string" ? { ...next, title: plainUi(request.title) } : next;
    case "set_editor_text": return typeof request.text === "string" ? { ...next, editor: { id: request.id, text: request.text } } : next;
    default: return next;
  }
}
