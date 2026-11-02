# 第 5 阶段验收记录

范围：`PLAN.md` §4 第 5 阶段，附件、插件弹窗、任务清单和三档权限；**没有进入第 6 阶段**。

## 最终实际执行

```bash
npm run typecheck
npm test
npm run build
npm run verify:phase5
npm run verify:phase1
npm run verify:phase2
npm run verify:phase3
npm run verify:phase4
```

类型检查、**46 组自动测试**、真实生产构建和全部阶段验收通过。第 2 阶段的旧模拟页面更新为“实际点击取消并收到回答确认”，不再依赖第 2 阶段曾有的自动取消行为；没有删除或跳过原验收。

环境：本机 macOS、Node.js `v24.16.0`、用户原来的 pi `1.4.0` 启动器、Google Chrome。最终第 5 阶段脚本在**每个新对话后重新设置 `cliproxy/gpt-6-luna` / `low`**，并逐条断言 assistant 的 provider、model、thinkingLevel；最后完整一次聊天合计 **`$0.007907`**。这是该轮验收的金额，不是整个开发过程累计费用。

## PLAN.md 的 7 项

| 验收项 | 实际证据 |
|---|---|
| 拖截图并描述内容 | Chrome 生成完全合成的 PNG 截图：PI DESK 标题、红圆和蓝矩形。通过真实 File/DataTransfer 拖放事件显示全窗口提示、上传、缩略图和发送。磁盘字节与截图完全一致；luna/low 描述颜色/形状；真实用户消息含 image 块，历史能显示图片；Git check-ignore 确认上传被排除 |
| 拖 PDF 并总结 | 拖入已有的合成 PDF，后台保存在隐藏上传目录。真实 read 工具读取 `.pi-desk/uploads/...` 对应文件，模型总结出正文 **PDF PREVIEW OK**，不是只看文件名 |
| 从文件树拖 App.tsx | Chrome 用实际 HTML5 拖动把 `src/App.tsx` 拖到输入框，显示 `@src/App.tsx`；上传数量不增加。真实 read 的路径归一化后正是该文件，模型解释 React 聊天界面的用途 |
| 选择题工具 | 已安装的 ask_user_question 插件实际发出选择请求。页面出现 Python/Bash 卡片，点击 Python 后工具成功返回，模型回复已选择 Python；不是模拟这个插件 |
| 完整计划流程 | 真正 `/plan` 生成计划，聊天里有 Markdown 计划卡片；真正菜单包含 Implement here，实际点击后 AI 创建当前项目 hello.sh，磁盘内容包含 hello。规划期的只读检查若触发自动模式审批，只批准严格限定的合成文件查看命令 |
| 三步清单 | 模型通过 todo 创建正好三项，实际 read README.txt、write step-two.txt、edit 到 AFTER FIXTURE。观察工具快照完成数 **0→1→2→3**，最终页面三项打勾；刷新后从当前分支恢复相同清单 |
| 三档逐条 | 页面真实只读模式拒绝 write 且文件不存在；自动对项目外 write 弹窗，批准后临时文件存在；危险 rm 标红并默认聚焦拒绝，点击拒绝后工具失败且目标文件完整；完全放开实际 write 不弹窗。另用真正 pi 工具流水线执行 **35 条 × 3 档 = 105 条** 检查 |

拖入截图的验收使用标准浏览器文件拖放接口，即 Finder 文件进入 Chrome 后的 File/DataTransfer 路径；没有依靠右侧预览或只检查源码。右侧项目文件的拖入则使用真实 Chrome 鼠标 HTML5 拖动。

## 插件 UI 的额外实测

`scripts/fixtures/ui-extension.ts` 仅由验收后台加载，调用真实 `ctx.ui`；正常 `npm start` 不加载它、不添加这些测试命令。

- select：选项点击、取消；待回答时实际刷新页面，恢复原 id 并继续回答。
- confirm：实际选择“否”，插件收到 false；默认焦点放在否。
- input：实际提交一行文字；editor：原有两行内容可见，实际修改并提交两行。
- Promise.all 同时发出两个问题：只显示一个，提示后面还有一个；逐个回答后插件收到两个值。
- notify：info/warning/error 使用不同颜色，实际等待后自动消失。
- setStatus、上下两种位置的 setWidget、清除面板、setTitle、set_editor_text：真实 DOM/窗口标题/输入值均检查。
- Cmd+V：真正写入浏览器图片剪贴板再按 Mac Meta+V，产生上传附件；移除卡片后文件仍保留。
- 目标备用面板：读取项目中暂停的合成目标记录，显示状态/目标/任务及“暂停目标”按钮。没有为了验证面板驱动长期目标；暂停命令语义沿用安装的 pi-goal-x。

后端和状态测试另外覆盖未知/错误类型/不在选项内/重复/过期回答拒绝，多个项目的待答状态不丢失，以及停止时显式取消未传 AbortSignal 的插件等待。

## 权限测试的真实性和安全边界

`scripts/test-permissions.ts` 覆盖 §5.1 每格、所有安全命令与分段/引号规则、§5.3 每条危险命令、目录 realpath/父目录链接、批准范围、对话切换清空、无 UI 拒绝及批准期间改档/换对话。真实 CLI 还验证扩展加载、三档切换和 `/permissions` 菜单。

`scripts/verify-permissions.ts` 使用 pi `1.4.0` 的 SDK、真实 runToolCall 和 tool_call 钩子，不是直接只调用 decide：

- read/edit/write 是内建工具，真正读写完全独立的临时项目/外部目录，逐项检查文件或内容。
- shell/上网/自有工具/未知工具的执行器是**明确测试替身**，工具参数校验、权限钩子和嵌套执行事件仍为真正 pi。危险命令只确认“会被阻止/会提问/会到达替身”，**没有执行删除、提权、推送、ssh 或格式化操作**。
- SDK 所需的 assistant 发起条目是显式测试输入，不是模型生成的回复；该矩阵不调用模型，不使用真实凭据或联网。
- 35 条中包含敏感 read、项目内外 edit/write、安全/其他命令、危险清单、所有自有类别和未知工具只读/破坏/中性标记；只读失败还断言确实由权限拒绝，不把参数错误或工具缺失误算成通过。

审批仍不是操作系统沙箱；扩展自身的宿主代码和受信工具的注解不能当作强隔离。文件预览/上传接口的项目和敏感路径限制独立存在，完全放开不取消这些限制。

## 上传、状态与模型配置

- 原始字节上传，50 MB 真正流式边界实测；超限未完成文件实际移到废纸篓，无永久删除退路。
- 名称拒绝目录、控制字符和 NUL；唯一名称、0600 文件权限、O_NOFOLLOW 和上传目录 realpath 检查。链接不能写到项目外。
- Git 本地排除保留原文件，只追加一次；普通仓库、子目录规则和 worktree 共用排除配置均验证。
- WS 只提交附件引用；后台检查文件范围/大小/类型后组装 images 或路径。每次最多 12 个、合计 100 MB，单个最多 50 MB；PNG/JPEG/GIF/WebP 原生看图，其他格式作为文件。
- UI 状态由 pi 进程缓存并带序号，重连先恢复待答状态；回放的旧 setStatus 不会覆盖新快照。回答先经过题目 id/类型/选项校验，再写入 pi 和返回确认。
- 清单从 get_entries 的 leafId 沿 parentId 重建当前分支，rpiv-todo-state 的最新有效自定义条目优先；不误用废弃分支或仅依赖 get_messages，支持嵌套 todo。
- SDK 固定为开发依赖 `1.4.0`（npm view 已确认），不嵌入网页/生产发动机。发现 npm 把 SDK 自带 node_modules/.bin/pi 放到用户启动器之前，裸 CLI 在本机触发文件句柄/libuv 崩溃；已在子进程 PATH 排除此目录，验证原启动器的启动、新建、查询和退出无警告且 exit 0，未修改用户配置。
- 截图检查发现旧验收脚本只在第一个对话设模型，而 pi 新对话会恢复默认模型。最终脚本已逐个重设 Luna/low，并核对每条真实回复元数据，不以“下拉框曾经选过”代替验证。

## 回归、截图与清理

前四阶段全部实际回归通过：后台口令/列表/真实 ok；聊天流式/工具/停止/模型档位/重连/终端 pi -r；列表 All、跨项目 cwd、改名与废纸篓；全部文件预览、HTML 沙箱、真实 AI 修改自动刷新及生产文档 worker。

已实际查看最后一轮 `phase-5-light.png`、`phase-5-dark.png`、计划菜单和危险拒绝截图；最新图里模型是 Luna、推理 low，拒绝按钮有默认焦点。浏览器 pageerror 为零。截图和 JSON 摘要只存在忽略提交的 `.pi-desk/verification/`，不提交口令或私人会话。

测试后台、浏览器已关闭；临时项目和捕获的测试对话使用 macOS trash 清理，没有永久删除用户文件，没有修改用户模型、插件或 CortexKit 配置。

## 未做或未验证

- 第 6 阶段 Electron/Mac 应用、Windows 远程；Safari、系统级通知；LibreOffice 安装后的转换分支仍未实测。
- 目标暂停按钮有真实命令接线，但本阶段没有驱动一个长期目标专门测暂停/恢复调度。
- 大附件/文档仍有限制；上传卡片移除不是磁盘删除，已上传文件由用户自行管理。
- npm audit 仍为 **13 项（11 moderate、2 high）**：Vite、ExcelJS 存档链及 SDK 开发依赖的 undici 等。没有以 npm audit fix --force 擅自跨越版本；需独立补丁回归，不宣称依赖安全全绿。

复跑：先关闭占用 4317/5173 的后台，执行 `npm run build && npm run verify:phase5`。日常使用 `npm run dev` 或 `npm run build && npm start`，不使用验收后台入口。
