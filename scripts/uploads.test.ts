import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { FileService, MAX_FILE } from "../server/files.js";
import { createDeskServer } from "../server/index.js";
import { BASE_URL } from "../server/auth.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { imageMime, uploadName, UploadService, type UploadedFile } from "../server/uploads.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile); const fake = resolve("scripts/fixtures/fake-pi.mjs");
async function temp() { return realpath(await mkdtemp(join(tmpdir(), "pi-desk-uploads-"))); }
function chunkedUpload(url: string, token: string, size: number): Promise<number> {
  return new Promise((done, reject) => {
    const req = request(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } }, (res) => { res.resume(); res.on("end", () => done(res.statusCode!)); });
    req.on("error", reject);
    void (async () => { const bytes = Buffer.alloc(65536); for (let sent = 0; sent < size; sent += bytes.length) if (!req.write(bytes.subarray(0, Math.min(bytes.length, size - sent)))) await once(req, "drain"); req.end(); })().catch(reject);
  });
}

test("上传名防路径/控制字符，图片类型按字节而非伪造后缀；SVG 不直接发给视觉模型", () => {
  assert.equal(uploadName("截图 with space.png"), "截图 with space.png");
  for (const name of ["", ".", "..", "../x", "folder/x", "folder\\x", "x\n.txt", "x\0.txt", "a".repeat(221)]) assert.throws(() => uploadName(name));
  assert.equal(imageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(imageMime(Buffer.from([255, 216, 255])), "image/jpeg");
  assert.equal(imageMime(Buffer.from("GIF89a")), "image/gif");
  assert.equal(imageMime(Buffer.from("RIFF1234WEBP")), "image/webp");
  assert.equal(imageMime(Buffer.from("<svg><script>fixture</script></svg>")), undefined);
  assert.equal(imageMime(Buffer.from("not an image")), undefined);
});

test("鉴权原始字节上传、普通/已打开项目约束、唯一文件名和 Git info/exclude 保留且只追加一次", async () => {
  const root = await temp(); await exec("git", ["init", "-q", root]);
  const exclude = join(root, ".git", "info", "exclude"); await writeFile(exclude, "# fictional fixture\nkeep-fixture");
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd) => new PiProcess(cwd, { binary: process.execPath, args: [fake] }) });
  const desk = createDeskServer({ pool }); let client: DeskClient | undefined;
  const url = (name: string, cwd = root) => `${BASE_URL}/api/upload?${new URLSearchParams({ cwd, name })}`;
  const body = Buffer.from("fixture 汉字\0raw bytes");
  try {
    await desk.listen(); const headers = { Authorization: `Bearer ${desk.auth.token}` };
    assert.equal((await fetch(url("plain.bin"), { method: "POST", body })).status, 401);
    assert.equal((await fetch(url("plain.bin"), { method: "POST", headers, body })).status, 403);
    client = new DeskClient(desk.auth.launchUrl); await client.ready; await client.open(root);
    assert.equal((await fetch(url("../escape"), { method: "POST", headers, body })).status, 400);
    const results = await Promise.all([1, 2].map(async () => {
      const response = await fetch(url("plain with space.bin"), { method: "POST", headers, body }); assert.equal(response.status, 200);
      return await response.json() as UploadedFile;
    }));
    assert.notEqual(results[0].path, results[1].path);
    for (const result of results) { assert.match(result.path, /^\.pi-desk\/uploads\/\d+-[\da-f-]+-plain with space\.bin$/); assert.equal(result.size, body.length); assert.deepEqual(await readFile(join(root, result.path)), body); assert.equal((await stat(join(root, result.path))).mode & 0o777, 0o600); }
    const text = await readFile(exclude, "utf8"); assert.equal(text, "# fictional fixture\nkeep-fixture\n.pi-desk/\n");
    assert.equal((await exec("git", ["check-ignore", results[0].path], { cwd: root })).stdout.trim(), results[0].path);
    await exec("git", ["-c", "user.name=pi desk fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"], { cwd: root });
    const worktree = join(root, "fixture-worktree"); await exec("git", ["worktree", "add", "--detach", worktree, "HEAD"], { cwd: root }); await client.open(worktree);
    const worktreeResponse = await fetch(url("worktree.bin", worktree), { method: "POST", headers, body }); assert.equal(worktreeResponse.status, 200);
    const worktreeFile = await worktreeResponse.json() as UploadedFile;
    assert.equal((await exec("git", ["check-ignore", worktreeFile.path], { cwd: worktree })).stdout.trim(), worktreeFile.path);
    assert.equal(await readFile(exclude, "utf8"), text, "worktree 使用同一个排除文件，不重复追加");
    const service = new FileService(); service.register(root); const uploads = new UploadService(service);
    const prompt = await uploads.prompt(root, { type: "prompt", message: "总结", attachments: [{ kind: "upload", path: results[0].path }] });
    assert.equal(prompt.message, `总结\n\n附件：${results[0].path}`); assert.equal(prompt.attachments, undefined); assert.equal(prompt.images, undefined);
  } finally { client?.close(); await desk.close(); await exec("trash", [root]); }
});

test("50MB 真正流式上限、超限未完成文件移到废纸篓，上传目录软链接不能写到项目外", async () => {
  const root = await temp(); const project = join(root, "project"); const external = join(root, "external"); await mkdir(project); await mkdir(external);
  const partials: string[] = [];
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd) => new PiProcess(cwd, { binary: process.execPath, args: [fake] }) });
  const desk = createDeskServer({ pool, trash: async (path) => { partials.push(path); await exec("trash", [path]); } }); let client: DeskClient | undefined;
  const url = `${BASE_URL}/api/upload?${new URLSearchParams({ cwd: project, name: "large.bin" })}`;
  try {
    await desk.listen(); client = new DeskClient(desk.auth.launchUrl); await client.ready; await client.open(project);
    assert.equal(await chunkedUpload(url, desk.auth.token, MAX_FILE), 200, "刚好 50MB 可上传");
    assert.equal(await chunkedUpload(url, desk.auth.token, MAX_FILE + 1), 413);
    assert.equal(partials.length, 1); await assert.rejects(stat(partials[0]), { code: "ENOENT" });
    assert.equal((await readdir(join(project, ".pi-desk", "uploads"))).length, 1);
    const linked = join(root, "linked-project"); await mkdir(linked); await symlink(external, join(linked, ".pi-desk")); await client.open(linked);
    const response = await fetch(`${BASE_URL}/api/upload?${new URLSearchParams({ cwd: linked, name: "escape.bin" })}`, { method: "POST", headers: { Authorization: `Bearer ${desk.auth.token}` }, body: "fixture" });
    assert.equal(response.status, 403); assert.deepEqual(await readdir(external), []);
  } finally { client?.close(); await desk.close(); await exec("trash", [root]); }
});

test("附件引用校验与视觉输入保留原始字节；项目文件标签只变路径，不误转图片或读项目外", async () => {
  const root = await temp(); const service = new FileService(); service.register(root); const uploads = new UploadService(service);
  const path = ".pi-desk/uploads/fixture.png"; const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  try {
    await mkdir(join(root, ".pi-desk", "uploads"), { recursive: true }); await writeFile(join(root, path), png); await writeFile(join(root, "App.tsx"), "// fictional fixture");
    const command = await uploads.prompt(root, { type: "prompt", message: "图里是什么", attachments: [{ kind: "upload", path }, { kind: "path", path: "App.tsx" }] });
    assert.equal(command.message, `图里是什么\n\n附件：${path}\n引用文件：App.tsx`);
    assert.deepEqual(command.images, [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }]);
    assert.equal(command.attachments, undefined);
    for (const attachments of [[{ kind: "upload", path: "App.tsx" }], [{ kind: "path", path: "../escape" }], [{ kind: "wrong", path }], [{ kind: "upload", path: ".env" }]]) await assert.rejects(uploads.prompt(root, { type: "prompt", message: "test", attachments }));
    await assert.rejects(uploads.prompt(root, { type: "prompt", message: "test", attachments: Array.from({ length: 13 }, () => ({ kind: "upload", path })) }), /最多 12/);
    await assert.rejects(uploads.prompt(root, { type: "set_model", message: "test", attachments: [] }), /随消息/);
  } finally { await exec("trash", [root]); }
});
