import { useEffect, useState } from "react";
export function MessageImage({ data, mime }: { data?: string; mime?: string }) {
  const [url, setUrl] = useState<string>(); const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false); setUrl(undefined);
    if (!data || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime ?? "")) { setFailed(true); return; }
    let object: string;
    try {
      const raw = atob(data); const bytes = new Uint8Array(raw.length); for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
      object = URL.createObjectURL(new Blob([bytes], { type: mime })); setUrl(object);
    } catch { setFailed(true); return; }
    return () => URL.revokeObjectURL(object);
  }, [data, mime]);
  return url && !failed ? <img className="message-image" loading="lazy" src={url} alt="发送给 pi 的图片附件" onError={() => setFailed(true)} /> : <p className="muted">{failed ? "[图片附件无法显示]" : "正在加载图片附件…"}</p>;
}
