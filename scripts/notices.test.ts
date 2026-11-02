import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { NoticeFilter, noticeFingerprint, DEFAULT_NOTICE } from "../server/notices.js";
import { AppSettings } from "../server/settings.js";
import { createDeskServer } from "../server/index.js";
import { BASE_URL } from "../server/auth.js";
const exec = promisify(execFile);
test("插件名 + 去掉路径数字后的文字作为指纹；ccstyle 仅这一类默认隐藏", () => {
  assert.equal(noticeFingerprint("fixture: 已检查 /tmp/one/a.ts 的 1 项").id, noticeFingerprint("fixture: 已检查 C:\\two\\b.ts 的 99 项").id);
  assert.notEqual(noticeFingerprint("one: message 1").id, noticeFingerprint("two: message 1").id);
  assert.notEqual(noticeFingerprint("ccstyle: genuine failure").id, DEFAULT_NOTICE.id);
  assert.equal(noticeFingerprint("ccstyle: write 工具已被 /private/new.ts 占用，富 diff 已让位").id, DEFAULT_NOTICE.id);
});
test("提醒设置鉴权/非法指纹拒绝、默认恢复可持久化、App 映射保持不变", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-desk-notices-")); const settings = new AppSettings(join(root, "settings.json")); await settings.update(() => ({ projectMappings: { "/fixture-old": "/fixture-new" } }));
  const filter = new NoticeFilter(settings); await filter.load();
  const notice = filter.observe("fixture: 已检查 /private/fixture/a.ts 的 3 项");
  try {
    await filter.change(notice.id, true); assert.equal(filter.observe("fixture: 已检查 /another/a.ts 的 49 项").hidden, true);
    assert.equal(filter.observe("elsewhere: 已检查 /another/a.ts 的 49 项").hidden, false);
    await filter.change(DEFAULT_NOTICE.id, false);
    const restored = new NoticeFilter(settings); await restored.load(); assert.equal(restored.observe("ccstyle: write 工具已被 /example 占用，富 diff 已让位").hidden, false); assert.equal(restored.observe("fixture: 已检查 /other/b.ts 的 42 项").hidden, true);
    assert.ok(!(await readFile(settings.path, "utf8")).includes("/private/fixture")); assert.equal((await settings.mappings())["/fixture-old"], "/fixture-new");
    const desk = createDeskServer({ appSettings: settings, sessionsDir: root });
    try {
      await desk.listen(); const headers = { Authorization: `Bearer ${desk.auth.token}`, "Content-Type": "application/json" };
      assert.equal((await fetch(`${BASE_URL}/api/notices`, { method: "POST", body: "{}" })).status, 401);
      assert.equal((await fetch(`${BASE_URL}/api/notices`, { method: "POST", headers, body: JSON.stringify({ id: "invalid", hidden: true }) })).status, 400);
      const response = await fetch(`${BASE_URL}/api/notices`, { method: "POST", headers, body: JSON.stringify({ id: notice.id, hidden: false }) }); assert.equal(response.status, 200); assert.deepEqual((await response.json()).hidden, []);
    } finally { await desk.close(); }
  } finally { await exec("trash", [root]); }
});
