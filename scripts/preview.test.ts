import assert from "node:assert/strict";
import { test } from "node:test";
import { highlighted } from "../src/components/render/Highlight.js";
import { languageOf, localPath, previewKind, type FileInfo } from "../src/api/files.js";
import { fileReducer } from "../src/api/file-state.js";
import { checkDocumentZip } from "../src/api/zip.js";
const file = (name: string, extra: Partial<FileInfo> = {}): FileInfo => ({ cwd: "/project", path: `/project/${name}`, name, size: 1, mtime: 1, mime: "application/octet-stream", binary: false, tooLarge: false, ...extra });
test("预览分发优先限制大小/已知二进制格式，代码语言和文档相对路径正确", () => {
  assert.equal(previewKind(file("photo.png", { binary: true })), "image");
  assert.equal(previewKind(file("table.xlsx", { binary: true })), "xlsx");
  assert.equal(previewKind(file("page.md", { binary: true })), "binary");
  assert.equal(previewKind(file("photo.png", { tooLarge: true })), "large");
  assert.equal(previewKind(file("slides.pptx")), "office");
  assert.equal(languageOf("src/App.tsx"), "tsx");
  assert.equal(localPath("/project", "/project/docs/a.md", "../images/a%20b.png"), "/project/images/a b.png");
  assert.equal(localPath("/project", "/project/docs%#name/a.md", "image.png"), "/project/docs%#name/image.png");
  assert.throws(() => localPath("/project", undefined, "https://example.invalid/image.png"));
});
test("文件标签唯一、项目隔离、关闭/刷新/修改标记，不变 mtime 不重复更新", () => {
  const one = file("a.txt"); let state = fileReducer({}, { type: "open", file: one });
  state = fileReducer(state, { type: "open", file: one }); assert.equal(state[one.cwd].tabs.length, 1);
  const other = { ...one, cwd: "/other", path: "/other/a.txt" }; state = fileReducer(state, { type: "open", file: other });
  assert.equal(state[one.cwd].active, one.path); assert.equal(state[other.cwd].active, other.path);
  assert.equal(fileReducer(state, { type: "refresh", file: one }), state);
  state = fileReducer(state, { type: "refresh", file: { ...one, mtime: 2 }, changed: true }); assert.equal(state[one.cwd].versions[one.path], 1); assert.ok(state[one.cwd].changed[one.path]);
  state = fileReducer(state, { type: "close", cwd: one.cwd, path: one.path }); assert.equal(state[one.cwd].active, "tree");
});
test("Office ZIP 拒绝坏文件和声明过大展开体积", () => {
  assert.throws(() => checkDocumentZip(new ArrayBuffer(2)), /ZIP/);
  const buffer = new ArrayBuffer(68); const view = new DataView(buffer);
  view.setUint32(0, 0x02014b50, true); view.setUint32(24, 100 * 1024 * 1024, true);
  view.setUint32(46, 0x06054b50, true); view.setUint16(56, 1, true); view.setUint32(58, 46, true);
  assert.throws(() => checkDocumentZip(buffer), /64 MB/);
});
test("真实 Shiki 引擎按需加载语法，输出双色主题并转义恶意 HTML，未知语言安全降级", async () => {
  const html = await highlighted('const value = 42;\nconst unsafe = "<img onerror=alert(1)>";', "typescript");
  assert.match(html, /class="shiki/); assert.match(html, /--shiki-dark/);
  assert.ok(!html.includes("<img")); assert.match(html, /(?:&#x3C;|&lt;)img/);
  const plain = await highlighted("<script>not executed</script>", "__proto__");
  assert.ok(!plain.includes("<script>")); assert.match(plain, /(?:&#x3C;|&lt;)script/);
});
