import { errorInfo, type ErrorValue } from "../../../shared/errors";
export function ErrorContent({ error }: { error: ErrorValue | undefined }) {
  if (!error) return null;
  const info = errorInfo(error);
  return <div className="error-content"><span>{info.message}</span>{info.details && <details><summary>详情</summary><pre>{info.details}</pre></details>}</div>;
}
