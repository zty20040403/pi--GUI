import { useEffect, useState } from "react";
import mermaid from "mermaid";
import DOMPurify from "dompurify";
let queue = Promise.resolve();
export default function Mermaid({ code }: { code: string }) {
  const [src, setSrc] = useState(""); const [error, setError] = useState("");
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => { const query = matchMedia("(prefers-color-scheme: dark)"); const change = () => setDark(query.matches); query.addEventListener("change", change); return () => query.removeEventListener("change", change); }, []);
  useEffect(() => {
    let active = true; let url = ""; setSrc(""); setError("");
    const id = `diagram-${crypto.randomUUID()}`;
    queue = queue.catch(() => {}).then(async () => {
      if (!active) return;
      try {
        if (code.length > 20000) throw new Error("too large");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, maxTextSize: 20000, maxEdges: 1000,
          theme: dark ? "dark" : "neutral", flowchart: { htmlLabels: false } });
        const { svg } = await mermaid.render(id, code);
        const safe = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject", "script"] });
        if (!active) return;
        // SVG 用图片显示：即使输入里夹了脚本，也不能变成页面里的可执行内容。
        const document = new DOMParser().parseFromString(safe, "image/svg+xml");
        const element = document.documentElement; const box = element.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
        if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) { element.setAttribute("width", String(box[2])); element.setAttribute("height", String(box[3])); }
        url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" })); setSrc(url);
      } catch { if (active) setError("图表尚不完整、语法不支持或过大；可以查看/复制源码。"); }
      finally { document.getElementById(`d${id}`)?.remove(); }
    });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [code, dark]);
  return <div className="mermaid-diagram">{src ? <img src={src} alt="Mermaid 图表" /> : error ? <p className="preview-notice">{error}</p> : <p className="muted">正在绘制图表…</p>}</div>;
}
