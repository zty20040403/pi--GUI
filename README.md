# pi desk

Kenneth 的 pi 图形客户端，底层遥控本机现有的 pi。完整方案见 [`PLAN.md`](PLAN.md)，开发规矩见 [`AGENTS.md`](AGENTS.md)。

**当前进度：第一版六个阶段已完成。Mac 应用通过实际启动/聊天验收；Windows SSH 远程使用由 Kenneth 在真机操作并反馈收到回复。三栏界面、对话管理、文件预览、附件、插件弹窗和三档工具权限均已实现。**

## 怎么打开试

打开 Mac 的“终端”，运行：

```bash
cd ~/Desktop/"pi harness"
npm ci
npm run dev
```

第一次或依赖变更后执行 `npm ci`；平时直接 `npm run dev` 即可。

1. 保持这个终端开着，打开它打印的**完整带口令网址**。开发模式会自动从后台 4317 跳到页面 5173，不用自己改端口。
2. 页面右上角“模型”选择 **CLIProxy → gpt-6-luna**，“推理”选 **low**。**每次新建对话后再确认一次**：pi 会按你的默认配置创建新对话，不保证沿用上一段对话的模型。
3. 在底部输入框输入消息，按 Enter 发送。可以试：“列出当前目录的文件”。
4. AI 的回复会流式出现；工具卡片默认折叠，点一下能展开命令和输出。
5. 用完后在启动后台的终端按 `Ctrl+C`，它会关闭自己启动的 pi 子进程。

默认项目是这个仓库的文件夹。左边按项目列出和终端共用的对话：

- **打开文件夹**：浏览器里填已存在文件夹的绝对路径（也支持 `~/`），或用最近项目；Mac 应用里直接用系统文件夹选择器。
- **新对话**：在当前项目开始新的对话；项目名旁的 `＋` 则在那个项目新建。
- **打开旧对话**：直接点对话，自动切换到它所属的项目和历史。换标签页后也可以从左边找回来。
- **改名/删除**：点对话旁 `⋯`。改名会同步到终端；删除要确认，使用 macOS 废纸篓，不永久删除。顶部对话标题也能点击改名。
- **收起/调整宽度**：顶部 `☰` 收起列表；拖动列表右边界调整宽度。窄窗口可用列表里的 `×` 收起。

正在回复的对话会转圈。同一个项目正在回复时不能切到它的另一段对话或新建；可以切到另一个项目，原项目继续回复。删除正在回复的对话需要先停止。

顶部“权限”默认是**自动**：普通项目文件修改和安全查看命令可以直接执行；项目外修改、敏感文件和其他命令会弹窗问你。危险命令标红，默认聚焦“拒绝”。**审批不是操作系统沙箱**，仍只应在可信项目使用。不要把启动网址发给别人，它相当于本地后台的口令。

## 界面和快捷键

- **左边**：项目分组可折叠；搜索匹配名字、第一句话或项目路径。家目录分组提示“在这里没有长期记忆”。最近项目和列表宽度保存在浏览器本地，不包含口令。
- **顶部**：当前项目、可点击改名的对话标题、按提供商分组的模型及价格、推理档位、权限模式。回复时不能切换模型，避免中途混用；权限可以调整。有项目目标记录时会显示“暂停目标”，行为和终端 `/goal-pause` 相同。
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

## 附件、插件和权限怎么试

- **拖入文件**：从 Finder 拖文件到页面，看到“松手添加到对话”后松手；也可以点输入框旁“＋ 附件”。图片有缩略图，其他文件有名称/大小卡片。写下问题再发送，比如“图里有什么”或“总结这个 PDF”。
- **粘贴截图**：复制图片后，在输入框按 `Cmd+V`，效果等同于拖入图片。
- **引用项目文件**：从右侧文件树把文件拖到输入框，出现 `@src/App.tsx` 一类路径标签；不重复上传。发送时 AI 会收到这个文件的路径。
- **移除附件**：点卡片 `×` 只是取消这次附带；已经上传的文件仍在项目 `.pi-desk/uploads/`。上传目录会加入该仓库的 Git 本地排除配置，不进入提交。
- **选择题**：发“用 ask_user_question 问我用 Python 还是 Bash”，在弹窗选一个选项。输入框/多行编辑器也可以直接填写；多个提问按顺序出现。刷新或重连会恢复尚未回答的问题，另一个窗口已经回答的会关闭。
- **计划**：发 `/plan 写一个 hello.sh`，AI 的计划以 Markdown 卡片显示；在菜单选 **Implement here** 在当前对话实施。插件原来的英文菜单会保留，避免改变协议选项。输入纯 `/命令` 后，第一次 Enter 填入命令，第二次 Enter 才执行。
- **任务清单**：让 AI 用 todo 做一个三步任务，输入框上方出现可折叠清单；完成项打勾，刷新后从 pi 当前对话分支恢复，不猜测工具是否成功。
- **插件状态/目标**：提示显示在右上角并自动消失；状态在底栏，小面板在输入框附近；待回答时标题闪动。目标插件的终端组件不能直接显示，因此另从项目 `.pi/goals/` 的记录读取进度。“暂停目标”在运行中第一次停止当前轮，再按一次暂停目标；可用 `/goal-resume` 恢复。

权限三档：

| 模式 | 行为 |
|---|---|
| **只读** | 拒绝 edit/write 和非安全命令；允许 read、查看命令、上网及清单/提问等自有工具。未知工具需要可信的只读标记 |
| **自动（默认）** | 普通项目修改可直接做；敏感路径、项目外修改、其他命令和有破坏标记的工具会问你。复杂 shell、看似查看命令的改写/执行选项也会保守询问 |
| **完全放开** | 不再审批工具，顶部和输入框下方会警示。请谨慎使用；右侧文件预览接口的范围限制不会因此放宽 |

批准选项是“允许这一次”“这个对话里都允许”“拒绝”。对话内授权按“工具 + 完整命令”或“工具 + 文件夹”记住，换对话清空；取消或无交互界面时不自动批准。权限模式在当前项目进程中保留，后台重启默认回到自动；可在启动前用 `PI_DESK_PERMISSIONS=read-only npm start` 指定启动档位。只给 pi desk 的子进程加载权限扩展，终端正常启动的 pi 不受影响。

每个文件最多 **50 MB**，每条消息最多 **12 个附件、合计 100 MB**。原生看图支持 PNG/JPEG/GIF/WebP；其他图片格式按文件附带。图片在后台组装成 pi 的 `images`，非图片附保存路径；网页连接只发引用，不把大图塞进 1 MB 的 WS 消息。

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
- 同一个浏览器标签页刷新或聊天 WebSocket 断线，会重新打开原对话，不重复发送未确认的消息，也不因重连而切换掉正在生成的对话。待回答弹窗及已上传、尚未发送的附件引用也会恢复；刷新中未完成的上传需要重新添加。
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

目前需要 Node.js 22 或更新版本、npm 和已配置好的 pi `1.4.0` 接口。测试用模型需有 `cliproxy/gpt-6-luna`。验收脚本清理临时文件使用 macOS `trash`。

## Mac 应用

本机已安装到 **`~/Applications/pi desk.app`**。Finder 按 `Cmd+Shift+G`，输入 `~/Applications`，找到应用双击打开。第一次被系统拦住时，右键 → 打开；若系统询问访问项目文件夹权限，按你的意愿允许。应用未签名、未公证，只构建 Apple 芯片版。

- 启动时自己运行后台，不需要另外开终端；关窗口或退出时回收后台。
- 仍使用你现有的 Node.js/pi，不改模型、插件或配置；Finder 启动时会补上常用的用户/Nix PATH。
- 默认打开上次用系统选择器选过的项目；首次没有项目时打开家目录，再点“打开文件夹”选项目。
- 记住窗口位置和大小。“在 Finder 中显示”走经过后台路径校验的原生接口。
- **不要和 npm start/dev 同时启动**，它们都使用 4317。

要从源码重新打包，在 Mac 运行：

```bash
cd ~/Desktop/"pi harness"
npm ci
npm run desktop:build
mkdir -p ~/Applications
ditto "release/mac-arm64/pi desk.app" ~/Applications/"pi desk.app"
```

更新前先退出旧应用。`npm run build && npm run desktop` 可运行开发桌面入口。如果 npm 的 Electron 解压未完成，执行 `npm run desktop:install` 补齐经官方校验的本机运行文件。

## 从 Windows 远程用

这是 **Windows 浏览器访问 Mac 后台**，不是 Windows 上安装 Electron；项目文件、工具和对话仍在 Mac。两台电脑要能通过 SSH 连通。

**1. Mac 上关闭桌面应用，打开终端：**

```bash
cd ~/Desktop/"pi harness"
npm run build  # 代码更新后执行一次；已构建则可以省略
npm start
```

保持终端开着，保留它打印的完整网址（带 `?token=...`）。不要公开或发给别人。

**2. Windows 打开 PowerShell：**

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4317:127.0.0.1:4317 kenneth@alex
```

`alex` 换成你平时连接这台 Mac 用的主机名。首次连接要核对主机指纹，不关闭 SSH 的主机身份检查；需要密码时输入 Mac 账号密码，输入过程中不会显示字符。登录成功后保持空白是正常的，不要关闭窗口。

**3. Windows Chrome/Edge 地址栏打开 Mac 打印的完整网址。** 必须带口令，不能只打开没有口令的首页。后台收到的 Host/Origin 仍为本机 4317，无需放宽安全检查或开放公网端口。选 `gpt-6-luna` / `low`，发一句“只回复 Windows 验收通过，不用工具”。

用完后，Windows SSH 窗口和 Mac 后台终端都按 `Ctrl+C`。

- **Could not resolve hostname**：确认主机名，使用你已有的 SSH 连接方式，不需要把地址写入代码。
- **Connection refused / timed out**：确认 Mac 在线、网络能互通，系统设置 → 通用 → 共享中已开启“远程登录”，并允许该用户。不要擅自放开路由器公网端口。
- **Permission denied**：检查登录账号、密码或现有密钥配置，不要发送密码/私钥给别人。
- **Address already in use / cannot listen to port**：Windows 本地 4317 已占用，先关闭旧 SSH 转发或占用该端口的程序。不要随意改转发端口，否则 Host 校验会拒绝。
- **未授权 / 401**：用 Mac 后台本次打印的完整网址；重启后台会换口令。
- **网页打不开**：先看 SSH 有没有报错，再确认 Mac 的 npm start 还运行着，且没有同时启动桌面应用。

## 检查和完整验收

```bash
npm run typecheck       # 后台、前端、脚本和 Vite 配置的 TypeScript
npm test                # 不调用模型：46 组自动测试（含真实 pi 的权限命令）
npm run build           # 构建真实聊天网页
npm run verify:phase1   # 后台完整验收，包含一次真实模型请求
npm run verify:phase2   # 真实 Chrome 聊天页 + 终端 pi -r + 生产页面验收
npm run verify:phase3   # 真实列表/改名/废纸篓/跨项目 cwd + 终端 All 比对
npm run verify:phase4   # 每种预览/HTML 隔离/真实 AI 改文件/敏感路径 + 生产 worker
npm run verify:phase5   # 附件/插件/计划/清单/三档权限，真实 Chrome 和 luna/low
npm run test:permissions # 纯规则、授权范围、路径及真实 pi 权限菜单
npx tsx scripts/verify-permissions.ts # 真 pi 工具流水线 105 条；危险执行器为测试替身
npm run fixtures        # 重新生成完全合成的测试文件（不读取私人文件）
npm run test:desktop    # 4 组桌面专用安全/配置测试，无模型调用
npm run desktop:build   # 网页、后台打包和未签名的 Mac arm64 应用
npm run verify:phase6   # Mac 必要验收；Windows 仍需人工真机确认
```

先关闭其他占用 4317 / 5173 的后台。第 2–5 阶段验收使用已安装的 Google Chrome；终端恢复检查还使用 Python 3。Playwright 已固定为开发依赖，不需要下载额外浏览器。日常使用网页不需要 Playwright 或 Python。

真实浏览器验收只用 `gpt-6-luna` + `low` 聊天；其他模型只切换、不发付费请求。网络重试、插话/排队、IME、复制、折叠等边界情况另在真实 Chrome 中用模拟协议测试，避免为测试故意制造模型故障。

测试创建临时项目和测试对话，结束时只用 `trash` 把它们移到废纸篓，不动你已有的对话。截图存到忽略提交的 `.pi-desk/verification/`，不会提交口令或私人对话。

具体记录：[`第 1 阶段`](docs/phase-1-verification.md)、[`第 2 阶段`](docs/phase-2-verification.md)、[`第 3 阶段`](docs/phase-3-verification.md)、[`第 4 阶段`](docs/phase-4-verification.md)、[`第 5 阶段`](docs/phase-5-verification.md)、[`第 6 阶段`](docs/phase-6-verification.md)。旧的命令行 `npx tsx scripts/smoke.ts` 仍可单独跑，会自行启动后台；已有后台时用 `PI_DESK_URL='这里粘贴完整启动网址' npx tsx scripts/smoke.ts`。

## 后台协议（给后续开发用）

只监听 `127.0.0.1:4317`，每次随机生成 32 字节 hex 口令。所有 HTTP API 要求 `Authorization: Bearer <启动口令>`：

| 请求 | 返回 |
|---|---|
| `GET /api/health` | `{ok: true, phase: 6, processes: 数量}` |
| `GET /api/workspace` | `{cwd: 后台项目根目录, home: 家目录}` |
| `GET /api/projects` | `{projects: [{cwd, sessions: [{path, id, cwd, title, name?, mtime}]}], activity: [{cwd, sessionPath?, busy}]}` |
| `POST /api/check-dir` | JSON `{path}` → `{cwd}`，检查并 realpath，不创建目录 |
| `POST /api/sessions/delete` | JSON `{path}` → `{ok:true}`，校验普通 pi 会话文件，空闲活动进程先关闭，再 `trash` |
| `GET /api/tree?cwd=&dir=` | 一层目录，目录在前，过滤隐藏/敏感/越界链接，超过 5000 项提示 |
| `GET /api/file-info?cwd=&path=` | `{cwd,path,name,size,mtime,mime,binary,tooLarge}`；前 8 KB 检测 NUL，大文件不读取 |
| `GET /api/file?cwd=&path=` / `HEAD` | 原始字节和 MIME；单段 Range/206/416、文件大小和修改时间头，50 MB 上限 |
| `GET /api/office?cwd=&path=` | 可用时隔离转换并返回缓存 PDF；缺失 501，失败/超时 422 |
| `POST /api/open` / `/api/reveal` | JSON `{cwd,path}`，检查后用参数数组执行 macOS `open` / `open -R` |
| `POST /api/upload?cwd=&name=` | 原始字节，50 MB 上限 → `{cwd,path,name,size,mime,image}`；只写已打开项目的隐藏上传目录，维护 Git 本地排除 |
| `GET /api/goals?cwd=` | 从已打开项目目标文件读取公开进度，不返回调度器/存储配置，不允许越界软链接 |

WebSocket：`/ws?token=<启动口令>`。检查 Host 和 Origin；开发模式允许本机 5173 Origin，生产模式只允许本机 4317 Origin。命令行客户端也要发送 Origin。

```typescript
// 客户端 → 后台
{ op: "open", cwd, sessionPath? }
{ op: "rpc", cwd, reqId, cmd: { type: "get_state" } }
{ op: "ui_response", cwd, reqId?, payload: { type: "extension_ui_response", id, cancelled: true } }
// prompt 可附 attachments: [{kind:"upload"|"path", path}]，后台校验并组装图片/路径

// 后台 → 客户端
{ op: "opened", cwd, state, messages, stats, models, commands, seq, ui, extensions }
{ op: "ui_states", states: [{cwd, state: uiSnapshot}] }
{ op: "ui_state", cwd, state: uiSnapshot }
{ op: "ui_resolved", cwd, id, reason }
{ op: "rpc_result", reqId, response }
{ op: "event", cwd, record, seq, sessionPath? }
{ op: "session_deleted", cwd, sessionPath }
{ op: "exit", cwd, reason }
{ op: "error", cwd?, reqId?, message }
```

`seq` 是当前 pi 进程 stdout 的顺序号；`opened.seq` 对应历史消息快照的响应位置，前端据此避免重复拼接缓冲的流式增量。它不写入 pi 的对话文件。UI 快照带截取位置的顺序号，与历史消息快照的边界独立，旧状态不能覆盖最新快照。任务恢复使用 `get_entries`/`leafId` 沿 parentId 找当前分支，优先用 `rpiv-todo-state`，兼容不进入消息历史的嵌套 todo；完整会话条目不转发给网页。回答须匹配当前题目的 id/类型/选项，带 reqId 时等写入 pi 后返回 rpc_result；拒绝未知、重复或过期回答。

每个项目复用一个 pi 进程，空闲 30 分钟回收（忙/有待回复命令时不回收）。项目路径通过 `realpath` 归一化；已有对话路径只能属于该项目且在 pi 保存的目录内。模型连接配置/凭据字段不转发，stderr 只进后台并脱敏。

除 upload 原始字节外，POST 接口需要 `Content-Type: application/json`，请求体限 16 KB。删除拒绝越界/软链接/无效会话，忙时返回 409，trash 失败只报错，没有直接删除的退路。删除成功会广播 `session_deleted`，选中该会话的页面清除旧目标并开启新对话。

文件接口只允许当前后台已成功打开的项目，先 `realpath` 再判范围，拒绝敏感目录（包括 pi 模型/会话配置目录）和 `.env` 等凭据文件。前端用带 Bearer 的 fetch 取文件，再以临时 Blob URL 显示图片、PDF、媒体；**不在文件 URL 上附加口令**。文本前 1 MB 用 Range 读取；关闭/切换预览会取消请求并回收对象 URL/文档 worker。

`open` 不带路径通常新建；未保存但正在等插件回答的空对话例外，恢复该活动对话而不误建。刷新/重连带已有路径；对同一活动会话直接读取，不重新 switch。`prompt` 成功仅表示接收，必须等 `agent_settled` 才算彻底完成。停止会显式取消仍待答的插件请求，避免未传 AbortSignal 的插件卡住。

权限扩展的判断和 realpath 校验在 pi 的 tool_call 钩子里，支持嵌套调用。查看用 Git 查询禁用外部 diff/textconv、pager 和 fsmonitor；不是完整 shell 沙箱。开发用 SDK 固定为 devDependency，只用于类型/验收，后台仍启动用户原来的 pi；子进程 PATH 排除 npm 临时的 node_modules/.bin，避免误启动 SDK 自带的同名裸 CLI。

## 常见问题和已知限制

- **端口占用 / EADDRINUSE**：在之前启动的终端按 `Ctrl+C`；不要同时运行开发和生产后台。
- **页面连接不上**：确认后台终端还开着。如果重启过，用本次打印的新网址；不要公开保存真实口令。
- **找不到 pi**：先在同一个终端运行 `pi --version`；必要时用 `PI_BIN=/pi/可执行文件的绝对路径 npm run dev` 指定路径。
- **找不到模型 / 请求报错**：先在终端 pi 里确认 `cliproxy/gpt-6-luna` 能用。本项目不替你改模型配置；新对话按 pi 的默认配置，新建后请重新确认模型和推理档位。
- **旧对话的思考耗时**：pi 没保存耗时就只显示“思考过程”，不会编造 N 秒；当前流式回复会计时。
- **旧项目目录已不存在**：会话仍在列表中，也可移到废纸篓；要继续聊天，需先恢复/提供原项目目录。
- **还没做**：系统级通知、文件改动汇总等第二期功能。当前只有标题提醒，没有系统通知；Electron 无自动更新。
- **未验证**：Safari、Intel Mac 及装好 LibreOffice 后的隔离转换。Windows SSH/浏览器由 Kenneth 真机反馈通过，非代理自动操作。Mac Electron 已实际启动/聊天，Finder 显示已实际调用；系统默认软件打开仍只检查参数接线，没自动启动用户的其他 GUI 应用。
- **依赖审计**：当前仍有 **27 项告警：23 moderate、4 high**，涉及 Vite 开发链、ExcelJS、SDK、Electron 和打包链。Electron 35 是方案指定的旧版本，不应认为仍有持续安全维护；主窗口为兼容隔离 HTML 开关保留 CSP unsafe-inline，也不能宣称完全防 XSS。SDK 不作为生产发动机，打包不包含开发 node_modules，但这不等于告警无风险。需独立升级/回归，没有用 `npm audit fix --force` 擅自跨大版本。只在本机可信项目使用，不暴露到公网。
