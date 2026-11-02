import { resolve } from "node:path";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { logText } from "../server/privacy.js";
// 验收专用：普通后台 + 真正 pi + 多几个只测界面的命令，不替换聊天工具。
const pool = new PiPool({ createProcess: (cwd, args) => new PiProcess(cwd, { args: [...args, "-e", resolve("scripts/fixtures/ui-extension.ts")] }) });
const desk = createDeskServer({ pool }); let closing = false;
const close = () => { if (closing) return; closing = true; void desk.close(); };
process.once("SIGINT", close); process.once("SIGTERM", close);
void desk.listen().then(() => { console.log(`pi desk 验收后台已启动：${desk.auth.launchUrl}`); }, async (error: Error) => { await desk.close(); console.error(logText(error.message)); process.exitCode = 1; });
