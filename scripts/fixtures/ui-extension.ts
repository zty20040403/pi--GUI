import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// 只由 scripts/phase5-server.ts 加载；正常 npm start 不加载这些验收命令。
export default function uiFixture(pi: ExtensionAPI) {
  pi.registerCommand("desk-test-select", { description: "UI verification select", handler: async (_args, ctx) => { const value = await ctx.ui.select("选择验收", ["选项 A", "选项 B"]); ctx.ui.notify(`SELECT:${value ?? "CANCELLED"}`); } });
  pi.registerCommand("desk-test-confirm", { description: "UI verification confirm", handler: async (_args, ctx) => { const value = await ctx.ui.confirm("确认验收", "是否确认这个合成测试？"); ctx.ui.notify(`CONFIRM:${value}`); } });
  pi.registerCommand("desk-test-input", { description: "UI verification input", handler: async (_args, ctx) => { const value = await ctx.ui.input("输入验收", "写一行字"); ctx.ui.notify(`INPUT:${value ?? "CANCELLED"}`); } });
  pi.registerCommand("desk-test-editor", { description: "UI verification editor", handler: async (_args, ctx) => { const value = await ctx.ui.editor("编辑验收", "原有第一行\n原有第二行"); ctx.ui.notify(`EDITOR:${value ?? "CANCELLED"}`); } });
  pi.registerCommand("desk-test-queue", { description: "UI verification simultaneous dialogs", handler: async (_args, ctx) => { const values = await Promise.all([ctx.ui.input("排队问题一", "第一题"), ctx.ui.confirm("排队问题二", "第二题")]); ctx.ui.notify(`QUEUE:${values[0]}:${values[1]}`); } });
  pi.registerCommand("desk-test-widgets", { description: "UI verification all fire-and-forget", handler: async (_args, ctx) => {
    ctx.ui.notify("FIXTURE INFO", "info"); ctx.ui.notify("FIXTURE WARNING", "warning"); ctx.ui.notify("FIXTURE ERROR", "error");
    ctx.ui.setStatus("fixture-ui", "FIXTURE STATUS"); ctx.ui.setWidget("fixture-above", ["ABOVE EDITOR FIXTURE", "第二行"]); ctx.ui.setWidget("fixture-below", ["BELOW EDITOR FIXTURE"], { placement: "belowEditor" });
    ctx.ui.setTitle("FIXTURE WINDOW TITLE"); ctx.ui.setEditorText("FIXTURE PREFILL");
  } });
  pi.registerCommand("desk-test-notices", { description: "UI verification notice fingerprints", handler: async (args, ctx) => {
    const index = /^\d+$/.test(args) ? args : "1";
    ctx.ui.notify(`ccstyle: write 工具已被 /synthetic/${index}/render.ts 占用，富 diff 已让位`, "warning");
    ctx.ui.notify(`notice-fixture: 已检查 /synthetic/project-${index}/file.ts 的 ${index} 项`, "warning");
  } });
  pi.registerCommand("desk-test-clear", { description: "UI verification clear", handler: async (_args, ctx) => { ctx.ui.setStatus("fixture-ui", undefined); ctx.ui.setWidget("fixture-above", undefined); ctx.ui.setWidget("fixture-below", undefined); } });
}
