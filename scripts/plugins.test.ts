import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { PluginCatalog, exactVersion, githubLink, npmSource, packageName } from "../server/plugin-catalog.js";
import { PluginSettings } from "../server/plugin-settings.js";
import { PluginService } from "../server/plugins.js";
import { AppSettings } from "../server/settings.js";
import { parsePiList, type PluginRunner } from "../server/plugin-command.js";
import { extensionEnabled, pluginId, pluginInventory } from "../server/plugin-inventory.js";
const exec = promisify(execFile);
async function fixture() { const root = await mkdtemp(join(tmpdir(), "pi-desk-plugins-")); const agentDir = join(root, "agent"); await mkdir(agentDir); return { root, agentDir, cleanup: () => exec("trash", [root]) }; }
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input)); const version = url.pathname.endsWith("2.0.0") || url.pathname.endsWith("latest") ? "2.0.0" : "1.0.0";
  if (url.pathname.startsWith("/-/v1/search")) return Response.json({ objects: [{ package: { name: "pi-fixture", version, description: "测试插件", date: "2026-01-01", publisher: { username: "fixture" } } }] });
  if (url.hostname === "api.npmjs.org") return Response.json({ downloads: 123 });
  return Response.json({ name: "pi-fixture", version, description: "测试插件", license: "MIT", repository: { url: "git+https://github.com/example/pi-fixture.git" } });
};
async function finished(service: PluginService) { for (let count = 0; count < 200; count++) { if (service.status().job?.status !== "running") return service.status().job!; await new Promise((done) => setTimeout(done, 10)); } throw new Error("插件测试超时"); }
test("插件参数只接受 npm 合法名称和固定版本，GitHub 链接不允许任意域名/凭据", () => {
  assert.equal(packageName("@scope/pi-foo"), "@scope/pi-foo"); assert.deepEqual(npmSource("npm:@scope/pi-foo@1.2.3"), { name: "@scope/pi-foo", version: "1.2.3" });
  for (const value of ["--prefix=/tmp", "foo;echo x", "../p", "https://evil.invalid/p", "@a/../p", "a\\b"]) assert.throws(() => packageName(value));
  for (const value of ["latest", "^1.0.0", "v1.0.0", "1.0", "1.0.0 && echo no"]) assert.throws(() => exactVersion(value));
  assert.equal(githubLink("git+https://github.com/test/plugin.git"), "https://github.com/test/plugin"); assert.equal(githubLink("https://github.com@evil.invalid/a/b"), undefined); assert.equal(githubLink("https://github.com/a/b?redirect=x"), undefined);
});
test("设置变更备份原字节、权限 0600、保留其他字段、拒绝并发旧版本及符号链接", async () => {
  const f = await fixture(); try {
    const settings = new PluginSettings(f.agentDir, join(f.root, "backups")); const original = '{"custom":{"nested":true},"packages":["npm:pi-fixture@1.0.0"],"defaultModel":"fixture"}\n'; await writeFile(settings.path, original);
    const revision = (await settings.snapshot()).revision;
    await settings.change(revision, (data) => ({ ...data, custom: "MUST NOT CHANGE", extensions: ["-builtin:mcp"] }));
    const saved = (await settings.snapshot()).data; assert.deepEqual(saved.custom, { nested: true }); assert.equal(saved.defaultModel, "fixture"); assert.equal(await readFile(join(f.root, "backups", (await readdir(join(f.root, "backups")))[0]), "utf8"), original); assert.equal((await stat(settings.path)).mode & 0o777, 0o600);
    await assert.rejects(settings.change(revision, (data) => data), /别处修改/);
    const dir = join(f.root, "linked"); await mkdir(dir); await symlink(settings.path, join(dir, "settings.json")); await assert.rejects(new PluginSettings(dir, join(f.root, "backup2")).snapshot(), /安全读取/);
    await writeFile(settings.path, "BROKEN JSON"); await assert.rejects(settings.change(undefined, () => ({})), /安全读取/); assert.equal(await readFile(settings.path, "utf8"), "BROKEN JSON");
  } finally { await f.cleanup(); }
});
test("插件清单读 pi list 路径、本地文件与内置项；启用可覆盖通配排除", async () => {
  const f = await fixture(); try {
    await mkdir(join(f.agentDir, "extensions")); await writeFile(join(f.agentDir, "extensions", "fixture.ts"), "export default () => {};\n");
    const paths = parsePiList("User packages:\n  npm:pi-fixture@1.0.0 (filtered)\n    /tmp/fixture\nProject packages:\n  npm:ignored\n    /tmp/ignored\n"); assert.equal(paths.size, 1);
    const rows = await pluginInventory(f.agentDir, { extensions: ["-extensions/fixture.ts", "-builtin:mcp"] }, new Map(), "1.4.0");
    assert.equal(rows.find((row) => row.item.name === "fixture.ts")?.item.enabled, false); assert.equal(rows.find((row) => row.item.name === "builtin:mcp")?.item.enabled, false); assert.ok(rows.every((row) => !row.item.canRemove));
    assert.equal(extensionEnabled("extensions/fixture.ts", ["!extensions/*.ts", "+extensions/fixture.ts"], f.agentDir), true);
    const explicit = join(f.root, "explicit.ts"); await writeFile(explicit, "export default () => {};\n");
    const disabled = await pluginInventory(f.agentDir, { extensions: [`-${explicit}`] }, new Map()); assert.equal(disabled.find((row) => row.item.name === "explicit.ts")?.item.enabled, false);
    const enabled = await pluginInventory(f.agentDir, { extensions: [`+${explicit}`] }, new Map()); assert.equal(enabled.find((row) => row.item.name === "explicit.ts")?.item.enabled, true);
  } finally { await f.cleanup(); }
});
test("发现后台获取固定 npm 元数据、真实下载量排序所需字段和许可，不执行安装", async () => {
  const catalog = new PluginCatalog(fetcher); const result = await catalog.search("fixture"); assert.equal(result.items[0].downloads, 123); assert.equal(result.items[0].license, "MIT"); assert.equal(result.items[0].github, "https://github.com/example/pi-fixture"); await assert.rejects(catalog.metadata("pi-fixture", "latest"), /确切/);
});
test("停用/恢复精确资源过滤，确认凭证只能使用一次；配置变化拒绝覆盖", async () => {
  const f = await fixture(); let service: PluginService | undefined; try {
    const original = { source: "npm:pi-fixture@1.0.0", extensions: ["extensions/a.ts"], skills: [], custom: "preserve" };
    await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ packages: [original], unrelated: [1, 2] }));
    service = new PluginService({ agentDir: f.agentDir, appSettings: new AppSettings(join(f.root, "app/settings.json")), run: async (args) => args[0] === "--version" ? "1.4.0" : "User packages:\n  npm:pi-fixture@1.0.0\n", catalog: new PluginCatalog(fetcher) });
    const item = (await service.list()).items.find((row) => row.kind === "npm")!;
    const disable = await service.prepare({ kind: "toggle", id: item.id, enabled: false }); assert.equal((await service.list()).items.find((row) => row.id === item.id)?.enabled, true);
    service.confirm(disable.ticket, true); assert.throws(() => service!.confirm(disable.ticket, true), /过期|已使用/); assert.equal((await finished(service)).status, "succeeded"); assert.equal((await service.list()).items.find((row) => row.id === item.id)?.enabled, false);
    const enable = await service.prepare({ kind: "toggle", id: item.id, enabled: true }); service.confirm(enable.ticket, true); assert.equal((await finished(service)).status, "succeeded"); assert.deepEqual((await service.settings.snapshot()).data.packages, [original]);
    const conflict = await service.prepare({ kind: "toggle", id: item.id, enabled: false }); await writeFile(service.settings.path, JSON.stringify({ packages: [original], unrelated: "EXTERNAL" })); service.confirm(conflict.ticket, true); assert.equal((await finished(service)).status, "failed"); assert.equal((await service.settings.snapshot()).data.unrelated, "EXTERNAL");
  } finally { await service?.close(); await f.cleanup(); }
});
test("安装和更新用参数数组及隔离设置，固定版本、保留停用状态，新版失败恢复旧版", async () => {
  const f = await fixture(); let service: PluginService | undefined; try {
    const calls: string[][] = []; let failNew = false; const installed = join(f.agentDir, "npm/node_modules/pi-fixture"); await mkdir(installed, { recursive: true });
    await writeFile(join(installed, "package.json"), JSON.stringify({ name: "pi-fixture", version: "1.0.0" }));
    const declaration = { source: "npm:pi-fixture@1.0.0", extensions: [], skills: [], prompts: [], themes: [] };
    await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ packages: [declaration], unrelated: { keep: true } }));
    const run: PluginRunner = async (args, options) => {
      if (args[0] === "--version") return "1.4.0";
      if (args[0] === "list") return `User packages:\n  npm:pi-fixture@1.0.0\n    ${installed}\n`;
      calls.push(args); assert.notEqual(options.agentDir, f.agentDir); assert.equal(await readFile(join(f.agentDir, "settings.json"), "utf8"), JSON.stringify({ packages: [declaration], unrelated: { keep: true } }));
      options.output?.("fixture progress"); if (failNew && args[0] === "install" && args[1].endsWith("2.0.0")) throw new Error("故意模拟安装失败"); return "";
    };
    service = new PluginService({ agentDir: f.agentDir, appSettings: new AppSettings(join(f.root, "app/settings.json")), run, catalog: new PluginCatalog(fetcher) });
    const id = pluginId("npm", "pi-fixture"); failNew = true; const failure = await service.prepare({ kind: "update", id, version: "2.0.0" }); service.confirm(failure.ticket, true); assert.equal((await finished(service)).status, "failed"); assert.deepEqual(calls, [["remove", "npm:pi-fixture@1.0.0"], ["install", "npm:pi-fixture@2.0.0"], ["install", "npm:pi-fixture@1.0.0"]]); assert.deepEqual((await service.settings.snapshot()).data.packages, [declaration]);
    calls.length = 0; failNew = false; const success = await service.prepare({ kind: "update", id, version: "2.0.0" }); service.confirm(success.ticket, true); assert.equal((await finished(service)).status, "succeeded"); assert.deepEqual((await service.settings.snapshot()).data.packages, [{ ...declaration, source: "npm:pi-fixture@2.0.0" }]); assert.deepEqual((await service.settings.snapshot()).data.unrelated, { keep: true }); assert.equal(service.status().needsReload, true);
  } finally { await service?.close(); await f.cleanup(); }
});
