import { resolve, join } from "node:path";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { createDeskServer } from "../server/index.js";
import { AppSettings } from "../server/settings.js";
const root = process.env.PI_DESK_TEST_ROOT;
if (!root) throw new Error("必须提供合成验收目录");
const sessions = join(root, "sessions"); const settings = new AppSettings(join(root, "app/settings.json"));
const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd, args) => new PiProcess(cwd, {
  args: ["--offline", "-ne", "-ns", "-np", "--session-dir", join(sessions, "created"), ...args, "-e", resolve("scripts/fixtures/failure-extension.ts"), "-e", resolve("scripts/fixtures/ui-extension.ts"), "--model", "cliproxy/gpt-6-luna", "--thinking", "low"],
  env: { PI_CODING_AGENT_DIR: join(root, "agent"), PI_DESK_APP_SETTINGS_FILE: settings.path, PI_SESSIONS_DIR: sessions },
}) });
const desk = createDeskServer({ development: false, pool, sessionsDir: sessions, appSettings: settings });
await desk.listen(); console.log(`合成验收后台：${desk.auth.launchUrl}`);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { if (!closing) { closing = true; void desk.close(); } });
