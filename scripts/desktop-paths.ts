import { homedir } from "node:os";
import { join } from "node:path";
// 裸 App 不放 Desktop / Documents 等可能被同步服务写入 FinderInfo 的目录。
// release 只存封装好的 dmg / zip；本地运行与验收使用同一份已签名 App。
export const macBuildDirectory = join(homedir(), "Library/Caches/pi-desk/build");
export const macAppPath = join(macBuildDirectory, "pi desk.app");
