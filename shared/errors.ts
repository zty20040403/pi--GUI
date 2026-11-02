export type ErrorInfo = { message: string; details?: string };
export type ErrorValue = string | ErrorInfo;

// 浏览器断线、fetch 失败没有经过后台，也使用同一套文案；脱敏必须先于展示/传输。
export function safeErrorText(text: string): string {
  return text.replace(/\bsk-[\w-]{8,}/g, "[凭据已隐藏]")
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [已隐藏]")
    .replace(/((?:api[ _-]?key|token|secret|password)\s*[=:]\s*)[^\s"',;&]+/gi, "$1[已隐藏]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[连接地址已隐藏]");
}
export function errorInfo(error: unknown): ErrorInfo {
  const source = error && typeof error === "object" ? error as { message?: unknown; details?: unknown; code?: unknown; status?: unknown } : undefined;
  const raw = safeErrorText(typeof error === "string" ? error : typeof source?.message === "string" ? source.message : "请求未能完成");
  const match = `${source?.code ?? ""} ${source?.status ?? ""} ${raw}`;
  let message: string;
  if (/EADDRINUSE|address already in use/i.test(match)) message = "后台端口已被占用。请关闭另一个 pi desk 或运行 npm start 的终端，再重新打开。";
  else if (/spawn.*ENOENT|command not found.*pi/i.test(match)) message = "找不到 pi 程序。请先在终端运行 pi --version，确认安装正常后重新打开。";
  else if (/ENOENT|no such file|not found.*directory|missing.*cwd/i.test(match)) message = "文件或文件夹已不存在，可能被移动或删除。请刷新列表；项目搬家后可以重新指定文件夹。";
  else if (/EACCES|EPERM|permission denied|operation not permitted/i.test(match)) message = "没有权限访问这个文件或文件夹。请检查 macOS 的文件权限，或选择你有权访问的位置。";
  else if (/\b401\b|\b403\b|unauthori[sz]ed|invalid.*(?:credential|key)|authentication/i.test(match)) message = "模型服务没有接受当前凭据。请检查 pi 的登录或密钥配置，修正后再重试；不要把密钥发到聊天里。";
  else if (/pi.*(?:exit|not running)|EPIPE|process.*(?:terminated|closed)/i.test(match)) message = "pi 进程已退出。已保存的对话仍在；请点击“重新连接”恢复，不会自动重发消息。";
  else if (/timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|network|fetch failed|failed to fetch|socket hang up|connection.*(?:closed|lost|refused|error)/i.test(match)) message = "连接模型服务失败或等待超时。请检查网络和模型服务是否可用，恢复后再重试；消息不会自动重发。";
  else if (/\b429\b|rate limit/i.test(match)) message = "模型服务暂时限流。请稍等片刻再重试，或换一个可用模型。";
  else if (/[\u3400-\u9fff]/.test(raw.replace(/\[[^\]]+已隐藏\]/g, ""))) message = raw;
  else message = "这次操作没有完成。请展开详情查看原因，检查连接或配置后再重试。";
  const details = typeof source?.details === "string" ? safeErrorText(source.details) : raw !== message ? raw : undefined;
  return { message, ...(details ? { details } : {}) };
}
export class DeskError extends Error {
  readonly details?: string;
  constructor(value: unknown) { const info = errorInfo(value); super(info.message); this.name = "DeskError"; this.details = info.details; }
}
