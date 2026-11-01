// 模型定义包含连接配置；它们不是界面所需数据，不能送到浏览器。
const PRIVATE_FIELD = /^(?:baseUrl|endpoint|headers|authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|secret)$/i;

export function redactText(text: string): string {
  return text
    .replace(/\bsk-[\w-]{8,}/g, "[凭据已隐藏]")
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [已隐藏]")
    .replace(/((?:api[ _-]?key|token|secret|password)\s*[=:]\s*)[^\s"',;&]+/gi, "$1[已隐藏]");
}

export function publicData(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(publicData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_FIELD.test(key))
    .map(([key, child]) => [key, /^(?:error|errorMessage|finalError)$/i.test(key) && typeof child === "string" ? logText(child) : publicData(child)]));
}

export function logText(text: string): string {
  // stderr 和错误提示也不能泄露模型服务器的地址。
  return redactText(text).replace(/https?:\/\/[^\s"'<>]+/gi, "[连接地址已隐藏]");
}
