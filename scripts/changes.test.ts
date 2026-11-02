import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ChangeCapture } from "../server/change-capture.js";
import { ChangeStore } from "../server/change-store.js";
import { captureFile, checkedChangePath } from "../server/change-files.js";
import { ChangeService } from "../server/changes.js";
import { gitReview, readonlyGitEnvironment } from "../server/change-git.js";
import { FileService } from "../server/files.js";
import type { PiProcess } from "../server/pi-process.js";
import { CHANGES_STATUS, CHANGE_FILE_LIMIT, mergeFiles, summarizeTurn, turnFiles } from "../shared/changes.js";
const exec = promisify(execFile);
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-changes-"))); const cwd = join(root, "project"); await mkdir(cwd); const store = new ChangeStore(join(root, "app/changes"));
  return { root, cwd, store, cleanup: () => exec("trash", [root]) };
}
test("每轮快照合并多次 edit/write，统计新建/修改/删除，原始快照刷新仍在", async () => {
  const f = await fixture(); const events: string[] = []; const capture = new ChangeCapture(f.store, (id) => events.push(id));
  try {
    await writeFile(join(f.cwd, "a.ts"), "const a = 1;\nunchanged\n"); await writeFile(join(f.cwd, "b.txt"), "remove me\n");
    capture.start("session-1", f.cwd, "anchor"); const id = capture.current!.id;
    await capture.before("edit-1", "edit", "a.ts", "anchor"); await writeFile(join(f.cwd, "a.ts"), "const a = 2;\nunchanged\n"); await capture.after("edit-1", false, "anchor");
    await capture.before("edit-2", "edit", "a.ts", "anchor"); await writeFile(join(f.cwd, "a.ts"), "const a = 3;\nunchanged\n"); await capture.after("edit-2", false, "anchor");
    await capture.before("new", "write", "new.md", "anchor", "parent"); await writeFile(join(f.cwd, "new.md"), "new\ntwo\n"); await capture.after("new", false, "anchor");
    await capture.before("delete", "edit", "b.txt", "anchor"); await exec("trash", [join(f.cwd, "b.txt")]); await capture.after("delete", false, "anchor");
    capture.assistant(42); await capture.finish("completed", "anchor");
    const saved = (await f.store.read("session-1", id))!; const summary = summarizeTurn(saved);
    assert.equal(summary.status, "completed"); assert.equal(summary.assistantTimestamp, 42); assert.equal(summary.files.length, 3);
    assert.deepEqual(summary.files.map((file) => [file.path, file.kind, file.added, file.removed]), [["a.ts", "modified", 1, 1], ["b.txt", "deleted", 0, 1], ["new.md", "added", 2, 0]]);
    assert.equal(turnFiles(saved)[0].before.kind, "text"); assert.equal(summary.tools.find((call) => call.id === "new")?.parentId, "parent"); assert.ok(events.length >= 5);
    assert.deepEqual(await new ChangeStore(f.store.root).summaries("session-1"), [summary]); assert.equal((await stat(join(f.store.root, "session-1", `${id}.json`))).mode & 0o777, 0o600);
    const files = new FileService(); files.register(f.cwd); let leaf = "anchor";
    const process = { request: async (cmd: any) => ({ success: true, data: cmd.type === "get_state" ? { sessionId: "session-1" } : { entries: [{ id: "anchor", parentId: null }, { id: "alternate", parentId: null }], leafId: leaf } }) } as unknown as PiProcess;
    const service = new ChangeService(f.store, files, async () => process);
    assert.equal((await service.index(f.cwd, "session-1")).turns.length, 1);
    assert.equal((await service.review(f.cwd, "session-1", "turn", id)).files.length, 3);
    const tool = await service.review(f.cwd, "session-1", "turn", id, "edit-2"); assert.equal(tool.files.length, 1); assert.deepEqual(tool.files[0].before, saved.calls[1].before);
    leaf = "alternate"; assert.equal((await service.index(f.cwd, "session-1")).turns.length, 0); await assert.rejects(service.review(f.cwd, "session-1", "turn", id), /当前分支/);
    await assert.rejects(service.index(f.cwd, "different-session"), /已经切换/);
    // 上次进程崩溃留下 running；即使新轮正在忙，也应显示历史已中断。
    leaf = "anchor"; saved.status = "running"; await f.store.save(saved);
    const ui = { statuses: { [CHANGES_STATUS]: JSON.stringify({ sessionId: "session-1", turnId: "new-turn" }) } }; Object.defineProperty(process, "uiSnapshot", { get: () => ui });
    const busyService = new ChangeService(f.store, files, async () => process, () => true);
    assert.equal((await busyService.index(f.cwd, "session-1")).turns[0].status, "interrupted");
    ui.statuses[CHANGES_STATUS] = JSON.stringify({ sessionId: "session-1", turnId: id }); assert.equal((await busyService.index(f.cwd, "session-1")).turns[0].status, "running");
  } finally { await f.cleanup(); }
});
test("快照边界：1MB、二进制、敏感/越界/符号链接、损坏存储，不读取超大正文", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, "big.txt"), "a".repeat(CHANGE_FILE_LIMIT + 1)); assert.equal((await captureFile(f.cwd, "big.txt")).kind, "omitted");
    await writeFile(join(f.cwd, "limit.txt"), "a".repeat(CHANGE_FILE_LIMIT)); assert.equal((await captureFile(f.cwd, "limit.txt")).kind, "text");
    await writeFile(join(f.cwd, "image.bin"), Buffer.from([1, 0, 2])); assert.deepEqual((await captureFile(f.cwd, "image.bin")).kind, "omitted");
    await writeFile(join(f.cwd, ".env"), "fixture-private\n"); await assert.rejects(captureFile(f.cwd, ".env"), /敏感/); await assert.rejects(checkedChangePath(f.cwd, "../outside.txt"));
    await symlink(join(f.root, "outside.txt"), join(f.cwd, "link.txt")); await assert.rejects(captureFile(f.cwd, "link.txt"), /符号链接/);
    assert.deepEqual(await captureFile(f.cwd, "not-yet/created.txt"), { kind: "missing" });
    const capture = new ChangeCapture(f.store, () => {}); capture.start("bounds", f.cwd, "entry");
    await capture.before("private", "write", ".env"); await capture.finish("completed", "entry");
    const [row] = await f.store.list("bounds"); assert.equal(row.calls.length, 0); assert.equal(row.warnings.length, 1); assert.ok(!JSON.stringify(row).includes("fixture-private"));
    await assert.rejects(f.store.read("../outside", "row"));
    await writeFile(join(f.store.root, "bounds", "broken.json"), "{}"); await assert.rejects(f.store.read("bounds", "broken"), /损坏/);
  } finally { await f.cleanup(); }
});
test("并发/失败/未完成不会假报完整差异，跨轮净改动标出捕获空隙", async () => {
  const f = await fixture(); const capture = new ChangeCapture(f.store, () => {});
  try {
    await writeFile(join(f.cwd, "same.txt"), "one\n"); capture.start("parallel", f.cwd, "anchor");
    await capture.before("failed", "edit", "same.txt"); await capture.after("failed", true); assert.equal(turnFiles(capture.current!).length, 0);
    await Promise.all([capture.before("a", "edit", "same.txt"), capture.before("b", "write", "same.txt")]);
    await writeFile(join(f.cwd, "same.txt"), "two\n"); await capture.after("a", false); await capture.after("b", false);
    assert.equal(turnFiles(capture.current!)[0].overlap, true);
    await capture.before("pending", "write", "incomplete.txt"); await capture.finish("interrupted", "anchor");
    const [first] = await f.store.list("parallel"); assert.equal(first.status, "interrupted"); assert.ok(first.warnings.some((warning) => warning.includes("不完整"))); assert.equal(turnFiles(first).length, 1);
    await writeFile(join(f.cwd, "same.txt"), "outside\n"); capture.start("parallel", f.cwd, "anchor");
    await capture.before("next", "edit", "same.txt"); await writeFile(join(f.cwd, "same.txt"), "three\n"); await capture.after("next", false); await capture.finish("aborted", "anchor");
    const rows = await f.store.list("parallel"); const merged = mergeFiles(rows.flatMap(turnFiles)); assert.equal(merged.length, 1); assert.equal(merged[0].gap, true);
    capture.start("parallel", f.cwd, "anchor");
    // 合成已有 255 次操作，两个并行 before 在路径 await 后只能再占一个名额。
    capture.current!.calls = Array.from({ length: 255 }, (_, index) => ({ ...structuredClone(first.calls[0]), id: `fixture-${index}` }));
    await Promise.all([capture.before("limit-a", "edit", "same.txt"), capture.before("limit-b", "edit", "same.txt")]);
    assert.equal(capture.current!.calls.length, 256); assert.ok(capture.current!.warnings.some((warning) => warning.includes("256"))); await capture.finish("interrupted", "anchor");
  } finally { await f.cleanup(); }
});
test("Git 未提交范围包含暂存/工作区/未跟踪/删除；不执行 filter/textconv，不改 index，子目录和空仓库正确", async () => {
  const f = await fixture(); const env = readonlyGitEnvironment(); const git = (args: string[]) => exec("git", args, { cwd: f.cwd, env });
  try {
    await git(["init", "-q"]); await mkdir(join(f.cwd, "sub"));
    for (const [name, text] of [["a.txt", "one\n"], ["b.txt", "deleted\n"], ["sub/nested.txt", "nested\n"], [".gitattributes", "*.txt filter=fixture diff=fixture\n"]]) await writeFile(join(f.cwd, name), text);
    await git(["add", "."]); await git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    await writeFile(join(f.cwd, "a.txt"), "staged\n"); await git(["add", "a.txt"]); await writeFile(join(f.cwd, "a.txt"), "working\n");
    await exec("trash", [join(f.cwd, "b.txt")]); await writeFile(join(f.cwd, "new.txt"), "new\n"); await writeFile(join(f.cwd, "sub/nested.txt"), "changed\n"); await writeFile(join(f.cwd, ".env"), "not-for-review\n");
    const sentinel = join(f.cwd, "filter-executed"); const dangerous = `sh -c 'echo unsafe > "${sentinel}"; cat'`;
    for (const key of ["filter.fixture.clean", "filter.fixture.smudge", "filter.fixture.process", "diff.fixture.textconv", "diff.external", "core.fsmonitor"]) await git(["config", key, dangerous]);
    await git(["config", "filter.fixture.required", "true"]);
    const index = await readFile(join(f.cwd, ".git/index")); const view = await gitReview(f.cwd);
    assert.deepEqual(view.files.map((file) => file.path).sort(), ["a.txt", "b.txt", "new.txt", "sub/nested.txt"]);
    assert.equal(view.files.find((file) => file.path === "b.txt")?.after.kind, "missing"); assert.ok(!JSON.stringify(view).includes("not-for-review"));
    assert.equal(await stat(sentinel).then(() => true, () => false), false); assert.deepEqual(await readFile(join(f.cwd, ".git/index")), index);
    const sub = await gitReview(join(f.cwd, "sub")); assert.deepEqual(sub.files.map((file) => file.path), ["nested.txt"]); assert.equal(sub.files[0].before.kind, "text");
    const empty = join(f.root, "empty"); await mkdir(empty); await exec("git", ["init", "-q"], { cwd: empty, env }); await writeFile(join(empty, "first.txt"), "first\n"); assert.equal((await gitReview(empty)).files[0].before.kind, "missing");
  } finally { await f.cleanup(); }
});
