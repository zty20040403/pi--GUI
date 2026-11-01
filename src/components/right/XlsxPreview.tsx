import { useEffect, useState } from "react";
import type { PreviewProps } from "../../api/files";
import type { SheetData } from "./document.worker";
import { parseDocument } from "./document";
import { useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function XlsxPreview(props: PreviewProps) {
  const { data, error } = useResource(props); const [sheets, setSheets] = useState<SheetData[]>(); const [failure, setFailure] = useState(""); const [index, setIndex] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setSheets(undefined); setFailure(""); setIndex(0);
    if (data) void data.arrayBuffer().then((buffer) => parseDocument<SheetData[]>("xlsx", buffer, abort.signal)).then((sheets) => { if (!abort.signal.aborted) setSheets(sheets); }, (error: Error) => { if (!abort.signal.aborted) setFailure(error.message); });
    return () => abort.abort();
  }, [data]);
  if (!sheets) return <PreviewStatus error={error || failure} />;
  const sheet = sheets[index];
  if (!sheet) return <p className="preview-notice">这个工作簿没有工作表。</p>;
  return <div className="table-preview"><div className="sheet-tabs" role="tablist" aria-label="工作表">{sheets.map((sheet, number) => <button role="tab" aria-selected={number === index} key={sheet.name} onClick={() => setIndex(number)}>{sheet.name}</button>)}</div>
    <p className="preview-notice">只读数值预览；公式显示文件保存的结果，不在这里重新计算。{sheet.truncated && " 只显示前 30 个表、1000 行、100 列。"}</p>
    <div className="table-scroll"><table><tbody>{sheet.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => index === 0 ? <th key={column}>{cell}</th> : <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>
  </div>;
}
