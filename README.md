# pi desk

Kenneth 的 pi 图形客户端，底层遥控本机现有的 pi。完整开发方案见 [`PLAN.md`](PLAN.md)，开发规矩见 [`AGENTS.md`](AGENTS.md)。

**当前进度：第 1 阶段（后台）。还没有聊天网页，也没有 Mac 应用。**

## 现在能做什么

- 只在本机 `127.0.0.1:4317` 提供 HTTP 和 WebSocket 服务。
- 每次启动生成新的随机口令，检查 HTTP 的 Host/Bearer 和 WebSocket 的 Host/Origin/口令。
- 按项目文件夹复用 `pi --mode rpc` 子进程，转发命令、流式事件、插件弹窗回答和退出通知。
- 新建/打开已有对话，读取状态、历史、花费、可用模型和插件命令。
- 扫描现有 pi 对话，按项目分组、最近修改时间排序；包括已保存的空对话。
- 空闲 30 分钟关闭子进程；正在回复或等待命令结果时不回收。后台退出时关闭它启动的 pi。
- 预留第 5 阶段权限插件开关：文件存在才通过参数数组加载；不改终端 pi 的配置。

## 准备

在这台 Mac 上需要：Node.js 22 或更新版本、npm、已配置好的 `pi` 和 macOS `trash` 命令。真实聊天测试需要已有的 `cliproxy/gpt-6-luna` 模型。

打开“终端”，运行：

```bash
cd ~/Desktop/"pi harness"
npm ci
```

不会修改 `~/.pi/agent/models.json` 或你的插件配置。测试时 pi 会按正常方式保存对话；测试脚本只将它自己新建的临时目录和测试对话移到废纸篓。

## 最简单的试法

确认没有另外一个后台占用 4317 端口，然后运行：

```bash
cd ~/Desktop/"pi harness"
npx tsx scripts/smoke.ts
```

脚本会自行启动后台、创建临时项目，用 `cliproxy/gpt-6-luna` + `low` 发“只回复 ok”，等到 pi 完全结束，再检查保存和重新打开。最后输出类似：

```text
回复：ok
花费：$0.000855（8520 tokens）
通过：真实 pi、gpt-6-luna / low、流式事件、agent_settled、保存并重新打开对话
```

数字由实际请求决定。结束后会关闭它自己启动的后台；不会打印或保存后台口令。

## 手动启动后台

```bash
cd ~/Desktop/"pi harness"
npx tsx server/index.ts
```

终端会打印带 `?token=...` 的本机网址，**这个网址相当于口令，不要公开分享或提交**。按 `Ctrl+C` 关闭后台。

第 1 阶段没有聊天页面，浏览器直接打开网址目前会提示“仅提供后台接口”。不要把这个提示当成启动失败。

要对已经运行的后台执行 smoke，在第二个终端运行下面的命令，把 `这里粘贴完整网址` 换成第一个终端打印的网址：

```bash
cd ~/Desktop/"pi harness"
PI_DESK_URL='这里粘贴完整网址' npx tsx scripts/smoke.ts
```

口令每次重启都会变，所以重启后需要重新复制网址。不要把真实网址写到 README、脚本或提交中。

## 类型检查和验收

```bash
npm run typecheck       # 检查后台、测试脚本和 Vite 配置的 TypeScript
npm test                # 不调用模型：后台的 6 组自动测试
npm run verify:phase1   # 第 1 阶段全部验收，包含一次真实模型请求
```

完整验收会真正启动 `npx tsx server/index.ts`，运行 `npx tsx scripts/smoke.ts`，检查未授权请求返回 401，再独立读取真实 sessions 文件，与 API 的项目、对话路径、id、第一句和最后名字逐项比对。它只打印数量和通过结果，不打印私人对话内容、模型连接配置或口令。

生产静态文件服务和找不到路径时的 `index.html` 回退也有自动测试，用的是临时测试文件。`npm run build`、`npm run dev` 的聊天网页要等第 2 阶段补齐入口后才能使用；此阶段不要求生成 `dist/`。

## 后台协议（给后续界面开发用）

HTTP 接口均要求 `Authorization: Bearer <启动口令>`：

| 请求 | 返回 |
|---|---|
| `GET /api/health` | `{ok: true, phase: 1, processes: 数量}` |
| `GET /api/projects` | `{projects: [{cwd, sessions: [{path, id, cwd, title, name?, mtime}]}]}` |

WebSocket：`/ws?token=<启动口令>`，必须携带本机页面 Origin。开发模式允许 `http://127.0.0.1:5173` / `http://localhost:5173`；生产模式只允许 4317 上的本机 Origin。命令行客户端也要发送 Origin。

客户端发给后台：

```typescript
{ op: "open", cwd: "/绝对/项目路径", sessionPath?: "/pi/保存的对话.jsonl" }
{ op: "rpc", cwd: "/绝对/项目路径", reqId: "客户端唯一编号", cmd: { type: "get_state" } }
{ op: "ui_response", cwd: "/绝对/项目路径", payload: { type: "extension_ui_response", id: "弹窗编号", cancelled: true } }
```

后台发给客户端：

```typescript
{ op: "opened", cwd, state, messages, stats, models, commands }
{ op: "rpc_result", reqId, response } // pi 的 response；success:false 也是正常协议结果
{ op: "event", cwd, record }         // 所有 pi 事件，包括 extension_ui_request
{ op: "exit", cwd, reason }
{ op: "error", cwd?, reqId?, message } // 格式错误、打开失败或子进程请求失败
```

- 同一个项目只有一个活动对话，多页面共享它；项目路径通过 `realpath` 归一化。
- `opened` 的数组已经从 pi 的 `data.messages/models/commands` 中取出，不需要再取 `.data`。
- 模型的名称、价格和能力保留，连接配置/凭据字段不转发；stderr 只进后台并脱敏。
- `open` 不带 `sessionPath` 就是新对话；刷新/重连时需明确带上已有对话路径，避免意外新建。
- 不能用别的项目的对话路径打开当前项目，也不能把任意文件当对话读；前端应同时切换 cwd。
- `prompt` 成功只表示已接收，**必须等 `agent_settled` 才算彻底完成**。
- 权限插件未实现，此阶段的口令用于连接授权，**不是工具操作审批**。带口令的客户端可以遥控本机 pi，只能给可信客户端使用。

## 常见问题和未完成项

- **端口已占用 / `EADDRINUSE`**：先在之前启动后台的终端按 `Ctrl+C`。已有后台不用再启动一个，使用上面的 `PI_DESK_URL` 方法测试。
- **401 / WebSocket 连不上**：重新复制本次启动的网址；HTTP 需 Bearer，WebSocket 还需正确的 Origin。
- **找不到 pi**：确认在同一个终端运行 `pi --version` 能成功。可用 `PI_BIN=/pi/可执行文件的绝对路径` 指定它。
- **找不到测试模型 / 模型请求报错**：先确认终端 pi 可以选到 `cliproxy/gpt-6-luna`。本项目不替你改模型配置，也不自动切换到更贵的模型。
- **还没做**：聊天界面、文件预览、拖附件、插件弹窗界面、三档操作权限、Electron 应用及 Windows 远程使用；按 `PLAN.md` 后续阶段完成。
- **还没按真实时间等 30 分钟**：自动测试用可控时钟覆盖空闲回收，并检查 `agent_end` 后仍不回收；不需要等待半小时。
