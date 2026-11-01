import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { HttpError } from "./http.js";
import { MAX_FILE } from "./files.js";
const exec = promisify(execFile);
export const OFFICE_FORMATS = new Set([".pptx", ".ppt", ".doc", ".xls"]);
const CACHE = join(homedir(), ".cache/pi-desk/office");
export class OfficePreview {
  private readonly pending = new Map<string, Promise<string>>();
  private availability?: Promise<string | undefined>;
  private binary() {
    return this.availability ??= (async () => {
      // 只在有系统沙箱的 macOS 上转换：禁网，文件读取仅限文档、字体和程序。
      try {
        if (process.platform !== "darwin") return;
        await stat("/usr/bin/sandbox-exec");
        try { const { stdout } = await exec("which", ["soffice"], { timeout: 2000 }); return await realpath(stdout.trim()); }
        catch { return await realpath("/Applications/LibreOffice.app/Contents/MacOS/soffice"); }
      } catch { return; }
    })();
  }
  async convert(file: { path: string; mtimeMs: number; size: number }): Promise<string> {
    if (!OFFICE_FORMATS.has(extname(file.path).toLowerCase())) throw new HttpError(400, "这个格式不需要 Office 转换");
    if (file.size > MAX_FILE) throw new HttpError(413, "文件超过 50 MB，请用默认软件打开");
    const binary = await this.binary();
    if (!binary) throw new HttpError(501, "未安装 LibreOffice 或安全转换工具。装 LibreOffice 可以预览；现在请用默认软件打开");
    const key = createHash("sha256").update(`${file.path}\0${file.mtimeMs}\0${file.size}`).digest("hex");
    const hit = this.pending.get(key); if (hit) return hit;
    const operation = this.generate(file.path, binary, key);
    this.pending.set(key, operation);
    try { return await operation; } finally { this.pending.delete(key); }
  }
  private async generate(source: string, binary: string, key: string) {
    const folder = resolve(CACHE, key); await mkdir(folder, { recursive: true });
    if (await realpath(folder) !== folder) throw new HttpError(403, "Office 缓存不能使用外部软链接");
    const output = join(folder, basename(source).replace(/\.[^.]+$/, ".pdf"));
    const valid = async () => { try { return await realpath(output) === output && (await stat(output)).isFile(); } catch { return false; } };
    if (await valid()) return output;
    const profile = join(folder, "profile"); await mkdir(profile, { recursive: true });
    // 高级宏保护；使用独立缓存 profile，绝不更改用户的 LibreOffice 配置。
    await writeFile(join(profile, "registrymodifications.xcu"), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    const sandbox = join(folder, "convert.sb");
    await writeFile(sandbox, `(version 1)\n(deny default)\n(allow process*)\n(allow sysctl-read)\n(allow mach-lookup)\n(allow file-read-metadata)\n(allow file-read* (literal ${JSON.stringify(source)}) (subpath "/System") (subpath "/usr") (subpath "/nix/store") (subpath "/Library/Fonts") (subpath "/Applications/LibreOffice.app"))\n(allow file* (subpath ${JSON.stringify(folder)}))\n(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/private/etc/localtime"))\n`);
    try {
      await exec("/usr/bin/sandbox-exec", ["-f", sandbox, binary, "--headless", "--norestore", "--nodefault", "--nolockcheck",
        `-env:UserInstallation=${pathToFileURL(profile).href}`, "--convert-to", "pdf", "--outdir", folder, source],
      { timeout: 60000, maxBuffer: 64 * 1024, env: { ...process.env, SAL_USE_VCLPLUGIN: "svp" } });
    } catch { throw new HttpError(422, "Office 转换失败或超时，请用默认软件打开"); }
    if (!await valid()) throw new HttpError(422, "Office 没有生成可用的 PDF，请用默认软件打开");
    return output;
  }
}
