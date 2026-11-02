import { File, FileArchive, FileCode, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from "lucide-react";

const BY_EXTENSION: Record<string, LucideIcon> = {
  md: FileText, markdown: FileText, txt: FileText, pdf: FileText, doc: FileText, docx: FileText, rtf: FileText,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage, bmp: FileImage, ico: FileImage,
  csv: FileSpreadsheet, tsv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet,
  mp3: FileMusic, wav: FileMusic, m4a: FileMusic, flac: FileMusic,
  mp4: FileVideo, mov: FileVideo, webm: FileVideo, mkv: FileVideo,
  zip: FileArchive, gz: FileArchive, tar: FileArchive, tgz: FileArchive, "7z": FileArchive, dmg: FileArchive,
};
const CODE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "zsh", "nix", "toml", "yaml", "yml", "html", "htm", "css", "scss", "sql", "lua", "swift", "kt", "vue", "svelte", "xml"]);

// 按后缀给文件树和标签挑图标，只为了扫一眼认出类型。
export function fileIcon(name: string): LucideIcon {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[extension] ?? (CODE.has(extension) ? FileCode : File);
}
