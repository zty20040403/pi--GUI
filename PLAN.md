# pi desk 开发方案

> 版本：2026-11-01 · 作者：Kenneth（需求）+ Claude（整理）
> 执行者：pi（在 `~/Desktop/pi harness` 里按本文一步一步做；文件夹名带空格，命令里要加引号：`cd ~/Desktop/"pi harness"`）
> 读者：Kenneth（要看得懂）、pi（要照着做得出来）

---

## 0. 给执行者（pi）的话

- **按阶段做，一次只做一个阶段。** 每个阶段最后有"验收"清单，全部通过再进下一阶段，并 `git commit`（提交信息写清楚这一阶段做了什么），然后 `git push` 到 `github.com/zty20040403/pi--GUI`（公开仓库，推送规则见 `AGENTS.md`）。
- **不确定的地方先查，不要猜。** 本文给出了 pi RPC 协议的要点，但以本机安装的 pi 文档为准（位置见 §2.4）。
- **每个阶段做完，用中文写一段"这阶段做了什么、怎么试"给 Kenneth**，他不是很熟前端和终端。
- **绝对不要**把 API key、服务器地址、`~/.pi/agent/secrets` 里的东西写进代码、日志或提交里。
- **不要动** `~/.pi/agent/models.json`、`~/.pi/agent/extensions/`、`~/.local/share/pi-agent/` 下的文件，那是 Kenneth 的 pi 配置，由 `setup.sh` 管理。
- 测试时用便宜的模型：`cliproxy/gpt-6-luna`，推理强度 `low`。

---

## 1. 目标

做一个**像 Codex 桌面版一样的图形界面客户端**，底层用 Kenneth 现有的 pi。

一句话：**左边对话列表，中间聊天，右边看文件；文件能拖进来问；AI 要执行危险操作时弹窗问我。**

### 1.1 为什么用 pi 当"发动机"

pi 已经有：连接 CLIProxy 的一堆模型、读写文件和执行命令的工具、对话保存、Magic Context 记忆、已装的插件（计划模式、上网搜索、选择题、任务清单）、`AGENTS.md`。
pi desk **只做界面**，通过 pi 的 RPC 模式遥控它。终端里的 pi 和 pi desk 看到的是**同一批对话**。

### 1.2 参考对象

| 项目 | 源码 | 参考什么 |
|---|---|---|
| Codex 桌面版 | 不公开 | 只参考界面和交互 |
| DeepSeek Harness（`github.com/deepseek-ai/deepseek-harness`，MIT） | 公开 | **主要参考**：网页 + Electron 薄壳结构（`apps/desktop`、`apps/web`）、右侧预览（`packages/client/ui-sidebar-right`、`ui-sidebar-documentpreview`、`ui-sidebar-files`）、拖文件和附件栏（`ui-attachment`、`file-upload`、`ui-file-drag`）、审批和提问（`ui-approval`、`ui-user-questions`、`ui-plan`）。中文文档在各目录的 `README.zh.md` |
| OpenCode 桌面版（`github.com/anomalyco/opencode` 的 `packages/desktop`，MIT） | 公开 | 界面布局 |
| Codex CLI / App Server（`github.com/openai/codex`，Apache-2.0） | 公开 | 客户端与后台的协议设计 |

需要看参考源码时，浅克隆到 `refs/`（已在 `.gitignore` 里）：

```bash
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git refs/deepseek-harness
```

**只借鉴思路**。如果直接复制了某段代码，要在文件开头注明出处和许可证。

---

## 2. 整体结构

```
┌──────────────── Electron 窗口（第 6 阶段才加，先用浏览器）────────────────┐
│  网页界面（React + Vite）                                                 │
│  左：项目/对话列表 │ 中：聊天 │ 右：文件树 + 预览（标签页）                │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ HTTP（/api/...）+ WebSocket（/ws），带口令
┌───────────────────────────────┴───────────────────────────────────────────┐
│  本地后台 server（Node + TypeScript，只监听 127.0.0.1:4317）               │
│  - 每个项目文件夹启动一个 `pi --mode rpc`，转发命令和事件                  │
│  - 读 ~/.pi/agent/sessions 列出对话                                        │
│  - 文件树、文件读取（预览）、上传（拖进来的文件）、用系统打开               │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ stdin/stdout，JSONL
                       pi（RPC 模式）── 加载 desk-permissions 权限插件
                                │
                       gizmo 上的 CLIProxy 模型
```

### 2.1 技术选型（版本已在 `package.json` 固定）

| 部分 | 选择 |
|---|---|
| 语言 | TypeScript（前后端都是） |
| 界面 | React 18 + Vite 5 |
| 后台运行 | `tsx` 直接跑 TS；WebSocket 用 `ws` |
| Markdown | `react-markdown` + `remark-gfm`；Mermaid 用 `mermaid`；公式用 `remark-math` + `rehype-katex` + `katex`（新增时固定版本） |
| 代码高亮 | `shiki`（按需加载语言，新增时固定版本） |
| 表格预览 | CSV/TSV：`papaparse`；Excel：`exceljs` |
| Word 预览 | `mammoth`（.docx → HTML） |
| HTML 安全 | `dompurify` |
| 桌面壳 | `electron`（第 6 阶段，固定版本 35.x） |

新增依赖时：先 `npm view <包>@<版本> version` 确认存在，再写进 `package.json`，**写死版本号，不用 `^`**。

### 2.2 目录结构

```
pi harness/             ← 项目根目录（产品名仍叫 pi desk）
  PLAN.md               ← 本文
  AGENTS.md             ← 给 pi 的规矩
  package.json  tsconfig.json  vite.config.ts  index.html
  server/
    index.ts            ← HTTP + WebSocket 入口
    auth.ts             ← 口令、Host/Origin 检查
    pi-process.ts       ← 一个 pi RPC 子进程（已写好初版）
    pi-pool.ts          ← 按项目管理多个 pi 进程
    sessions.ts         ← 读对话列表（已写好初版）
    files.ts            ← 文件树、读文件、上传、用系统打开
    office.ts           ← （可选）LibreOffice 转 PDF
  pi-extension/
    desk-permissions.ts ← 三档权限插件（§5）
  src/
    main.tsx  App.tsx  styles.css
    api/                ← WebSocket 客户端、HTTP 封装、状态管理
    components/
      sidebar/          ← 左边：项目、对话列表
      chat/             ← 中间：消息、工具卡片、输入框、附件栏
      right/            ← 右边：标签页、文件树、各种预览
      dialogs/          ← 插件弹窗、审批卡片、提示
  electron/             ← 第 6 阶段
  refs/                 ← 参考源码（不提交）
```

### 2.3 已经存在的东西

- `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`.gitignore`，依赖已 `npm install`。
- `server/pi-process.ts`：启动 `pi --mode rpc`，按 LF 切分 JSONL（**不能用 readline**），`request()` 按 id 等回复，其他记录作为 `record` 事件发出。
- `server/sessions.ts`：扫描 `~/.pi/agent/sessions`，每个对话取 cwd、第一句用户消息作标题、最后一次 `session_info` 的名字，按项目分组。

这两个文件可以直接用，也可以按需要改。

### 2.4 pi RPC 协议要点（以本机文档为准）

本机文档位置：

```bash
P=$(dirname "$(dirname "$(readlink -f "$(command -v pi)")")")/libexec/pi/docs
ls "$P"   # 重点看 rpc.md、rpc-commands.md、json.md、rpc-extension-ui.md、message-types.md、session-format.md、extensions.md
```

**启动**：`pi --mode rpc`，`cwd` 设为项目文件夹。对话会照常存进 `~/.pi/agent/sessions`。

**格式**：stdin/stdout 每行一个 JSON，只按 `\n` 切分（去掉行尾 `\r`）。stdout 只放协议记录，stderr 是日志。

**常用命令**（都可以带 `id`，回复带同一个 `id`）：

| 命令 | 作用 |
|---|---|
| `{"type":"prompt","message":"...","images":[{"type":"image","data":"<base64>","mimeType":"image/png"}]}` | 发消息。AI 正在回复时必须加 `"streamingBehavior":"steer"`（插话）或 `"followUp"`（排队） |
| `{"type":"abort"}` | 停止 |
| `{"type":"new_session"}` / `{"type":"switch_session","sessionPath":"..."}` | 新对话 / 打开已有对话 |
| `{"type":"get_state"}` | 当前模型、推理强度、是否在回复、对话文件、名字 |
| `{"type":"get_messages"}` | 当前对话全部消息（打开对话时用来显示历史） |
| `{"type":"get_available_models"}` / `{"type":"set_model","provider":"cliproxy","modelId":"gpt-6.1-sol"}` | 列出 / 切换模型 |
| `{"type":"set_thinking_level","level":"medium"}` / `get_available_thinking_levels` | 推理强度 |
| `{"type":"get_session_stats"}` | token、花费、上下文用量 |
| `{"type":"set_session_name","name":"..."}` | 改名 |
| `{"type":"compact"}` | 手动压缩 |
| `{"type":"get_commands"}` | 列出可用的 `/` 命令（包括插件的，如 `/plan`、`/ctx-status`） |
| `{"type":"export_html","outputPath":"..."}` | 导出 |

**事件**（没有 id，持续推送）：

| 事件 | 用途 |
|---|---|
| `agent_start` / `agent_settled` | 开始干活 / 彻底结束（`agent_settled` 之后才算不会再动） |
| `message_start` / `message_end` | 一条消息开始 / 结束（`message_end.message` 是最终版本，用它替换流式拼出来的内容） |
| `message_update` + `assistantMessageEvent` | 流式内容：`text_delta`、`thinking_delta`、`toolcall_start`、`toolcall_delta`、`toolcall_end`，用 `contentIndex` 区分块 |
| `tool_execution_start` / `_update` / `_end` | 工具执行：`toolCallId`、`toolName`、`args`、`result`、`isError`、`durationMs` |
| `queue_update` | 排队/插话的消息列表变了 |
| `session_info_changed`、`thinking_level_changed` | 名字、推理强度变了 |
| `compaction_start` / `compaction_end` | 压缩 |
| `auto_retry_start` / `auto_retry_end` | 自动重试（网络不好时会出现） |
| `extension_error` | 插件报错 |

**插件界面子协议**（§4.6 用）：pi 发 `{"type":"extension_ui_request","id":"...","method":"select|confirm|input|editor|notify|setStatus|setWidget|setTitle|set_editor_text",...}`。
前四种要回复：`{"type":"extension_ui_response","id":"<同一个 id>","value":"..."}`，或 `"confirmed":true/false`，或 `"cancelled":true`。后五种不用回复。

**对话文件**：`~/.pi/agent/sessions/<文件夹名>/<时间>_<uuid>.jsonl`。第一行 `{"type":"session","cwd":...}`；用户消息行是 `{"type":"message","message":{"role":"user","content":[...]}}`；改名是 `{"type":"session_info","name":"..."}`。

---

## 3. 我（Kenneth）想要的全部功能

带 ★ 的是第一版必须有的。

### 3.1 整体
- ★ 中文界面；跟随系统的深色/浅色。
- ★ 三栏布局：左边对话列表、中间聊天、右边文件面板；左右两栏都能收起，宽度可以拖动调整。
- ★ 浏览器能用；最后套 Electron 变成能双击打开的 Mac 应用（§第 6 阶段）。
- ★ 从 Windows 也能用：通过 SSH 端口转发在 Windows 浏览器里打开（§6.3）。

### 3.2 左边：项目和对话
- ★ 按项目（文件夹）分组列出所有对话，最近用过的在上面；每组可以折叠。
- ★ 新建对话（在当前项目）、打开文件夹作为新项目（输入路径 + 最近用过的项目；Electron 里用系统的选择文件夹对话框）。
- ★ 点一个对话就打开它，显示完整历史，能接着聊；如果属于别的项目，自动切到那个项目。
- ★ 改名、删除（删除前确认；用 macOS 的 `trash` 命令移到废纸篓，不是直接删）。
- ★ 搜索对话（按名字和第一句话）。
- 家目录 `~` 里的对话单独放一组，组名旁提示"在这里没有长期记忆"（Magic Context 在家目录不存记忆）。
- 正在回复的对话旁边有转圈标记。

### 3.3 中间：聊天
- ★ 消息流式显示，一个字一个字出来。
- ★ AI 回复用 Markdown 排版：代码块带高亮和"复制"按钮、表格、Mermaid 图、数学公式。
- ★ 思考过程可以折叠（默认折叠，显示"思考了 N 秒"）。
- ★ 工具调用显示成小卡片，默认折叠一行摘要，点开看详情：
  - `bash`：显示命令；展开看输出（超长时只显示头尾）。
  - `read`：显示文件路径，点一下在右边预览这个文件。
  - `edit` / `write`：显示文件路径和改动对比（加的行绿色、删的行红色）；点一下在右边预览。
  - `web_search` / `fetch_content`：显示搜索词或网址，展开看结果。
  - 其他工具：显示工具名和参数。
  - 失败的卡片标红。
- ★ 回复过程中输入框还能用：Enter 是"插话"（`steer`），Alt+Enter 是"做完再做"（`followUp`）；有排队的消息时在输入框上方显示出来。
- ★ "停止"按钮（发送 `abort`）；Esc 也能停止。
- ★ 顶部栏：项目名、对话名（可点击改名）、模型下拉框（分组：CLIProxy / NInfer，显示价格）、推理强度下拉框（只显示这个模型支持的档位）、**权限模式切换**（§5）。
- ★ 底部状态栏：本对话花费 `$0.12`、上下文 `ctx 9.2K / 1.05M (0.9%)`、插件状态（`setStatus` 送来的，如 Magic Context 的 `mc: ...`）。
- ★ 网络状况：AI 迟迟没回复时显示"等待模型回应 15 秒…"；出现 `auto_retry_start` 时显示"网络不稳，第 2 次重试…"；最终失败时显示原因和"重试"按钮。
- ★ 输入框里输入 `/` 弹出命令列表（来自 `get_commands`），能选 `/plan`、`/compact`、`/ctx-status` 等。
- 消息右上角的操作：复制、从这里分叉（`fork`，第二期）。
- 导出对话为 HTML（`export_html`）。

### 3.4 右边：文件面板
- ★ 标签页形式，可以同时开多个文件；第一个固定标签是"文件"（项目文件树）。
- ★ 文件树：懒加载（展开时才读子目录），隐藏 `.git`、`node_modules`、`.DS_Store`、`.pi-desk`；AI 改过的文件旁边加小圆点。
- ★ 点文件在新标签页预览；同一个文件只开一个标签。
- ★ AI 改了正在预览的文件时自动刷新（监听 `tool_execution_end` 里 `edit`/`write` 的路径，加上文件修改时间检查）。
- ★ 预览顶部：文件路径、"用默认软件打开"、"在 Finder 中显示"、"刷新"。
- ★ 各种格式的预览（只能看，不能改）：

| 类型 | 后缀 | 怎么显示 |
|---|---|---|
| Markdown | .md .markdown | 排版显示；相对路径的图片按文档所在目录去找；支持 Mermaid、公式；右上角可切换"源码" |
| 代码 / 文本 | .py .ts .js .json .yaml .toml .sh .nix .c .cpp .java .go .rs .txt 等 | shiki 高亮，显示行号；超过 1 MB 只显示前 1 MB 并提示 |
| 图片 | .png .jpg .jpeg .gif .webp .bmp .ico .svg | `<img>` 显示，默认适应宽度，可放大缩小、拖动；SVG 也用 `<img>`（这样里面的脚本不会运行） |
| PDF | .pdf | 第一版用 `<iframe>` 交给浏览器/Electron 自带的 PDF 查看器 |
| 网页 | .html .htm | `<iframe sandbox>` 显示：默认不加 `allow-scripts`（不运行脚本）、绝不加 `allow-same-origin`；有"允许运行脚本"开关 |
| 表格 | .csv .tsv | papaparse 解析，显示成表格（首行当表头可切换） |
| 表格 | .xlsx | exceljs 解析，每个工作表一个子标签，显示数值 |
| Word | .docx | mammoth 转 HTML，用 DOMPurify 清理后显示，并提示"排版可能和原文不同" |
| PPT、老格式 Word/Excel | .pptx .ppt .doc .xls | 如果装了 LibreOffice（`soffice`），转 PDF 后显示并缓存；没装就显示"用默认软件打开"按钮和"装 LibreOffice 可以预览"的提示 |
| 音频 / 视频 | .mp3 .wav .m4a .mp4 .webm .mov | 浏览器自带的 `<audio>` / `<video>` |
| 其他二进制 | 检测到 NUL 字节 | 显示文件名、大小、类型和"用默认软件打开 / 在 Finder 中显示"按钮 |
| 太大 | 超过 50 MB | 不读取，直接提示用系统软件打开 |

- 第二期：改动对比标签页（看某个文件这次对话里被改了什么）。

### 3.5 拖文件进来问
- ★ 从 Finder 拖文件到聊天区：整个窗口出现半透明提示层"松手添加到对话"。
- ★ 拖进来的文件上传到后台，存到项目的 `.pi-desk/uploads/<时间>-<原名>`；后台自动把 `.pi-desk/` 写进项目的 `.git/info/exclude`（如果是 git 仓库），不会被误提交。
- ★ 输入框下方出现附件栏：图片显示成小缩略图，其他文件显示成卡片（图标、文件名、大小），每个都有 × 可以删。
- ★ 发送时：
  - 图片：同时作为 `images`（base64）发给模型，让它直接"看到"，并在消息里写上保存路径。
  - 其他文件：在消息末尾附上"附件：.pi-desk/uploads/xxx.pdf"，AI 会用工具去读。
- ★ 从右边文件树拖文件到输入框：不上传，直接插入一个路径标签（`@src/main.ts` 样式），发送时变成路径文字。
- ★ 在输入框里粘贴图片（Cmd+V）等同于拖进来。
- 单个文件上限 50 MB，超了提示。

### 3.6 插件的弹窗（pi 的插件界面子协议）
- ★ `select`：弹出卡片，选项一行一个，点一下就选；有"取消"。
- ★ `confirm`：是 / 否。
- ★ `input`：一行输入框。
- ★ `editor`：多行编辑框，带原有内容。
- ★ `notify`：右上角提示，几秒后消失（`warning`、`error` 用不同颜色）。
- ★ `setStatus`：显示在底部状态栏。
- ★ `setWidget`：显示在输入框上方的小面板（几行字）。
- ★ `setTitle`：改窗口标题。
- ★ `set_editor_text`：把文字放进输入框。
- 弹窗出现时窗口标题闪一下 / 系统通知，免得我没注意到 AI 在等我。
- 已装插件的情况（Claude 已查过源码）：
  - **选择题**（`@juicesharp/rpiv-ask-user-question`）：在 RPC 模式下自动改用 `select` / `input`，一题一个弹窗。可以优化：看到 `ask_user_question` 工具开始执行时，把它的题目和选项提前显示成聊天里的卡片。
  - **计划模式**（`@narumitw/pi-plan-mode`）：文档写明支持 RPC，用 `select` 和 `editor`。另外它的 `Plan Mode Complete` 工具调用里带着完整计划，在聊天里用 Markdown 卡片显示出来。
  - **目标模式**（`pi-goal-x`）：命令 `/goal`、`/goal-direct`、`/goal-status`、`/goal-pause`、`/goal-resume` 等，目标记录在项目的 `.pi/goals/`。它的进度面板是为终端写的，先查它在 RPC 下发了哪些 `setWidget` / `notify` / `setStatus`（源码在 `~/.pi/agent/npm/node_modules/pi-goal-x/extensions/`），能显示的照显示；不够的话，读 `.pi/goals/` 里的 Markdown 文件自己画一个目标进度面板。顶部栏加"暂停目标"按钮（发 `/goal-pause`）。
  - **任务清单**（`@juicesharp/rpiv-todo`）：它的清单面板只在终端里显示。pi desk 要**自己画**：监听名为 `todo` 的工具调用（参数形如 `{"action":"update","id":2,"status":"in_progress","activeForm":"..."}`，完整格式去读 `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/` 的源码），在输入框上方显示一个可折叠的清单，做完的打勾。

### 3.7 安全
- ★ 后台只监听 `127.0.0.1`。
- ★ 启动时随机生成口令（32 字节，hex），打印网址 `http://127.0.0.1:4317/?token=...`；页面拿到后存进 `sessionStorage` 并从地址栏去掉；所有 `/api` 请求带 `Authorization: Bearer <token>`，WebSocket 连接带 `?token=`。没有口令一律 401。
- ★ 检查 `Host` 头必须是 `127.0.0.1:4317` 或 `localhost:4317`（防 DNS 重绑定）；WebSocket 检查 `Origin`。
- ★ 读文件只允许在"已打开的项目文件夹"里面；拒绝 `~/.ssh`、`~/.pi/agent/secrets`、`~/.config/sops`、`~/.gnupg` 下的任何东西；路径要先 `realpath` 再判断，防止软链接绕过。
- ★ 不在前端、日志、导出里出现 API key。

---

## 4. 分阶段实现步骤

### 第 1 阶段：后台能遥控 pi（不做界面）

1. `server/auth.ts`：生成口令；`checkHttp(req)` 校验 Host 和 Bearer；`checkWs(req)` 校验 Host、Origin（开发时允许 `http://127.0.0.1:5173`）和 `token` 参数。
2. `server/pi-pool.ts`：`Map<cwd, PiProcess>`。`get(cwd)` 没有就启动（加参数 `-e <项目根目录>/pi-extension/desk-permissions.ts`，路径带空格，用 `spawn` 的参数数组传，不要拼字符串，权限插件在第 5 阶段才写，先留开关，文件不存在就不加）。进程退出时从 Map 删除并通知前端。空闲 30 分钟自动关闭。
3. `server/index.ts`：
   - HTTP：`GET /api/projects`（调 `listProjects()`）、`GET /api/health`。生产模式下提供 `dist/` 静态文件，找不到的路径返回 `index.html`。
   - WebSocket `/ws`：客户端发 `{op:"open",cwd,sessionPath?}` → 后台确保进程存在，有 `sessionPath` 就 `switch_session`，否则 `new_session`；然后依次取 `get_state`、`get_messages`、`get_session_stats`、`get_available_models`、`get_commands`，回 `{op:"opened",cwd,...}`。
   - `{op:"rpc",cwd,reqId,cmd}` → 转发给 pi，回 `{op:"rpc_result",reqId,response}`。
   - `{op:"ui_response",cwd,payload}` → 原样写给 pi（插件弹窗的回答）。
   - pi 的所有事件广播给所有连着的页面：`{op:"event",cwd,record}`；进程退出：`{op:"exit",cwd,reason}`；stderr 只写后台日志。
4. 写一个命令行测试脚本 `scripts/smoke.ts`：连 WebSocket，`open` 一个临时文件夹，切到 `cliproxy/gpt-6-luna` + `low`，发"只回复 ok"，等 `agent_settled`，打印拼出来的回复和花费，然后退出。

**验收**
- [x] `npm run typecheck` 没有错误。
- [x] `npx tsx server/index.ts` 能启动，打印带口令的网址。
- [x] `npx tsx scripts/smoke.ts` 输出 `ok` 和花费。
- [x] 不带口令访问 `/api/projects` 返回 401。
- [x] `/api/projects` 返回的对话列表和 `~/.pi/agent/sessions` 里的对得上。

实际验收记录及复跑方式见 [`docs/phase-1-verification.md`](docs/phase-1-verification.md)。

### 第 2 阶段：能聊天的界面

1. `src/api/`：WebSocket 客户端（断线自动重连并重新 `open` 当前对话）、`rpc(cwd, cmd)` 返回 Promise、事件订阅。状态管理用 React 自带的 `useReducer` + Context 就够，不要引入大框架。
2. 消息模型：把 `get_messages` 的历史和流式事件合并成统一的列表。流式时按 `contentIndex` 拼 `text`、`thinking`、`toolCall` 块；`message_end` 到了用最终消息替换。工具结果按 `toolCallId` 挂到对应的工具卡片上。
3. 中间栏组件：消息列表（自动滚到底；我往上翻的时候不要强行拉回来，显示"回到底部"按钮）、Markdown 渲染（先 react-markdown + remark-gfm + 代码块复制按钮，Mermaid/公式/高亮在第 4 阶段加）、思考折叠、工具卡片（§3.3）。
4. 输入框：多行，Enter 发送、Shift+Enter 换行；回复中 Enter=插话、Alt+Enter=排队；停止按钮；`/` 命令列表。
5. 顶部栏：模型、推理强度下拉框；底部状态栏：花费、上下文（每次 `agent_settled` 后刷新 `get_session_stats`）、插件状态。
6. 网络状况提示（§3.3）。

**验收**
- [x] `npm run dev` 后打开带口令的网址，能和 gpt-6-luna 聊天，回复逐字出现。
- [x] 让它"列出当前目录的文件"，能看到 bash 工具卡片，展开有输出。
- [x] 回复过程中点停止，能停下来。
- [x] 换模型、换推理强度后再发消息生效。
- [x] 刷新页面后历史还在（重新 `open` 同一个对话）。
- [x] 终端里 `pi -r` 能看到在 pi desk 里聊的这个对话。

实际验收记录及复跑方式见 [`docs/phase-2-verification.md`](docs/phase-2-verification.md)。

### 第 3 阶段：左边对话列表

1. 左栏：项目分组列表、折叠、搜索框、"新对话"按钮、"打开文件夹"（输入路径，后台 `POST /api/check-dir` 检查存在且是目录）。
2. 打开对话、在别的项目里打开对话（切换 cwd，由 pi-pool 管）。
3. 改名（`set_session_name`）、删除（`POST /api/sessions/delete`，后台用 `trash <path>`，失败才报错，绝不 `rm`）。
4. 每次 `agent_settled` 和 `session_info_changed` 后刷新列表。
5. 家目录分组的提示；正在回复的对话显示转圈。

**验收**
- [x] 列表和终端 `/resume` 里 All 看到的一致。
- [x] 新建、切换、改名、删除都能用；删除的对话出现在废纸篓里。
- [x] 打开另一个项目的对话后，问"当前目录是什么"，AI 回答的是那个项目的路径。

实际验收记录及复跑方式见 [`docs/phase-3-verification.md`](docs/phase-3-verification.md)。

### 第 4 阶段：右边文件面板 + 预览

1. 后台 `server/files.ts`：
   - `GET /api/tree?cwd=&dir=`：列出一层，目录在前，按名字排序，隐藏 §3.4 列的那些。
   - `GET /api/file?cwd=&path=`：按 §3.7 的规则检查路径；返回原始字节和正确的 `Content-Type`；支持 `Range`（视频要用）；带 `X-File-Size`、`X-File-Mtime`。
   - `GET /api/file-info?cwd=&path=`：大小、修改时间、是不是二进制（读前 8 KB 找 NUL）。
   - `POST /api/open`（`open <path>`）、`POST /api/reveal`（`open -R <path>`）。
   - 可选 `server/office.ts`：`command -v soffice` 存在时，`soffice --headless --convert-to pdf --outdir <缓存目录> <文件>`，按"路径 + 修改时间"缓存到 `~/.cache/pi-desk/office/`。
2. 前端右栏：标签页条、文件树组件、预览分发器（按后缀选渲染器，§3.4 的表），每种渲染器一个组件，**用 `React.lazy` 按需加载**（Mermaid、shiki、exceljs、mammoth 都比较大）。
3. 这时补上聊天里 Markdown 的 Mermaid、公式、代码高亮（和预览共用组件）。
4. 聊天里的工具卡片点路径 → 右边打开预览；AI 改文件 → 文件树加圆点、已打开的预览刷新。

**验收**
- [ ] 准备一个测试文件夹 `scripts/fixtures/`（提交进仓库），放每种格式各一个小文件（md 里要有相对路径图片、Mermaid、公式；csv；xlsx；docx；png；svg；pdf；html 带一段 `<script>alert(1)</script>`；mp3 或 mp4；一个二进制文件）。逐个点开，都按 §3.4 显示。
- [ ] html 里的脚本默认不运行。
- [ ] 让 AI "在 notes.md 里加一行字"，右边已打开的 notes.md 自动刷新。
- [ ] 请求 `/api/file?path=~/.ssh/id_ed25519` 被拒绝。

### 第 5 阶段：拖文件 + 插件弹窗 + 三档权限

1. 后台 `POST /api/upload?cwd=&name=`：请求体是原始字节，存到 `.pi-desk/uploads/`，返回相对路径；维护 `.git/info/exclude`。
2. 前端：全窗口拖放提示层、附件栏、粘贴图片、从文件树拖到输入框插入路径标签（§3.5）。
3. 插件弹窗组件（§3.6），收到 `extension_ui_request` 就显示，回答时发 `ui_response`。同一时间可能来多个，排队一个个显示。
4. 任务清单面板（自己画，§3.6）。
5. 写 `pi-extension/desk-permissions.ts`（§5），pi-pool 启动 pi 时用 `-e` 加载；顶部栏加权限切换。

**验收**
- [ ] 从 Finder 拖一张截图进来问"图里有什么"，AI 能描述图片内容。
- [ ] 拖一个 PDF 进来问"总结一下"，AI 去读了 `.pi-desk/uploads/...` 并总结。
- [ ] 从文件树拖 `src/App.tsx` 到输入框，问"这个文件做什么"，AI 读的是这个文件。
- [ ] 输入"用 ask_user_question 问我用 Python 还是 Bash"，出现选择卡片，选了之后 AI 收到。
- [ ] `/plan 写一个 hello.sh` 能走完：出计划 → 弹出菜单 → 选 Implement here → 文件被创建。
- [ ] 让 AI 做一个 3 步的任务，清单面板显示并逐个打勾。
- [ ] 三档权限都按 §5 的表工作（逐条测）。

### 第 6 阶段：Electron 桌面应用 + Windows 远程

1. `electron/main.cjs`：启动时在子进程里跑 `server/index.ts`（生产模式），从它的输出里拿到带口令的网址，打开一个窗口加载它。窗口大小 1400×900，记住上次的位置。关窗口时关掉后台。
2. 原生功能（通过很小的 `preload`，只暴露需要的几个函数）："打开文件夹"用 `dialog.showOpenDialog`；"在 Finder 中显示"用 `shell.showItemInFolder`。
3. 打包：先做到 `npx electron .` 能跑；再用 `electron-builder` 打成 `pi desk.app`（不签名，第一次打开要右键→打开）。
4. Windows 远程：README 里写清楚——在 Windows 终端运行
   `ssh -L 4317:127.0.0.1:4317 kenneth@alex`，然后在 Mac 上启动 `npm start`，把打印的网址（`127.0.0.1:4317/?token=...`）复制到 Windows 浏览器里打开。

**验收**
- [ ] 双击 `pi desk.app` 能打开并正常聊天。
- [ ] 从 Windows 按上面的方法能在浏览器里用。

### 第二期（第一版用顺手之后）

- 改动对比标签页；整个对话的改动汇总（像 Codex 的"Review"）。
- 分叉对话（`fork`）、对话树（`get_tree`）。
- PDF 换成 pdf.js（统一缩放、选择文字）；Excel 用 FortuneSheet 显示格式。
- 系统通知（AI 做完了、AI 在等我回答）。
- 快捷键：Cmd+N 新对话、Cmd+K 搜索对话、Cmd+B 收起左栏、Cmd+J 收起右栏。
- 多窗口；同时跑多个对话。

---

## 5. 三档权限插件（`pi-extension/desk-permissions.ts`）

pi 本身没有权限模式。这个插件用 pi 的 `tool_call` 钩子在**每个工具执行之前**检查，需要时用 `ctx.ui.select` 问我（在 pi desk 里会变成弹窗，在终端里是终端选择框），不允许就返回 `{ block: true, reason: "..." }`，AI 会看到原因。
参考 pi 自带的例子：`$P/../examples/extensions/permission-gate.ts`，和 `$P/extensions.md` 里关于 `tool_call`、`annotations` 的部分。

### 5.1 三档规则

| | 只读 | 自动（默认） | 完全放开 |
|---|---|---|---|
| 读文件（`read`） | ✅ | ✅（敏感路径要问） | ✅ |
| 改项目里的文件（`edit` / `write`） | ❌ 拒绝 | ✅ | ✅ |
| 改项目外的文件 | ❌ 拒绝 | ❓ 问我 | ✅ |
| 安全命令（见 5.2） | ✅ | ✅ | ✅ |
| 其他命令 | ❌ 拒绝 | ❓ 问我 | ✅ |
| 危险命令（见 5.3） | ❌ 拒绝 | ❓ 问我，弹窗标红 | ✅ |
| 上网（`web_search`、`fetch_content`） | ✅ | ✅ | ✅ |
| 插件自己的工具（`todo`、`ask_user_question`、计划模式的工具、`ctx_*`） | ✅ | ✅ | ✅ |
| 其他未知工具 | 有 `readOnlyHint` 才允许 | 有 `destructiveHint` 就问，否则允许 | ✅ |

敏感路径：`~/.ssh`、`~/.gnupg`、`~/.pi/agent/secrets`、`~/.config/sops`、任何 `.env` / `.env.*` 文件。

### 5.2 安全命令

整条命令按 `;`、`&&`、`||`、`|` 拆成几段，**每一段都安全**才算安全；出现 `>`、`>>`（写文件）、`$(`、反引号、`sudo` 就不算安全。

安全的命令（第一个词）：`ls pwd cat head tail wc grep rg find（不带 -delete、-exec） echo which file stat du df tree sort uniq cut diff date whoami uname basename dirname realpath`，以及 `git status / diff / log / show / branch / remote -v / rev-parse / ls-files / blame`，`node -v`、`python3 --version` 这类只看版本的。

### 5.3 危险命令（自动模式下弹窗标红）

`rm -r` / `rm -rf`、`sudo`、`chmod -R` / `chown -R`、`git push`（尤其 `--force`）、`git reset --hard`、`git clean`、`ssh`、`scp`、`curl ... | sh` / `bash`、`mkfs`、`dd`、`kill -9`、`launchctl`、`brew uninstall`、`npm publish`。

### 5.4 问我的弹窗

用 `ctx.ui.select(标题, 选项)`：
- 标题：`需要你的允许：执行命令` + 换行 + 命令原文（或 `修改项目外的文件：/路径`）；危险命令在标题开头加 `⚠️ 危险操作`。
- 选项：`允许这一次`、`这个对话里都允许`、`拒绝`。
- "这个对话里都允许"：记住"工具 + 完整命令"（bash）或"工具 + 文件夹"（改文件），本对话内再遇到不再问；换对话清空。
- 拒绝时 `reason` 写 `用户拒绝了这个操作`，让 AI 换别的办法。
- 没有界面（`ctx.hasUI` 为假，比如 `pi -p`）时：需要问的一律拒绝，`reason` 说明原因。

### 5.5 切换档位

- 注册命令 `/permissions`：不带参数时用 `select` 让我选；带参数 `read-only` / `auto` / `full` 直接切换。
- 每次切换后用 `ctx.ui.setStatus("desk-permissions", "权限：自动")` 显示当前档位；pi desk 的顶部切换按钮就是发送 `/permissions auto` 这样的消息（RPC 里插件命令会立即执行）。
- 启动时的默认档位读环境变量 `PI_DESK_PERMISSIONS`，没有就是 `auto`。
- **只在 pi desk 启动 pi 时加载**（`-e`），终端里的 pi 不受影响。

### 5.6 测试

写 `scripts/test-permissions.ts`：直接调用插件里导出的纯函数 `decide(mode, toolName, input, cwd)`（把判断逻辑写成不依赖 pi 的纯函数，方便测试），覆盖 5.1 表格的每一格、5.2 的拆分规则（`ls && rm -rf x` 不安全、`git status | head` 安全）、5.3 的每一条。再在真实 pi 里各试一次。

---

## 6. 运行方式（写进 README）

### 6.1 开发
```bash
cd ~/Desktop/"pi harness"
npm run dev        # 后台 4317 + 页面 5173，看终端打印的带口令网址
```

### 6.2 平时用
```bash
npm run build && npm start     # 只开 4317 一个端口
```
第 6 阶段后直接双击 `pi desk.app`。

### 6.3 从 Windows 用
```bash
ssh -L 4317:127.0.0.1:4317 kenneth@alex
```
然后在 Mac 上 `npm start`，把网址贴到 Windows 浏览器。

---

## 7. 完成后交给 Kenneth 的东西

- 能用的 pi desk（浏览器版 + `.app`）。
- `README.md`：中文，写怎么启动、每个区域是什么、常见问题（连不上、口令丢了、模型报错、怎么从 Windows 用）。
- 每个阶段一个 git 提交，都已推送到 GitHub。
- 一份"已知问题"清单。
