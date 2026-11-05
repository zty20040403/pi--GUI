import type { Processor } from "unified";
import type { Construct, Extension as SyntaxExtension, State } from "micromark-util-types";
import type { Extension } from "mdast-util-from-markdown";

declare module "micromark-util-types" {
  interface TokenTypeMap { deskLatex: "deskLatex"; deskLatexMarker: "deskLatexMarker"; deskLatexData: "deskLatexData" }
}

// 真正的 Markdown 语法扩展，不做全局替换：代码、链接地址、转义的反斜杠不会被误改。
// 只有闭合的 \(...\)、\[...\] 才生效，半截公式不向 KaTeX 提交无效片段。
const lineEnding = (code: number | null) => code === -5 || code === -4 || code === -3;
const latex: Construct = {
  name: "deskLatex",
  tokenize(effects, ok, nok) {
    let closing: number;
    const pair: Construct = { partial: true, tokenize(effects, ok, nok) {
      return (code) => { effects.enter("deskLatexMarker"); effects.consume(code); return (code) => {
        if (code !== closing) return nok(code); effects.consume(code); effects.exit("deskLatexMarker"); return ok;
      }; };
    } };
    const start: State = (code) => { effects.enter("deskLatex"); effects.enter("deskLatexMarker"); effects.consume(code); return open; };
    const open: State = (code) => {
      if (code !== 40 && code !== 91) return nok(code);
      closing = code === 40 ? 41 : 93; effects.consume(code); effects.exit("deskLatexMarker"); return between;
    };
    const between: State = (code) => {
      if (code === null) return nok(code);
      if (lineEnding(code)) { effects.enter("lineEnding"); effects.consume(code); effects.exit("lineEnding"); return between; }
      if (code === 92) return effects.check(pair, close, escape)(code);
      effects.enter("deskLatexData"); return body(code);
    };
    const body: State = (code) => {
      if (code === null || code === 92 || lineEnding(code)) { effects.exit("deskLatexData"); return between(code); }
      effects.consume(code); return body;
    };
    const escape: State = (code) => { effects.enter("deskLatexData"); effects.consume(code); return escaped; };
    const escaped: State = (code) => {
      if (code === null || lineEnding(code)) { effects.exit("deskLatexData"); return between(code); }
      effects.consume(code); return body;
    };
    const close: State = (code) => { effects.enter("deskLatexMarker"); effects.consume(code); return end; };
    const end: State = (code) => { effects.consume(code); effects.exit("deskLatexMarker"); effects.exit("deskLatex"); return ok; };
    return start;
  },
};
const fromLatex: Extension = {
  enter: { deskLatex(token) {
    this.enter({ type: "inlineMath", value: "", data: { hName: "code",
      hProperties: { className: ["language-math", this.sliceSerialize(token).startsWith("\\[") ? "math-display" : "math-inline"] },
      hChildren: [],
    } }, token);
    this.buffer();
  } },
  exit: {
    deskLatexData(token) { this.config.enter.data.call(this, token); this.config.exit.data.call(this, token); },
    deskLatex(token) {
      const value = this.resume(); const node = this.stack[this.stack.length - 1];
      if (node.type === "inlineMath") { node.value = value; node.data!.hChildren = [{ type: "text", value }]; }
      this.exit(token);
    },
  },
};
export default function remarkLatex(this: Processor) {
  const data = this.data() as { micromarkExtensions?: SyntaxExtension[]; fromMarkdownExtensions?: Extension[] };
  (data.micromarkExtensions ??= []).push({ text: { 92: latex } });
  (data.fromMarkdownExtensions ??= []).push(fromLatex);
}
