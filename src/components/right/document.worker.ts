import { checkDocumentZip } from "../../api/zip";
export type SheetData = { name: string; rows: string[][]; truncated: boolean };
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value);
  const object = value as Record<string, any>;
  if (Array.isArray(object.richText)) return object.richText.map((part) => part.text).join("");
  if ("result" in object) return cellText(object.result);
  return String(object.text ?? object.error ?? (object.formula ? `=${object.formula}` : ""));
}
self.onmessage = async (event: MessageEvent<{ kind: "xlsx" | "docx"; buffer: ArrayBuffer }>) => {
  try {
    checkDocumentZip(event.data.buffer);
    if (event.data.kind === "docx") {
      const { default: mammoth } = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer: event.data.buffer }, { externalFileAccess: false, includeEmbeddedStyleMap: false });
      if (result.value.length > 10 * 1024 * 1024) throw new Error("文档输出过大");
      self.postMessage({ data: result.value });
    } else {
      const { default: ExcelJS } = await import("exceljs"); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(event.data.buffer);
      const sheets: SheetData[] = workbook.worksheets.slice(0, 30).map((sheet) => ({ name: sheet.name, truncated: sheet.rowCount > 1000 || sheet.columnCount > 100 || workbook.worksheets.length > 30,
        rows: Array.from({ length: Math.min(sheet.rowCount, 1000) }, (_, row) => Array.from({ length: Math.min(sheet.columnCount, 100) }, (_, column) => cellText(sheet.getRow(row + 1).getCell(column + 1).value))) }));
      self.postMessage({ data: sheets });
    }
  } catch { self.postMessage({ error: "文档格式损坏、过大或暂不支持，请用默认软件打开" }); }
};
