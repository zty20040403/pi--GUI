import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
const resources = resolve("electron/resources"); const iconset = resolve(".pi-desk/icon.iconset");
await mkdir(iconset, { recursive: true }); const source = await readFile(join(resources, "icon.svg"), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true }); const images = new Map<number, Buffer>();
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const png = await page.evaluate(async ({ source, size }) => {
      const image = new Image(); image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = size; canvas.getContext("2d")!.drawImage(image, 0, 0, size, size); return canvas.toDataURL("image/png").split(",")[1];
    }, { source, size }); images.set(size, Buffer.from(png, "base64"));
  }
} finally { await browser.close(); }
for (const size of [16, 32, 128, 256, 512]) { await writeFile(join(iconset, `icon_${size}x${size}.png`), images.get(size)!); await writeFile(join(iconset, `icon_${size}x${size}@2x.png`), images.get(size * 2)!); }
await writeFile(join(resources, "icon.png"), images.get(1024)!);
await promisify(execFile)("iconutil", ["-c", "icns", "-o", join(resources, "icon.icns"), iconset]);
const sizes = [16, 32, 48, 64, 128, 256]; const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4); let offset = header.length;
for (const [index, size] of sizes.entries()) { const start = 6 + index * 16; const image = images.get(size)!; header[start] = header[start + 1] = size === 256 ? 0 : size; header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6); header.writeUInt32LE(image.length, start + 8); header.writeUInt32LE(offset, start + 12); offset += image.length; }
await writeFile(join(resources, "icon.ico"), Buffer.concat([header, ...sizes.map((size) => images.get(size)!)]));
console.log("图标已生成：RGBA PNG、macOS ICNS、Windows ICO；源文件为 electron/resources/icon.svg。");
