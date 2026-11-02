import { errorInfo, type ErrorInfo } from "../shared/errors.js";
export { errorInfo };

// 只转换协议里明确的错误字段，不翻译正常聊天/工具输出；详情已在 errorInfo 中脱敏。
export function errorData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(errorData);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>; const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    if (["error", "errorMessage", "finalError"].includes(key) && typeof child === "string") {
      const info: ErrorInfo = errorInfo(child); result[key] = info.message;
      if (info.details) result[`${key}Details`] = info.details;
    } else if (!["errorDetails", "errorMessageDetails", "finalErrorDetails"].includes(key) || result[key] === undefined) result[key] = errorData(child);
  }
  return result;
}
