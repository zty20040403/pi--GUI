# pi desk

Kenneth 的 pi 图形客户端，底层遥控本机现有的 pi。完整方案见 [`PLAN.md`](PLAN.md)，开发规矩见 [`AGENTS.md`](AGENTS.md)。

**当前进度：第 4 阶段，三栏浏览器版已能聊天、管理对话和只读预览文件。附件、完整插件弹窗、操作审批和 Mac 应用还没做。**

## 怎么打开试

打开 Mac 的“终端”，运行：

```bash
cd ~/Desktop/"pi harness"
npm ci
npm run dev
```

第一次或依赖变更后执行 `npm ci`；平时直接 `npm run dev` 即可。

1. 保持这个终端开着，打开它打印的**完整带口令网址**。开发模式会自动从后台 4317 跳到页面 5173，不用自己改端口。
2. 页面右上角“模型”选择 **CLIProxy → gpt-6-luna**，“推理”选 **low**。
3. 在底部输入框输入消息，按 Enter 发送。可以试：“列出当前目录的文件”。
4. AI 的回复会流式出现；工具卡片默认折叠，点一下能展开命令和输出。
5. 用完后在启动后台的终端按 `Ctrl+C`，它会关闭自己启动的 pi 子进程。

默认项目是这个仓库的文件夹。左边按项目列出和终端共用的对话：

- **打开文件夹**：填已存在文件夹的绝对路径（也支持 `~/`），或点“最近用过”填入路径，再点“打开”。
- **新对话**：在当前项目开始新的对话；项目名旁的 `＋` 则在那个项目新建。
- **打开旧对话**：直接点对话，自动切换到它所属的项目和历史。换标签页后也可以从左边找回来。
- **改名/删除**：点对话旁 `⋯`。改名会同步到终端；删除要确认，使用 macOS 废纸篓，不永久删除。顶部对话标题也能点击改名。
- **收起/调整宽度**：顶部 `☰` 收起列表；拖动列表右边界调整宽度。窄窗口可用列表里的 `×` 收起。

正在回复的对话会转圈。同一个项目正在回复时不能切到它的另一段对话或新建；可以切到另一个项目，原项目继续回复。删除正在回复的对话需要先停止。

**操作审批还没做。** 现在 pi 可以直接读写文件和执行命令，请只在可信项目里使用。不要把启动网址发给别人，它相当于本地后台的口令。

## 界面和快捷键

- **左边**：项目分组可折叠；搜索匹配名字、第一句话或项目路径。家目录分组提示“在这里没有长期记忆”。最近项目和列表宽度保存在浏览器本地，不包含口令。
- **顶部**：当前项目、可点击改名的对话标题、按提供商分组的模型及价格、这个模型支持的推理档位。回复时暂时不能切换模型，避免中途混用。
- **中间**：Markdown、代码高亮/复制、表格、Mermaid 图和公式；默认折叠的思考过程和工具卡片。工具里的文件路径可点击，在右侧预览。向上翻时不会强制滚到底，出现“回到底部”按钮。
- **右边**：第一个固定标签“文件”是按需展开的项目树；点击文件开预览，同一个文件不重复开标签。顶部“文件 ▤”或面板 `×` 收起；拖面板左边界调整宽度。切项目时标签按项目隔离，当前标签页刷新后仍保留。
- **底部输入框**：
  - Enter：发送；回复中就是“插话”。
  - Shift+Enter：换行；中文输入法的确认键不会误发送。
  - Alt+Enter（Mac 是 Option+Enter）：回复中“做完再做”，消息显示在排队栏。
  - Esc 或“停止”：先清空排队，再停止当前回复；清出的排队内容会放回输入框，不丢掉。
  - 输入 `/`：显示 pi 的插件/技能命令和本地 `/compact`。上下键选择、Enter/Tab 填入，再补参数发送。
- **状态栏**：本对话花费、上下文用量、pi 插件送来的状态。
- **网络提示**：等待模型超过 5 秒会显示等待时长；重试显示次数；最终失败显示原因及“重试”。发送失败时保留输入内容。

完整插件弹窗在第 5 阶段做：当前遇到需要选项/确认/输入的插件交互会安全取消并提示，不能靠本版页面完成 `/plan` 等需要弹窗的完整流程；请暂时在终端使用。

## 怎么试文件预览

1. 在右侧“文件”里展开 `scripts` → `fixtures` → `preview`，逐个点 `sample.md`、`sample.xlsx`、`sample.docx`、图片、PDF、网页或 MP3。
2. Markdown 能看到相对图片、图表、公式和高亮代码；“源码”切换到带行号的文本。CSV/TSV 可切首行表头，Excel 每张表一个标签。
3. 图片可以放大/缩小并拖动；PDF 用 Chrome 自带查看器；音视频用原生播放控件。
4. HTML **默认禁用脚本**。只对可信网页勾“允许运行脚本”；即使开启，也不能访问主页面、口令或后台，外部请求仍禁用。
5. 文件顶部有“用默认软件打开”“在 Finder 中显示”“刷新”。AI 改动已打开的文件会自动刷新，树里出现小圆点；文件修改时间也会定时检查。

要试“让 AI 改 notes.md”，建议先复制样例到临时目录，不修改仓库的合成样例：

```bash
cd ~/Desktop/"pi harness"
mkdir -p /tmp/pi-desk-demo
cp -R scripts/fixtures/preview/. /tmp/pi-desk-demo/
```

然后左侧“打开文件夹”填 `/tmp/pi-desk-demo`，选 **gpt-6-luna / low**，右侧打开 `notes.md`，发：“在 notes.md 末尾加一行测试文字”。路径显示成 `/private/tmp/...` 是 macOS 的正常路径归一化。

Word 预览会提示“排版可能和原文不同”。PPT、旧 Word/Excel 有 LibreOffice 时可尝试隔离转换为 PDF；本机没安装，已验证显示安装提示和默认软件打开按钮，**安装后的转换分支尚未实测**。

超过 1 MB 的文本/Markdown/网页/CSV 只读取前 1 MB；非常长的代码降级为纯文本以免卡住。超过 50 MB 的文件只显示信息，不读取内容。Excel/Word 在有超时限制的独立 worker 中解析，并限制 ZIP 展开体积和表格数量。

## 对话会不会丢

- 对话照常保存在 pi 的 sessions 目录，终端 `pi -r` 也能看到。
- 同一个浏览器标签页刷新或聊天 WebSocket 断线，会重新打开原对话，不重复发送未确认的消息，也不因重连而切换掉正在生成的对话。
- 口令进 `sessionStorage` 后会从地址栏删除，这是正常的。不要把删除口令后的地址复制到新标签页当启动网址。
- 关闭标签页再新开，标签页的临时状态可能不在；磁盘上的对话仍在，可以从左侧列表或终端 `pi -r` 找旧对话。
- “未保存”的新对话表示 pi 尚未写出会话文件，不计入已保存列表；写入后会自动刷新。
- 切换对话时，未发送草稿在当前页面内按对话隔离，不会带到另一个项目；刷新页面后草稿不保证保留。
- 删除当前对话后会开启新的空对话，不会继续使用或重新创建刚删除的文件。
- 后台每次重启都会生成新口令，需重新打开终端本次打印的完整网址；已保存的对话可以恢复。

不会修改你的模型、插件或 CortexKit 配置。不同页面在同一项目里共享一个活动 pi 对话，暂时不是“每个页面各聊一段”。

## 平时用（只开一个端口）

```bash
cd ~/Desktop/"pi harness"
npm run build
npm start
```

打开终端打印的网址，生产模式直接在 4317 提供页面。开发模式或生产模式任选一个，不要同时启动两个后台。

目前需要 Node.js 22 或更新版本、npm 和已配置好的 `pi`。测试用模型需有 `cliproxy/gpt-6-luna`。验收脚本清理临时文件使用 macOS `trash`。

## 检查和完整验收

```bash
npm run typecheck       # 后台、前端、脚本和 Vite 配置的 TypeScript
npm test                # 不调用模型：24 组自动测试
npm run build           # 构建真实聊天网页
npm run verify:phase1   # 后台完整验收，包含一次真实模型请求
npm run verify:phase2   # 真实 Chrome 聊天页 + 终端 pi -r + 生产页面验收
npm run verify:phase3   # 真实列表/改名/废纸篓/跨项目 cwd + 终端 All 比对
npm run verify:phase4   # 每种预览/HTML 隔离/真实 AI 改文件/敏感路径 + 生产 worker
npm run fixtures        # 重新生成完全合成的测试文件（不读取私人文件）
```

先关闭其他占用 4317 / 5173 的后台。第 2–4 阶段验收使用已安装的 Google Chrome 和 Python 3；Playwright 已固定为开发依赖，不需要下载额外浏览器。日常使用网页不需要 Playwright 或 Python。

真实浏览器验收只用 `gpt-6-luna` + `low` 聊天；其他模型只切换、不发付费请求。网络重试、插话/排队、IME、复制、折叠等边界情况另在真实 Chrome 中用模拟协议测试，避免为测试故意制造模型故障。

测试创建临时项目和测试对话，结束时只用 `trash` 把它们移到废纸篓，不动你已有的对话。截图存到忽略提交的 `.pi-desk/verification/`，不会提交口令或私人对话。

具体记录：[`第 1 阶段`](docs/phase-1-verification.md)、[`第 2 阶段`](docs/phase-2-verification.md)、[`第 3 阶段`](docs/phase-3-verification.md)、[`第 4 阶段`](docs/phase-4-verification.md)。旧的命令行 `npx tsx scripts/smoke.ts` 仍可单独跑，会自行启动后台；已有后台时用 `PI_DESK_URL='这里粘贴完整启动网址' npx tsx scripts/smoke.ts`。

## 后台协议（给后续开发用）

只监听 `127.0.0.1:4317`，每次随机生成 32 字节 hex 口令。所有 HTTP API 要求 `Authorization: Bearer <启动口令>`：

| 请求 | 返回 |
|---|---|
| `GET /api/health` | `{ok: true, phase: 4, processes: 数量}` |
| `GET /api/workspace` | `{cwd: 后台项目根目录, home: 家目录}` |
| `GET /api/projects` | `{projects: [{cwd, sessions: [{path, id, cwd, title, name?, mtime}]}], activity: [{cwd, sessionPath?, busy}]}` |
| `POST /api/check-dir` | JSON `{path}` → `{cwd}`，检查并 realpath，不创建目录 |
| `POST /api/sessions/delete` | JSON `{path}` → `{ok:true}`，校验普通 pi 会话文件，空闲活动进程先关闭，再 `trash` |
| `GET /api/tree?cwd=&dir=` | 一层目录，目录在前，过滤隐藏/敏感/越界链接，超过 5000 项提示 |
| `GET /api/file-info?cwd=&path=` | `{cwd,path,name,size,mtime,mime,binary,tooLarge}`；前 8 KB 检测 NUL，大文件不读取 |
| `GET /api/file?cwd=&path=` / `HEAD` | 原始字节和 MIME；单段 Range/206/416、文件大小和修改时间头，50 MB 上限 |
| `GET /api/office?cwd=&path=` | 可用时隔离转换并返回缓存 PDF；缺失 501，失败/超时 422 |
| `POST /api/open` / `/api/reveal` | JSON `{cwd,path}`，检查后用参数数组执行 macOS `open` / `open -R` |

WebSocket：`/ws?token=<启动口令>`。检查 Host 和 Origin；开发模式允许本机 5173 Origin，生产模式只允许本机 4317 Origin。命令行客户端也要发送 Origin。

```typescript
// 客户端 → 后台
{ op: "open", cwd, sessionPath? }
{ op: "rpc", cwd, reqId, cmd: { type: "get_state" } }
{ op: "ui_response", cwd, payload: { type: "extension_ui_response", id, cancelled: true } }

// 后台 → 客户端
{ op: "opened", cwd, state, messages, stats, models, commands, seq }
{ op: "rpc_result", reqId, response }
{ op: "event", cwd, record, seq, sessionPath? }
{ op: "session_deleted", cwd, sessionPath }
{ op: "exit", cwd, reason }
{ op: "error", cwd?, reqId?, message }
```

`seq` 是当前 pi 进程 stdout 的顺序号；`opened.seq` 对应历史消息快照的响应位置，前端据此避免重复拼接缓冲的流式增量。它不写入 pi 的对话文件。旧客户端忽略新增字段仍可用。

每个项目复用一个 pi 进程，空闲 30 分钟回收（忙/有待回复命令时不回收）。项目路径通过 `realpath` 归一化；已有对话路径只能属于该项目且在 pi 保存的目录内。模型连接配置/凭据字段不转发，stderr 只进后台并脱敏。

POST 接口需要 `Content-Type: application/json`，请求体限 16 KB。删除拒绝越界/软链接/无效会话，忙时返回 409，trash 失败只报错，没有直接删除的退路。删除成功会广播 `session_deleted`，选中该会话的页面清除旧目标并开启新对话。

文件接口只允许当前后台已成功打开的项目，先 `realpath` 再判范围，拒绝敏感目录（包括 pi 模型/会话配置目录）和 `.env` 等凭据文件。前端用带 Bearer 的 fetch 取文件，再以临时 Blob URL 显示图片、PDF、媒体；**不在文件 URL 上附加口令**。文本前 1 MB 用 Range 读取；关闭/切换预览会取消请求并回收对象 URL/文档 worker。

`open` 不带路径就是新对话，刷新/重连要带已有路径；对同一活动会话直接读取，不重新 `switch_session`。`prompt` 成功仅表示接收，必须等 `agent_settled` 才算彻底完成。权限插件的加载开关仍预留，完整工具权限在第 5 阶段实现。

## 常见问题和已知限制

- **端口占用 / EADDRINUSE**：在之前启动的终端按 `Ctrl+C`；不要同时运行开发和生产后台。
- **页面连接不上**：确认后台终端还开着。如果重启过，用本次打印的新网址；不要公开保存真实口令。
- **找不到 pi**：先在同一个终端运行 `pi --version`；必要时用 `PI_BIN=/pi/可执行文件的绝对路径 npm run dev` 指定路径。
- **找不到模型 / 请求报错**：先在终端 pi 里确认 `cliproxy/gpt-6-luna` 能用。本项目不替你改模型配置，不自动换到更贵的模型。
- **旧对话的思考耗时**：pi 没保存耗时就只显示“思考过程”，不会编造 N 秒；当前流式回复会计时。
- **旧项目目录已不存在**：会话仍在列表中，也可移到废纸篓；要继续聊天，需先恢复/提供原项目目录。
- **还没做**：拖附件、完整插件弹窗、三档权限、Electron 和 Windows 远程使用，按后续阶段完成。
- **未验证**：Safari、Windows、桌面应用及装好 LibreOffice 后的隔离转换；系统打开/Finder 接线在自动测试中验证参数与路径校验，没有自动启动用户的 GUI 应用。当前实际验收浏览器是这台 Mac 的 Chrome。
- **依赖审计**：本阶段固定并更新 ws/tsx/Vite 同大版本补丁、Mermaid 和 KaTeX（统一到修复版）。仍有 **11 项告警：10 moderate、1 high**，主要是 Vite 开发链和 ExcelJS 存档依赖；high 对应 Windows launch-editor，当前后台在 Mac，生产页面不运行 Vite 开发服务器。仍需独立补丁验证，不宣称审计全绿；没有用 `npm audit fix --force`。只在本机可信项目使用，不暴露到公网。
