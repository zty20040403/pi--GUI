import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// 仅供 phase7-errors-server 的隔离验收，不加载用户扩展，不访问真实模型服务。
export default function failures(pi: ExtensionAPI) {
  const endpoint = process.env.PI_DESK_TEST_FAILURE_ENDPOINT;
  if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1") throw new Error("缺少本机隔离验收服务");
  pi.registerProvider("cliproxy", {
    baseUrl: endpoint, ["api" + "Key"]: "synthetic-wrong-credential", api: "openai-completions",
    models: [
      { id: "gpt-6-luna", name: "Luna · 隔离故障验收", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "no-reasoning-fixture", name: "不支持推理 · 隔离菜单验收", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ],
  });
  pi.registerCommand("desk-test-crash", { description: "只在合成测试中让本进程意外退出", handler: async () => { process.kill(process.pid, "SIGKILL"); } });
}
