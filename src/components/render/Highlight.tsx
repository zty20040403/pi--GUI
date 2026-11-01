import { Fragment, useEffect, useState } from "react";
import { createHighlighter, bundledLanguages, type BundledLanguage } from "shiki";
const engine = createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
export async function highlighted(code: string, language: string) {
  const highlighter = await engine;
  const lang = Object.hasOwn(bundledLanguages, language) ? language as BundledLanguage : "text";
  if (lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage(lang);
  return highlighter.codeToHtml(code, { lang, themes: { light: "github-light", dark: "github-dark" } });
}
export default function Highlight({ code, language, lines = false }: { code: string; language: string; lines?: boolean }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let active = true; setHtml("");
    // 极大的代码仍完整显示已读取的文本，避免语法分析卡住窗口。
    if (code.length <= 200000) void highlighted(code, language).then((value) => { if (active) setHtml(value); }, () => {});
    return () => { active = false; };
  }, [code, language]);
  return <div className={`syntax ${lines ? "line-numbers" : ""}`} data-highlighted={!!html}>
    {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre><code>{lines ? code.split("\n").map((line, index) => <Fragment key={index}><span className="line">{line || " "}</span>{"\n"}</Fragment>) : code}</code></pre>}
    {code.length > 200000 && <p className="preview-notice">代码较长，使用纯文本显示，避免窗口卡顿。</p>}
  </div>;
}
