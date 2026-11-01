// 在解析 Office ZIP 前限制中央目录声明的展开大小，拒绝 ZIP64/分卷和明显的压缩炸弹。
export function checkDocumentZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer); let end = -1;
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === buffer.byteLength) { end = offset; break; }
  }
  if (end < 0) throw new Error("文档不是可读取的 Office ZIP 文件");
  const count = view.getUint16(end + 10, true); const size = view.getUint32(end + 12, true); let offset = view.getUint32(end + 16, true); let total = 0;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > 5000 || offset === 0xffffffff || offset + size > end) throw new Error("文档过于复杂、分卷或超大，请用默认软件打开");
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("文档 ZIP 目录损坏");
    total += view.getUint32(offset + 24, true);
    if (total > 64 * 1024 * 1024) throw new Error("文档展开后超过 64 MB，请用默认软件打开");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}
