import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRows, foldRows } from "../shared/diff-view.js";
test("统一 diff 的新旧行号及并排替换行正确，不将补丁标点当结构", () => {
  const before = "keep\n--- literal\nold\nlast\n"; const after = "keep\n+++ literal\nnew\nextra\nlast\n";
  const rows = diffRows(before, after, false)!;
  assert.deepEqual(rows.map(({ left }) => [left?.kind, left?.old, left?.next, left?.text]), [["context", 1, 1, "keep"], ["removed", 2, undefined, "--- literal"], ["removed", 3, undefined, "old"], ["added", undefined, 2, "+++ literal"], ["added", undefined, 3, "new"], ["added", undefined, 4, "extra"], ["context", 4, 5, "last"]]);
  const split = diffRows(before, after, true)!; assert.equal(split.length, 5); assert.equal(split[3].left, undefined); assert.equal(split[3].right?.text, "extra"); assert.equal(split[4].left?.old, 4); assert.equal(split[4].right?.next, 5);
});
test("长上下文折叠展开不丢行，尾部无换行和 CRLF 不混淆，超大行数降级", () => {
  const prefix = Array.from({ length: 30 }, (_, i) => `same ${i}\n`).join(""); const rows = diffRows(prefix + "before\n", prefix + "after\n", false)!;
  const folded = foldRows(rows, new Set()); const fold = folded[0]; assert.equal(fold.kind, "fold"); if (fold.kind !== "fold") return;
  assert.equal(fold.end - fold.start, 27); const expanded = foldRows(rows, new Set([fold.id])); assert.equal(expanded.length, 32); assert.ok(expanded.every((row) => row.kind === "line"));
  const eol = diffRows("same", "same\n", false)!; assert.equal(eol[0].left?.ending, "none"); assert.equal(eol[1].left?.ending, "lf");
  const crlf = diffRows("same\r\n", "other\r\n", false)!; assert.equal(crlf[0].left?.text, "same"); assert.equal(crlf[0].left?.ending, "crlf");
  assert.equal(diffRows("\n".repeat(40001), "x", false), undefined);
});
