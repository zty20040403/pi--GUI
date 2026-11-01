import type { PreviewProps } from "../../api/files";
import { useBlobUrl, useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function PdfPreview(props: PreviewProps & { office?: boolean }) {
  const { data, error } = useResource(props, false, props.office ? "office" : "file"); const url = useBlobUrl(data);
  if (!url) return <PreviewStatus error={error} />;
  return <iframe className="document-frame" title={`PDF 预览 ${props.file.name}`} src={url} referrerPolicy="no-referrer" />;
}
