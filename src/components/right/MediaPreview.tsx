import { useEffect, useState } from "react";
import type { PreviewProps } from "../../api/files";
import { useBlobUrl, useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function MediaPreview(props: PreviewProps) {
  const { data, error } = useResource(props); const url = useBlobUrl(data); const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <PreviewStatus error={error || (failed ? "浏览器不支持这个音视频编码，请用默认软件打开" : undefined)} />;
  return <div className="media-preview">{props.file.mime.startsWith("video/") ? <video src={url} controls preload="metadata" onError={() => setFailed(true)} /> : <audio src={url} controls preload="metadata" onError={() => setFailed(true)} />}</div>;
}
