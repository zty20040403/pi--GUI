import { useMemo, useState } from "react";
import Papa from "papaparse";
import { TEXT_LIMIT, type PreviewProps } from "../../api/files";
import { useBlobText, useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function CsvPreview(props: PreviewProps) {
  const { data, error } = useResource(props, true); const text = useBlobText(data); const [header, setHeader] = useState(true);
  const result = useMemo(() => text === undefined ? undefined : Papa.parse<string[]>(text, { delimiter: props.file.name.endsWith(".tsv") ? "\t" : "", skipEmptyLines: true, preview: 1001 }), [text, props.file.name]);
  if (!result) return <PreviewStatus error={error} />;
  const rows = result.data; const columns = Math.min(100, Math.max(...rows.map((row) => row.length), 0));
  return <div className="table-preview"><div className="preview-options"><label><input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />首行作为表头</label><span>{rows.length} 行</span></div>
    {(props.file.size > TEXT_LIMIT || result.meta.truncated || columns === 100) && <p className="preview-notice">只读取前 1 MB，最多显示 1000 行、100 列。</p>}
    {result.errors.length > 0 && <p className="preview-notice">部分行格式不一致，以下按可读取内容预览。</p>}
    <div className="table-scroll"><table><thead><tr>{Array.from({ length: columns }, (_, index) => <th key={index}>{header ? rows[0]?.[index] : `列 ${index + 1}`}</th>)}</tr></thead><tbody>{rows.slice(header ? 1 : 0, 1001).map((row, index) => <tr key={index}>{Array.from({ length: columns }, (_, column) => <td key={column}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table></div>
  </div>;
}
