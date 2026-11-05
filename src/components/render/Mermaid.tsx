import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DOMPurify from "dompurify";
let queue = Promise.resolve();
export default function Mermaid({ code }: { code: string }) {
  const [image, setImage] = useState<{ src: string; code: string; dark: boolean }>(); const [error, setError] = useState("");
  const urls = useRef(new Set<string>());
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => { const query = matchMedia("(prefers-color-scheme: dark)"); const change = () => setDark(query.matches); query.addEventListener("change", change); return () => query.removeEventListener("change", change); }, []);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  useEffect(() => () => { if (image) { URL.revokeObjectURL(image.src); urls.current.delete(image.src); } }, [image?.src]);
  useEffect(() => {
    let active = true;
    // 不在每个 token 上绘图，也不先清空已显示的 SVG。新图完成解码后一次替换。
    const timer = setTimeout(() => {
      const id = `diagram-${crypto.randomUUID()}`;
      queue = queue.catch(() => {}).then(async () => {
        if (!active) return;
        let url = ""; let published = false;
        try {
          if (code.length > 20000) throw new Error("too large");
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, maxTextSize: 20000, maxEdges: 1000,
            theme: dark ? "dark" : "neutral", flowchart: { htmlLabels: false } });
          const { svg } = await mermaid.render(id, code);
          const safe = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject", "script"] });
          if (!active) return;
          const parsed = new DOMParser().parseFromString(safe, "image/svg+xml");
          const element = parsed.documentElement; const box = element.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
          if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) { element.setAttribute("width", String(box[2])); element.setAttribute("height", String(box[3])); }
          // SVG 仍只作为图片，不能向页面注入可执行内容。
          url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" })); urls.current.add(url);
          const preload = new Image(); preload.src = url; await preload.decode();
          if (active) { published = true; setImage({ src: url, code, dark }); setError(""); }
        } catch { if (active) setError("图表尚不完整、语法不支持或过大；可以查看/复制源码。"); }
        finally {
          if (url && !published) { URL.revokeObjectURL(url); urls.current.delete(url); }
          document.getElementById(`d${id}`)?.remove();
        }
      });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [code, dark]);
  return <div className="mermaid-diagram" aria-busy={image ? image.code !== code || image.dark !== dark : !error} title={image && error ? `${error} 暂时保留上一版图表。` : undefined}>
    {image ? <img src={image.src} alt="Mermaid 图表" /> : error ? <p className="preview-notice">{error}</p> : <p className="muted">正在绘制图表…</p>}
  </div>;
}
