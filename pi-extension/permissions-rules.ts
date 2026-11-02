import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
export type PermissionMode = "read-only" | "auto" | "full";
export type Hints = { readOnlyHint?: boolean; destructiveHint?: boolean };
export type Decision = { action: "allow" | "block" | "ask"; reason?: string; title?: string; dangerous?: boolean; grantKey?: string };
export const MODE_LABELS: Record<PermissionMode, string> = { "read-only": "只读", auto: "自动", full: "完全放开" };
export const permissionMode = (value: unknown): PermissionMode => ["read-only", "auto", "full"].includes(String(value)) ? value as PermissionMode : "auto";
export type Word = { text: string; start: number; end: number };
export function shellWords(command: string): { segments: Word[][]; complex: boolean } {
  const segments: Word[][] = []; let words: Word[] = []; let text = ""; let start = -1; let quote = ""; let complex = /[>`]|\$\(/.test(command); let ended = false;
  const flush = (end: number) => { if (start >= 0) words.push({ text, start, end }); text = ""; start = -1; };
  const split = (end: number, strict = true) => { flush(end); if (!words.length && strict) complex = true; else if (words.length) segments.push(words); words = []; ended = strict; };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (char === "\\" && quote !== "'") { if (start < 0) start = index; if (++index >= command.length) { complex = true; break; } if (command[index] === "\n") complex = true; else text += command[index]; ended = false; continue; }
    if (quote) { if (char === quote) quote = ""; else { if (char === "$" && quote === '"') complex = true; text += char; } continue; }
    if (char === "'" || char === '"') { if (start < 0) start = index; quote = char; ended = false; continue; }
    if (char === "#" && start < 0) { while (index < command.length && command[index] !== "\n") index++; if (index < command.length) split(index, false); continue; }
    if (char === ";" || char === "|" || char === "&" || char === "\n") {
      split(index, char === "|" || char === "&"); if (char === "&" && command[index + 1] !== "&" || char === "|" && command[index + 1] === "&") complex = true;
      if ((char === "&" || char === "|") && command[index + 1] === char) index++; continue;
    }
    if (/\s/.test(char)) { flush(index); continue; }
    if ("$(){}<>".includes(char)) complex = true;
    if (start < 0) start = index; text += char; ended = false;
  }
  flush(command.length); if (quote || ended) complex = true; if (words.length) segments.push(words);
  return { segments, complex };
}
const SIMPLE = new Set("ls pwd cat head tail wc grep rg find echo which file stat du df tree sort uniq cut diff date whoami uname basename dirname realpath".split(" "));
const NAME = (word: string) => word.includes("/") ? ["/bin", "/usr/bin"].includes(dirname(word)) ? basename(word) : "" : word;
function positional(args: string[], take: Set<string>) { const values: string[] = []; for (let i = 0; i < args.length; i++) { if (args[i] === "--") { values.push(...args.slice(i + 1)); break; } if (take.has(args[i])) i++; else if (!args[i].startsWith("-")) values.push(args[i]); } return values; }
function safeSegment(words: Word[]) {
  const name = NAME(words[0]?.text ?? ""); const args = words.slice(1).map((word) => word.text);
  if (name === "node") return args.length === 1 && ["-v", "--version"].includes(args[0]);
  if (["python", "python3", "npm", "ruby", "go", "rustc"].includes(name)) return args.length === 1 && args[0] === "--version";
  if (name === "git") {
    const [sub, ...rest] = args;
    if (rest.some((arg) => /^--(?:output|ext-diff|textconv|open-files-in-pager)(?:=|$)/.test(arg))) return false;
    if (sub === "branch") return rest.every((arg) => ["-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--show-current", "--list", "--no-color"].includes(arg) || /^--(?:list|color)=/.test(arg));
    if (sub === "remote") return rest.length === 1 && ["-v", "--verbose"].includes(rest[0]);
    return ["status", "diff", "log", "show", "rev-parse", "ls-files", "blame"].includes(sub);
  }
  if (!SIMPLE.has(name)) return false;
  if (name === "find" && args.some((arg) => /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)(?:=|$)/.test(arg))) return false;
  if (name === "rg" && args.some((arg) => /^--pre(?:=|$)/.test(arg))) return false;
  if (["sort", "tree"].includes(name) && args.some((arg) => /^-o|^--(?:output|compress-program)(?:=|$)/.test(arg))) return false;
  if (name === "uniq" && positional(args, new Set(["-f", "--skip-fields", "-s", "--skip-chars", "-w", "--check-chars"])).length > 1) return false;
  if (name === "file" && args.some((arg) => arg === "--compile" || /^-[^-]*C/.test(arg))) return false;
  if (name === "date" && !args.every((arg) => arg === "-u" || arg.startsWith("+"))) return false;
  return true;
}
const recursive = (args: string[]) => args.some((arg) => arg === "--recursive" || /^-[^-]*[rR]/.test(arg));
export function commandDangerous(command: string) {
  const { segments } = shellWords(command); const names = segments.map((words) => basename(words[0]?.text ?? ""));
  return segments.some((words) => {
    const name = basename(words[0]?.text ?? ""); const args = words.slice(1).map((word) => word.text);
    if (["sudo", "ssh", "scp", "dd", "launchctl"].includes(name) || /^mkfs(?:\.|$)/.test(name)) return true;
    if (["rm", "chmod", "chown"].includes(name) && recursive(args)) return true;
    if (name === "git" && (args.includes("push") || args.includes("clean") || args.includes("reset") && args.some((arg) => arg.startsWith("--hard")))) return true;
    if (name === "kill" && args.some((arg) => ["-9", "-KILL", "-SIGKILL"].includes(arg))) return true;
    if (name === "brew" && args.includes("uninstall") || name === "npm" && args.includes("publish")) return true;
    return name === "curl" && names.some((name) => ["sh", "bash"].includes(name));
  });
}
export function commandSafe(command: string) { const parsed = shellWords(command); return !parsed.complex && parsed.segments.length > 0 && parsed.segments.every(safeSegment) && !parsed.segments.some((words) => words.some((word) => word.text === "sudo")); }
export function expandedPath(path: string, cwd: string, home = homedir()) { return resolve(cwd, path === "~" ? home : path.startsWith("~/") ? resolve(home, path.slice(2)) : path); }
export function inside(root: string, path: string) { const rel = relative(root, path); return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); }
export function sensitivePath(path: string, home = homedir(), roots: string[] = []) {
  const protectedRoots = [".ssh", ".gnupg", ".pi/agent/secrets", ".config/sops"].map((path) => resolve(home, path));
  return [...protectedRoots, ...roots].some((root) => inside(root, path)) || path.split(sep).some((part) => part.toLowerCase() === ".env" || part.toLowerCase().startsWith(".env."));
}
export type DecideOptions = { annotations?: Hints; home?: string; sensitiveRoots?: string[]; commandSensitive?: boolean };
export function decide(mode: PermissionMode, toolName: string, input: Record<string, unknown>, cwd: string, options: DecideOptions = {}): Decision {
  if (mode === "full") return { action: "allow" };
  const home = options.home ?? homedir(); const ask = (title: string, grantKey: string, dangerous = false): Decision => ({ action: "ask", title: dangerous ? `⚠️ 危险操作\n${title}` : title, dangerous, grantKey });
  const block = (reason: string): Decision => ({ action: "block", reason });
  if (["read", "edit", "write"].includes(toolName)) {
    if (typeof input.path !== "string" || !input.path || input.path.includes("\0")) return block("无法确认有效的文件路径");
    const path = expandedPath(input.path, cwd, home); const key = JSON.stringify([toolName, dirname(path)]);
    if (toolName === "read") return mode === "auto" && sensitivePath(path, home, options.sensitiveRoots) ? ask(`需要你的允许：读取敏感文件\n${path}`, key) : { action: "allow" };
    if (mode === "read-only") return block("只读模式不允许修改文件，请切换权限模式后再试");
    if (sensitivePath(path, home, options.sensitiveRoots)) return ask(`需要你的允许：修改敏感文件\n${path}`, key);
    return inside(cwd, path) ? { action: "allow" } : ask(`修改项目外的文件：${path}`, key);
  }
  if (toolName === "bash") {
    if (typeof input.command !== "string") return block("无法确认有效的命令");
    const command = input.command; const safe = commandSafe(command); const dangerous = commandDangerous(command);
    const sensitive = options.commandSensitive ?? shellWords(command).segments.some((words) => words.slice(1).some((word) => sensitivePath(expandedPath(word.text, cwd, home), home, options.sensitiveRoots)));
    if (mode === "read-only") return safe ? { action: "allow" } : block("只读模式不允许执行这条命令；只允许安全的查看命令");
    return safe && !sensitive ? { action: "allow" } : ask(`需要你的允许：执行命令\n${command}`, JSON.stringify([toolName, command]), dangerous);
  }
  if (["web_search", "fetch_content", "todo", "ask_user_question", "plan_mode_question", "plan_mode_complete"].includes(toolName) || toolName.startsWith("ctx_")) return { action: "allow" };
  if (mode === "read-only") return options.annotations?.readOnlyHint === true && options.annotations.destructiveHint !== true ? { action: "allow" } : block("只读模式拒绝未知的非只读工具");
  return options.annotations?.destructiveHint === true ? ask(`需要你的允许：执行工具 ${toolName}\n${JSON.stringify(input, null, 2)}`, JSON.stringify([toolName, input])) : { action: "allow" };
}
// 防止只读的 Git 查询调用项目配置中的 pager、fsmonitor、外部 diff/textconv。
export function hardenSafeGit(command: string) {
  if (!commandSafe(command)) return command;
  const replacements = shellWords(command).segments.filter((words) => NAME(words[0].text) === "git").map((words) => ({ start: words[0].start, end: words[1].end,
    text: `${command.slice(words[0].start, words[0].end)} -c core.fsmonitor=false -c core.hooksPath=/dev/null --no-pager ${command.slice(words[1].start, words[1].end)}${["diff", "log", "show"].includes(words[1].text) ? " --no-ext-diff --no-textconv" : ""}` }));
  let output = command; for (const item of replacements.reverse()) output = output.slice(0, item.start) + item.text + output.slice(item.end); return output;
}
