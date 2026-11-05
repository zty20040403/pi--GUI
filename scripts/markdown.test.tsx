import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "../src/components/render/markdown-plugins.js";

function render(text: string) { return renderToStaticMarkup(createElement(ReactMarkdown, { skipHtml: true, remarkPlugins, rehypePlugins, children: text })); }
const count = (html: string, name = "katex") => (html.match(new RegExp(`class="${name}"`, "g")) ?? []).length;

test("美元与 LaTeX 四种分隔符、中文邻接、上下标、矩阵和换行", () => {
  const html = render(String.raw`中文 \(x_i^2+\frac{1}{2}\) 相邻，$y^2$。

\[
\begin{pmatrix}a & b \\ c & d\end{pmatrix}
\]

$$
\sum_{i=1}^n i = \frac{n(n+1)}{2}
$$`);
  assert.equal(count(html), 4); assert.equal(count(html, "katex-display"), 2);
  assert.ok(!html.includes("katex-error")); assert.ok(html.includes("<math"));
  assert.equal(count(render(String.raw`前文\[a_b+c_d\]后文`), "katex-display"), 1);
  assert.equal(count(render("\\( a +\n b \\)")), 1);
});

test("行内代码、围栏、缩进代码、转义、链接地址与原始 HTML 不被数学处理破坏", () => {
  for (const text of [String.raw`\`\(x_i\)\``.replaceAll("\\`", "`"), "```latex\n\\[x_i\\]\n```", "~~~txt\n\\(x_i\\)\n~~~", "    \\(x_i\\)", String.raw`\\(x_i\\)`]) {
    assert.equal(count(render(text)), 0, text);
  }
  assert.equal(count(render(String.raw`[文件](./file\(v1\).md)`)), 0);
  assert.ok(render(String.raw`[文件](./file\(v1\).md)`).includes('href="./file(v1).md"'));
  assert.equal(count(render(String.raw`> 列表中的 \(a_i*b_j\)
>
> \[
> x+y
> \]`)), 2);
  const html = render(String.raw`<script>alert(1)</script>

\(\href{javascript:alert(1)}{click}\) \(\includegraphics{https://example.invalid/test.png}\)`);
  assert.ok(!html.includes("<script")); assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes("<img"));
});

test("复杂 Markdown 每一个流式前缀均能安全解析，包括尚未闭合的显示公式", () => {
  const source = '```python\nprint("HIGHLIGHT")\n```\n\n```mermaid\nflowchart LR\nX-->Y\n```\n\n' + String.raw`行内一：\(E=mc^2\)。行内二：$x^2$。

\[
\frac{1}{2}+\frac{1}{2}=1
\]

$$
a^2+b^2=c^2
$$`;
  for (let end = 0; end <= source.length; end++) assert.doesNotThrow(() => render(source.slice(0, end)), `prefix ${end}: ${JSON.stringify(source.slice(0, end))}`);
});

test("流式半截公式只在闭合后渲染，代码中的相同前缀保持原样", () => {
  const source = String.raw`说明：\(\frac{x_i}{2}\)`;
  for (let end = 0; end < source.length; end++) assert.equal(count(render(source.slice(0, end))), 0);
  assert.equal(count(render(source)), 1);
  assert.equal(count(render(String.raw`\(x\\)y\)`)), 1, "双反斜杠不能误认作关闭符");
  assert.equal(count(render("`\\(x\\)` 然后 \\(y\\)")), 1);
});
