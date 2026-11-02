import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentRefs, attachmentScope, shortPath, treeDrag, type Attachment } from "../src/api/attachments.js";
test("附件按项目+对话隔离，只提交已上传成功的引用，不把缩略图和文件字节塞进 WS", () => {
  assert.notEqual(attachmentScope("/project", "a"), attachmentScope("/project", "b"));
  assert.notEqual(attachmentScope("/project", "a"), attachmentScope("/other", "a"));
  const base: Attachment = { id: "one", cwd: "/project", kind: "upload", name: "fixture.png", size: 100, status: "ready", path: ".pi-desk/uploads/fixture.png", preview: "blob:fixture" };
  const refs = attachmentRefs([base, { ...base, id: "two", status: "uploading" }, { ...base, id: "three", status: "error" }, { ...base, id: "four", kind: "path", path: "/project/src/App.tsx" }]);
  assert.deepEqual(refs, [{ kind: "upload", path: ".pi-desk/uploads/fixture.png" }, { kind: "path", path: "/project/src/App.tsx" }]);
  assert.equal(JSON.stringify(refs).includes("blob:"), false);
});
test("文件树拖入路径直接引用，保留空格，拒绝错项目/相似前缀/越界/坏数据", () => {
  const cwd = "/project"; const file = { cwd, path: "/project/src/App with space.tsx", name: "App with space.tsx" };
  assert.deepEqual(treeDrag(JSON.stringify(file), cwd), file);
  assert.equal(shortPath(cwd, file.path), "src/App with space.tsx"); assert.equal(shortPath("/", "/src/App.tsx"), "src/App.tsx");
  for (const data of ["not json", "null", JSON.stringify({ ...file, cwd: "/other" }), JSON.stringify({ ...file, path: "/project-evil/file" }), JSON.stringify({ ...file, path: "/project/../secret" }), JSON.stringify({ ...file, path: "/project/x\0" })]) assert.equal(treeDrag(data, cwd), undefined);
});
