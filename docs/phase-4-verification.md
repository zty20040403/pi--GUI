# 第 4 阶段验收记录

范围：`PLAN.md` §4 第 4 阶段，右侧文件树/预览及聊天的高亮、Mermaid、公式；未进入第 5 阶段。

## 最终实际执行

```bash
npm run verify:phase4
npm run verify:phase3
npm run verify:phase2
npm run verify:phase1
```

以上最终连续执行，全部退出码 **0**。包含 `npm run typecheck`、**24 组自动测试**、真实 Vite 构建。实际环境为本机 macOS、pi `1.4.0`、已安装 Google Chrome、Node.js `v24.16.0`，真实聊天只用 **`cliproxy/gpt-6-luna`、`low`**。

## PLAN.md 的 4 项验收

| 验收项 | 实际证据 |
|---|---|
| 提交小文件 fixtures，逐个按格式预览 | `scripts/fixtures/preview/` 中的 MD、Python、CSV、TSV、XLSX、DOCX、PNG、SVG、PDF、HTML、MP3、二进制和 PPTX 都是合成内容。Chrome 实际逐个点击：MD 排版、相对 PNG、Mermaid、两处 KaTeX、源码及 Shiki；CSV 引号内逗号和表头切换；Excel 两张表及缓存公式数值 50；Word 标题/表格及提示；图片加载与缩放；PDF 原生查看器；MP3 实际播放时间前进；二进制信息；PPTX 在无 LibreOffice 时显示安装提示和默认软件按钮。另测了前 1 MB、超过 50 MB 不请求内容 |
| HTML 脚本默认不运行 | 真文件含 `<script>alert(1)</script>` 及 DOM 标记。默认 iframe `sandbox=""`，标记不存在，HTML/SVG 均未弹窗。手动勾选后，标记出现但访问 `parent.document` 被拒；主页面标记不变。iframe 始终**没有** `allow-same-origin`，CSP 禁止外部请求、表单和 base URL |
| AI 修改 notes.md 后预览自动刷新 | 在真实临时项目里打开 notes.md，luna/low 真正调用 read 和 edit/write 添加唯一测试行。未点击刷新，预览显示新行；磁盘读取也存在；真实 WS 有成功 `tool_execution_end`；树节点出现修改点。再收起面板、点击工具路径，重新打开同文件。另用测试程序写文件，独立的 mtime 轮询也自动更新 |
| 敏感文件请求拒绝 | 真正向后台带 Bearer 请求 `/api/file?path=~/.ssh/id_ed25519`，得到 **403**，没有读取该文件；另项目越界路径 403、无口令 401。自动测试覆盖敏感目录的真实软链接目标，不能靠重新打开其目标目录绕过 |

不是仅看源码或比较截图：预览使用真实 HTTP、文件字节、Chrome、DOM、文档解析 worker、pi 和工具执行。PDF 截图中实际可见浏览器工具栏和 **PDF PREVIEW OK**；MP3 的播放时间实际从 0 前进，样例为合法 MPEG-1 Layer III 静音帧，没有使用第三方录音。

本轮第 4 阶段真实会话显示 **`$0.001232`**，为测试会话金额，不是整个开发过程累计花费；复跑会变化。文件预览本身不调用模型。

## 额外真实浏览器验证

- 子目录未展开前没有 HTTP 子目录请求；展开后实际读取/显示 Nested/inside.txt。
- 通过内部文件软链接再打开 MD，仍只有一个 canonical 文件标签。
- 代码的 `<img onerror=...>` 只是被转义的文本；复制返回原代码，不含行号。
- Word 转换出的 `javascript:` 链接被 DOMPurify 去掉 href。
- 所有文件请求带 Bearer；图片/PDF/媒体使用本地临时 Blob URL，URL 不包含口令。
- 超过 50 MB 的稀疏测试文件只有 metadata 请求，没有 `/api/file` 内容请求。
- 切到另一个项目不显示前项目的标签/内容，切回恢复原标签；页面刷新后仍恢复打开的文件。
- 真模型另发一条 Markdown 回复，在聊天区实际显示 Shiki、Mermaid 和 KaTeX，与文件预览共用组件。
- 生产模式 `dist` 在 4317 实际解析并预览 XLSX、DOCX，验证模块 worker 和按需分包不只在 Vite 开发模式可用。
- 最终浏览器 `pageerror` 为零。测试初始化代码只注入主窗口，不访问 sandbox 子框架的 sessionStorage；没有为了通过测试放宽沙箱或过滤错误。

## 后台、状态和安全测试

新增文件测试与预览状态测试，加上前三阶段测试，共 **24 组**通过：

- 只允许当前后台曾成功 open 的 canonical 项目；先 realpath，拒绝父目录越界、外部软链接、非普通文件及缺失路径。
- 敏感目录同时保护原路径和真实目标；额外屏蔽 pi 模型/会话配置目录、CortexKit、凭据文件等，不把配置连接信息提供给文件面板。
- 文件树只读一层，目录优先排序、过滤 `.git`/`node_modules`/`.DS_Store`/`.pi-desk` 和敏感条目，跳过循环目录链接。
- 信息只读前 8 KB 检测 NUL；大于 50 MB 时不读内容。无读取权限的超大文件仍可报告信息，证明仅 stat。
- GET/HEAD、正确 MIME、`X-File-Size`/`X-File-Mtime`、单段起止/后缀 Range、206、416、多范围拒绝。
- 使用已校验的同一个文件句柄，拒绝读取期间已改变的文件；流结束/中断回收句柄。
- 系统打开接口校验后用参数数组调用 `open`/`open -R`，包含空格的路径仍作为一个参数；自动测试注入执行器，不启动用户 GUI。
- 标签去重、项目隔离、关闭选择、文件版本/修改点、不变 mtime 不触发重复更新。
- Office ZIP 展开体积和目录数量限制，坏 ZIP/明显压缩炸弹拒绝；Word/Excel 解析可在 15 秒超时后终止独立 worker。

## 依赖和分包

新增固定版本：Shiki `4.5.0`、remark-math `6.0.0`、rehype-katex `7.0.1`、KaTeX `0.19.1`、PapaParse `5.5.3`、ExcelJS `4.4.0`、Mammoth `1.13.0`、DOMPurify `3.4.17`、`@types/papaparse` `5.3.16`。安装前逐个 `npm view <包>@<版本> version` 确认存在。

同时固定更新 ws `8.22.1`、tsx `4.23.15`、Vite `5.4.21`、Mermaid `11.17.2`。KaTeX 使用显式 npm override 统一转递依赖到同一个已修复版本；最终全部真实预览和前阶段回归是在该版本上执行。

重库/格式使用 React.lazy，Shiki 按语法动态加载，Word/Excel 在模块 worker 按需载入。主页面脚本约 364 KB（gzip 117 KB），大块图表/语法包仍有 500 KB 分包警告，未把警告阈值调高掩盖问题。

`npm audit` 仍有 **11 项：10 moderate、1 high**，主要为 Vite 开发链与 ExcelJS 的存档依赖，不能宣称全绿。high 是 Windows launch-editor；本机后台为 Mac，生产服务仅提供 dist，不运行 Vite 开发服务器。已限制开发 Host/CORS/fs、固定端口，没有用 `npm audit fix --force` 擅自跨越 PLAN 指定的 Vite 大版本；剩余补丁需独立验证。

## 前三阶段最终回归

- 第 3 阶段三项及补充测试通过；真实 All 文件集合开始 7、操作后 10，目录切换/pwd、改名、废纸篓删除和恢复均验证。最后一段 `$0.000857`。
- 第 2 阶段六项及生产历史恢复通过；流式 DOM、工具卡片、停止、模型/推理切换、刷新/重连、终端 pi -r、IME/队列/网络提示/滚动均保留。该轮 `$0.001203`。
- 第 1 阶段五项通过：smoke `ok`，`$0.000371`、8520 tokens；4 项目、7 对话与实际文件一致，无口令请求 401。
- 旧的模拟页面增加新文件树接口的模拟响应；“收起左栏”断言明确限定左侧对话列表，而不是错误地要求整个页面没有右栏。未跳过或删除验收。

## 已查看截图、清理和未验证范围

实际读取并查看 `.pi-desk/verification/phase-4-{markdown,xlsx,docx,pdf,light,dark}.png`。截图只展示合成测试项目，不展示用户其他对话；该目录忽略提交。Mermaid 图按实际 viewBox 尺寸显示，避免小图被无谓拉满整个聊天宽度；相对图片实际加载成功。

测试浏览器、后台、临时项目及新建测试对话已清理，只用 `trash`，没有永久删除用户文件或修改 pi 模型/插件/CortexKit 配置。4317、5173 没有测试服务遗留。

未实测：Safari、Windows、系统打开按钮的实际 GUI 窗口、装好 LibreOffice 后的隔离转换（本机未安装，缺失分支已实测）。转换使用独立缓存 profile、宏保护、系统 sandbox 和超时，失败保留“用默认软件打开”；不宣称安装版已经验收。长源码、文档行/列/展开体积设有限制以避免窗口卡死。

还没做：第 5 阶段附件、完整插件弹窗、清单面板和三档权限；第 6 阶段 Electron 和 Windows 远程。第 4 阶段后按规则停下来，不自行进入下一阶段。

复跑：关闭其他 4317/5173 后台，在仓库运行 `npm run verify:phase4`。样例需要重生成时用 `npm run fixtures`，它只生成合成内容，不读取私人文件。
