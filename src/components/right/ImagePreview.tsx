import { useEffect, useRef, useState } from "react";
import type { PreviewProps } from "../../api/files";
import { useBlobUrl, useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function ImagePreview(props: PreviewProps) {
  const { data, error } = useResource(props); const url = useBlobUrl(data); const [scale, setScale] = useState(1); const [pan, setPan] = useState({ x: 0, y: 0 }); const [failed, setFailed] = useState(false);
  const drag = useRef({ x: 0, y: 0, px: 0, py: 0 });
  useEffect(() => { setFailed(false); setPan({ x: 0, y: 0 }); setScale(1); }, [url]);
  if (!url || failed) return <PreviewStatus error={error || (failed ? "无法解码这张图片，请用默认软件打开" : undefined)} />;
  return <div className="image-preview"><div className="preview-options"><span>{Math.round(scale * 100)}%</span><div><button aria-label="缩小图片" onClick={() => setScale((value) => Math.max(.1, value / 1.25))}>−</button><button aria-label="放大图片" onClick={() => setScale((value) => Math.min(8, value * 1.25))}>＋</button><button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>适应宽度</button></div></div>
    <div className="image-viewport" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }; }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPan({ x: drag.current.px + event.clientX - drag.current.x, y: drag.current.py + event.clientY - drag.current.y }); }}>
      <img src={url} alt={props.file.name} draggable={false} onError={() => setFailed(true)} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})` }} />
    </div>
  </div>;
}
