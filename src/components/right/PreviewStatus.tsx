import type { ErrorValue } from "../../../shared/errors";
import { ErrorContent } from "../ui/ErrorContent";
export function PreviewStatus({ error }: { error?: ErrorValue }) { return error ? <div className="preview-notice error-text" role="alert"><ErrorContent error={error} /></div> : <p className="preview-notice" role="status">正在载入预览…</p>; }
