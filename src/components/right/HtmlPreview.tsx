import { useEffect, useState } from "react";
import { TEXT_LIMIT, type PreviewProps } from "../../api/files";
import { useBlobText, useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function HtmlPreview(props: PreviewProps) {
  const { data, error } = useResource(props, true); const html = useBlobText(data); const [scripts, setScripts] = useState(false);
  useEffect(() => setScripts(false), [data]);
  if (html === undefined) return <PreviewStatus error={error} />;
  const policy = `default-src 'none'; script-src ${scripts ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; base-uri 'none'; form-action 'none'`;
  return <div className="html-preview"><div className="preview-options"><label><input type="checkbox" checked={scripts} onChange={(event) => setScripts(event.target.checked)} />允许运行脚本</label></div>
    <p className="preview-notice">{scripts ? "只对可信网页开启。脚本只在隔离预览里运行，不能访问主页面、口令或后台接口。" : "脚本默认禁用；预览不允许外部请求、表单提交或访问主页面。"}</p>
    {props.file.size > TEXT_LIMIT && <p className="preview-notice">网页超过 1 MB，只预览前 1 MB。</p>}
    <iframe key={String(scripts)} className="document-frame" title={`HTML 预览 ${props.file.name}`} sandbox={scripts ? "allow-scripts" : ""} referrerPolicy="no-referrer" srcDoc={`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${html}`} />
  </div>;
}
