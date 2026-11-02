import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, open, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { FileService, MAX_FILE, byteRange, fileMime } from "../server/files.js";
import { createDeskServer } from "../server/index.js";
import { BASE_URL } from "../server/auth.js";
import { OfficePreview } from "../server/office.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);
async function temp() { return realpath(await mkdtemp(join(tmpdir(), "pi-desk-files-"))); }
const fake = resolve("scripts/fixtures/fake-pi.mjs");

test("文件安全：仅限已打开项目，realpath 防越界/软链接，敏感根和其真实目标都拒绝", async () => {
  const root = await temp(); const project = join(root, "project"); const home = join(root, "home"); const secret = join(root, "protected-real");
  await mkdir(project); await mkdir(home); await mkdir(secret); await mkdir(join(home, ".pi")); await symlink(secret, join(home, ".pi", "agent"));
  await writeFile(join(secret, "private.txt"), "fictional fixture only"); await writeFile(join(project, "file.txt"), "汉字 fixture\n");
  await symlink(join(secret, "private.txt"), join(project, "escape.txt")); await symlink(join(project, "file.txt"), join(project, "inside.txt"));
  await writeFile(join(project, ".env"), "fictional fixture only");
  const service = new FileService(home);
  try {
    await assert.rejects(service.info(project, "file.txt"), /先打开/); service.register(project);
    assert.equal((await service.info(project, "inside.txt")).path, join(project, "file.txt"));
    for (const path of ["../protected-real/private.txt", "escape.txt", ".env", `${home}/.pi/agent/private.txt`, "~/.ssh/id_ed25519"]) await assert.rejects(service.info(project, path), /项目|敏感|软链接/);
    service.register(secret); await assert.rejects(service.info(secret, "private.txt"), /敏感/);
    await assert.rejects(service.info(project, "missing"), /不存在/); await assert.rejects(service.info(project, "."), /普通文件/);
  } finally { await exec("trash", [root]); }
});

test("懒树一层排序/隐藏/循环链接，信息前 8KB 二进制检测，过大文件只 stat 不读", async () => {
  const root = await temp(); const service = new FileService(join(root, "fake-home")); service.register(root);
  const huge = join(root, "huge.bin");
  try {
    for (const name of ["Z folder", ".git", "node_modules", ".pi-desk"]) await mkdir(join(root, name));
    for (const name of ["a.txt", "z.txt", ".DS_Store"]) await writeFile(join(root, name), "fixture");
    await writeFile(join(root, "null.bin"), Buffer.from([1, 0, 2])); await symlink(root, join(root, "cycle"));
    const handle = await open(huge, "w"); await handle.truncate(MAX_FILE + 1); await handle.close(); await chmod(huge, 0);
    const tree = await service.tree(root);
    assert.equal(tree.entries[0].name, "Z folder"); assert.ok(tree.entries.every((row) => ![".git", "node_modules", ".pi-desk", ".DS_Store", "cycle"].includes(row.name)));
    assert.equal((await service.info(root, "null.bin")).binary, true); assert.equal((await service.info(root, "a.txt")).binary, false);
    assert.equal((await service.info(root, "huge.bin")).tooLarge, true, "无读权限仍可报告大文件，不能读取其内容");
    assert.equal(fileMime("photo.svg"), "image/svg+xml"); assert.equal(fileMime("movie.mp4"), "video/mp4");
  } finally { await chmod(huge, 0o600).catch(() => {}); await exec("trash", [root]); }
});

test("单字节范围支持起止/尾部/越界裁剪，拒绝多段和非法范围", () => {
  assert.deepEqual(byteRange("bytes=0-2", 10), { start: 0, end: 2 });
  assert.deepEqual(byteRange("bytes=2-", 10), { start: 2, end: 9 });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange("bytes=1-999", 10), { start: 1, end: 9 });
  for (const range of ["bytes=10-", "bytes=5-1", "bytes=-0", "bytes=0-1,3-4", "words=1-2", "bytes=-"]) assert.throws(() => byteRange(range, 10));
  assert.throws(() => byteRange("bytes=0-1", 0));
});

test("真实鉴权 HTTP 文件/HEAD/Range/信息/树/系统打开，未知项目与敏感路径拒绝，50MB 不读取", async () => {
  const root = await temp(); const content = Buffer.from("汉字 hello\n"); const path = join(root, "file with space.txt"); await writeFile(path, content);
  const huge = join(root, "huge.bin"); const handle = await open(huge, "w"); await handle.truncate(MAX_FILE + 1); await handle.close();
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd) => new PiProcess(cwd, { binary: process.execPath, args: [fake] }) });
  const launched: { path: string; reveal: boolean }[] = [];
  const desk = createDeskServer({ pool, systemOpen: async (path, reveal) => { launched.push({ path, reveal }); } }); let client: DeskClient | undefined;
  const url = (api: string, name = path) => `${BASE_URL}/api/${api}?${new URLSearchParams({ cwd: root, path: name })}`;
  try {
    await desk.listen(); const headers = { Authorization: `Bearer ${desk.auth.token}` };
    assert.equal((await fetch(url("file"))).status, 401); assert.equal((await fetch(url("file"), { headers })).status, 403);
    client = new DeskClient(desk.auth.launchUrl); await client.ready; await client.open(root);
    const file = await fetch(url("file"), { headers }); assert.equal(file.status, 200); assert.deepEqual(Buffer.from(await file.arrayBuffer()), content);
    assert.equal(Number(file.headers.get("x-file-size")), content.length); assert.ok(Number(file.headers.get("x-file-mtime")) > 0); assert.match(file.headers.get("content-type")!, /text\/plain/);
    const head = await fetch(url("file"), { method: "HEAD", headers }); assert.equal(head.status, 200); assert.equal(await head.text(), ""); assert.equal(Number(head.headers.get("content-length")), content.length);
    const ranged = await fetch(url("file"), { headers: { ...headers, Range: "bytes=0-5" } }); assert.equal(ranged.status, 206); assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), content.subarray(0, 6));
    const invalid = await fetch(url("file"), { headers: { ...headers, Range: "bytes=999-" } }); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get("content-range"), `bytes */${content.length}`);
    assert.equal((await fetch(`${BASE_URL}/api/file?path=~/.ssh/id_ed25519`, { headers })).status, 403);
    assert.equal((await fetch(url("file", huge), { headers })).status, 413);
    assert.equal((await (await fetch(url("file-info", huge), { headers })).json()).tooLarge, true);
    assert.ok(Array.isArray((await (await fetch(url("tree"), { headers })).json()).entries));
    for (const api of ["open", "reveal"]) assert.equal((await fetch(`${BASE_URL}/api/${api}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ cwd: root, path }) })).status, 200);
    assert.deepEqual(launched, [{ path, reveal: false }, { path, reveal: true }]);
    await assert.rejects(new OfficePreview().convert({ path: "fixture.xlsx", size: 1, mtimeMs: 1 }), /不需要/);
    assert.equal((await stat(path)).size, content.length);
  } finally { client?.close(); await desk.close(); await exec("trash", [root]); }
});
