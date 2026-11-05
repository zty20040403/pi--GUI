import { Fragment, memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createHighlighter, bundledLanguages, type BundledLanguage, type ThemedToken } from "shiki";
let ready: Awaited<ReturnType<typeof createHighlighter>> | undefined;
const engine = createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }).then((value) => { ready = value; return value; });
const languageOf = (language: string) => Object.hasOwn(bundledLanguages, language) ? language as BundledLanguage : "text";
export async function highlighted(code: string, language: string) {
  const highlighter = await engine; const lang = languageOf(language);
  if (lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage(lang);
  return highlighter.codeToHtml(code, { lang, themes: { light: "github-light", dark: "github-dark" } });
}
export async function highlightTokens(code: string, language: string) {
  const highlighter = await engine; const lang = languageOf(language);
  if (lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage(lang);
  return highlighter.codeToTokens(code, { lang, themes: { light: "github-light", dark: "github-dark" } }).tokens;
}
function sameTokens(a?: ThemedToken[], b?: ThemedToken[]) {
  return a === b || !!a && !!b && a.length === b.length && a.every((token, i) => token.content === b[i].content && JSON.stringify(token.htmlStyle) === JSON.stringify(b[i].htmlStyle));
}
const CodeLine = memo(function CodeLine({ text, tokens }: { text: string; tokens?: ThemedToken[] }) {
  return <span className="line">{tokens?.length ? tokens.map((token, i) => <span key={i} className="syntax-token" style={Object.fromEntries(Object.entries(token.htmlStyle ?? {}).map(([key, value]) => [key.startsWith("--") ? key : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), value])) as CSSProperties}>{token.content}</span>) : text || " "}</span>;
}, (a, b) => a.text === b.text && sameTokens(a.tokens, b.tokens));

export default function Highlight({ code, language, lines = false }: { code: string; language: string; lines?: boolean }) {
  const lang = languageOf(language);
  const rows = useMemo(() => code.length > 200000 ? undefined : code.split(/\r?\n/, 10001), [code]);
  const tooLarge = !rows || rows.length > 10000;
  const available = !!ready && (lang === "text" || ready.getLoadedLanguages().includes(lang));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!tooLarge && !available) {
      void engine.then(async (value) => { if (lang !== "text" && !value.getLoadedLanguages().includes(lang)) await value.loadLanguage(lang); }).then(() => { if (active) setRevision((value) => value + 1); }, () => {});
    }
    return () => { active = false; };
  }, [lang, tooLarge, available]);
  const tokens = useMemo(() => {
    if (tooLarge || !ready || lang !== "text" && !ready.getLoadedLanguages().includes(lang)) return;
    try { return ready.codeToTokens(code, { lang, themes: { light: "github-light", dark: "github-dark" } }).tokens; } catch { return; }
  }, [code, lang, tooLarge, revision, available]);
  // 始终保留 pre/code 与行节点，绝不先清高亮、再用 innerHTML 替换整块内容。
  return <div className={`syntax ${lines ? "line-numbers" : ""}`} data-highlighted={!!tokens}>
    <pre><code>{tooLarge ? code : rows.map((text, index) => <Fragment key={index}><CodeLine text={text} tokens={tokens?.[index]} />{index < rows.length - 1 ? "\n" : null}</Fragment>)}</code></pre>
    {tooLarge && <p className="preview-notice">代码较长，使用纯文本显示，避免窗口卡顿。</p>}
  </div>;
}
