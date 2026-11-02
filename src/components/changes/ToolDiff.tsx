import { useEffect, useState } from "react";
import type { ChangedFile } from "../../../shared/changes";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
import { useChat } from "../../api/ChatProvider";
import { useChanges } from "../../api/ChangesProvider";
import { changeReview } from "../../api/changes";
import { ErrorContent } from "../ui/ErrorContent";
import { DiffView } from "./DiffView";
export function ToolDiff({ id }: { id: string }) {
  const { state } = useChat(); const { index } = useChanges(); const turnId = index.turns.find((turn) => turn.tools.some((tool) => tool.id === id))?.id;
  const [file, setFile] = useState<ChangedFile>(); const [error, setError] = useState<ErrorValue>("");
  useEffect(() => {
    const controller = new AbortController(); setFile(undefined); setError("");
    if (state.session.sessionId && turnId) void changeReview(state.cwd, state.session.sessionId, "turn", turnId, id, controller.signal).then((view) => { if (!controller.signal.aborted) setFile(view.files[0]); }, (error) => { if (!controller.signal.aborted) setError(errorInfo(error)); });
    return () => controller.abort();
  }, [id, turnId, state.cwd, state.session.sessionId]);
  return <div className="tool-diff"><div className="detail-label">这次改动</div>{error ? <ErrorContent error={error} /> : file ? <DiffView file={file} compact /> : <p className="diff-notice">{turnId ? "正在载入改动…" : "没有可用的前后快照；旧对话或未完成操作不会伪造历史差异。"}</p>}</div>;
}
