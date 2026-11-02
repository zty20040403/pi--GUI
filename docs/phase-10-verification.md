# 第 10 阶段验收：代码改动显示

## 本次实现

- 只在 App 启动的 pi 加载 `pi-extension/desk-changes.ts`。真实 `tool_call` / `tool_result` 钩子读取 edit/write 前后快照，`agent_settled` 收尾；不改工具参数、结果或项目文件。
- 快照按会话和轮次保存在 App 设置旁的 `changes/`，默认 `~/.pi-desk/changes/`。原子改名，目录 700、文件 600；摘要索引不含正文，损坏或丢失时从对应原记录重建。不往 pi 对话追加大块文件内容，也不发给模型。
- 每轮卡片显示文件数及净新增/删除行数；点路径定位到该轮和文件。重复改同一文件按最初/最后快照比较，不简单累加。当前分支之外的改动不混入。
- 右侧“改动”固定标签：本轮、这个对话全部、Git 未提交。统一/并排共用差异数据，含行号、Shiki 高亮、长上下文展开和收起。edit/write 工具卡片使用同一个 diff 组件，但显示该工具本身的前后内容。
- 保留旧轮快照；外部文件后来变化不会改写已捕获历史。并行写同一文件、跨捕获空隙、失败/中断均说明边界；上次进程遗留的 running 不会因为新轮正在回复而一直隐藏。
- 非 Git 项目不显示 Git 范围。Git 范围比较 HEAD 与当前磁盘，包含暂存、工作区、未跟踪、删除、尚无首次提交和仓库子目录。使用只读 diff-tree/ls-files/cat-file 和实际文件字节，不触发工作区 clean/smudge/process filter，也不执行 textconv、外部 diff、fsmonitor、pager，不更新 Git index。
- 新增 `diff@8.0.4` 正式依赖，版本已核实并固定；桌面构建包含 App 的快照扩展。pi-gui 卡片布局的来源说明和 MIT 致谢已保留。

## 已实际通过的命令

所有监听 4317 的验收串行运行，测试聊天仅使用 `cliproxy/gpt-6-luna` / `low`：

- `npm run typecheck`
- `npm test`：70 项通过，包括快照统计、1 MB 上限、二进制、敏感/越界/符号链接、存储损坏、分支隔离、失败/中断、并行名额竞争、Git filter 不执行、Git index 字节不变，以及统一/并排行号、CRLF/无末尾换行、上下文折叠。
- `npm run test:desktop`：4 项通过。
- `npm run build`
- `npm run verify:phase10:capture`：真实 pi 捕获及后台重启恢复。
- `npm run verify:phase10`：真实 Chrome、真实 pi 的完整界面验收。
- 第 2、3、4、5、7、8、9 阶段相关验收全部重新通过。旧的协议替身明确返回空改动索引，不把虚拟会话当成本机真实路径读取。
- `npm run desktop:build`
- `PI_DESK_VERIFY_CHANGES=1 npm run verify:phase6`：开发 Electron 入口及打包 App 真正通过 LaunchServices 打开、聊天、改文件、显示 diff，完全退出后再次打开同一 App，选回旧对话后卡片和 diff 仍在。

最后补充并行上限检查后，70 项自动测试、4 项桌面测试再次通过，并重新构建 App、完整重跑真实浏览器和打包 App 验收。未把失败中的运行算作通过。

## 真实浏览器验收过程

`verify-phase10.ts` 使用隔离临时项目和配置，不修改用户真实模型/插件配置：

1. 创建一个 Git 合成项目，`src/math.ts` 含 90 行上下文，另有 `notes.md`。
2. 让真实模型用两次 edit 修改上述文件，用 write 新建 `src/created.ts`。
3. 卡片显示 **3 个文件，+4 / −2**；修改文件各 +1/−1，新文件 +2/−0。
4. 点击旧文件直接定位本轮；统一和并排都显示 answer 1 → 42，语法高亮实际加载。展开 87 行未改动上下文后第一行可见，再收起。
5. 通过键盘真正展开工具卡片，显示该次 edit 的 diff，原始参数另折叠。
6. 再让真实模型修改 answer 42 → 43。第一轮卡片仍是 1 → 42，“这个对话全部”则是 1 → 43。
7. 外部改写 notes.md，并新增含 script 字面量的 HTML 文件：Git 范围能看到，历史快照不随之变化，script 没有执行。
8. 刷新页面，原卡片和审阅范围恢复；关闭浏览器及后台，重新启动并打开原对话，两张卡片仍在。
9. 浏览器脚本错误为 0。

此外，打包 App 实际 edit 合成 `sample.md` 得到 **+1 / −1**，退出后通过 macOS LaunchServices 重新启动、打开历史对话并查看 diff。不是仅用网页刷新替代 App 重开。

### 验收脚本修正

- 工具 summary 中含可点击的文件预览路径，中心坐标点击可能打开预览而不是折叠项；改为键盘 Enter，并断言 details 的 open 属性，仍要求 diff 真正可见。
- 初始会话注入只在没有已保存目标时执行，不能在刷新时强行创建新对话。隔离 session 文件也按 pi 的项目子目录布局保存，以便真实列表和重开检查。
- 本机 Node 24.16.0 的 fetch 在桌面进程关闭探测中出现一次未捕获 `setTypeOfService EINVAL`。桌面存活探测改用 TCP 连接及无连接池的 Node HTTP 请求，仍严格等待旧后台退出、完整重开 App 后验证。随后完整重跑通过，没有忽略异常或放宽断言。

## 截图与本机摘要

都在忽略提交的 `.pi-desk/verification/`：

- `phase-10-card-{dark,light}-{1440,1024}.png`
- `phase-10-unified-{dark,light}-{1440,1024}.png`
- `phase-10-split-{dark,light}-{1440,1024}.png`
- `phase-10-tool-{dark,light}-{1440,1024}.png`
- `phase-10-desktop-diff.png`
- `phase-10-desktop-reopened.png`
- `phase-10-summary.json`：真实浏览器验收摘要。
- `phase-6-mac-summary.json`：包含 `changesCapturedAndAppReopened: true`。

共 18 张截图，已实际查看卡片、统一/并排、工具 diff 及重开 App 的代表截图。深浅色、1440/1024 均无页面横向溢出；窄窗口用已有侧边抽屉展示。

## 已知边界 / 没有做

- 捕获只覆盖 App 的 edit/write，不追溯升级前历史，也不把普通 bash 或终端修改冒充为捕获记录；Git 范围能查看当前未提交内容，但不能证明作者。
- 单文件正文上限 1 MB，二进制/敏感路径/符号链接不展示正文。每轮约 12 MB 快照正文、256 次操作；达到上限明确提示。累计正文过大时拒绝“对话全部”并要求逐轮查看，不静默截断。
- 快照暂不自动清理；删除对话 JSONL 不会一并删除 App 快照。README 提供退出 App 后用 Finder 移到废纸篓的清理方式。
- 并行同文件只保证记录观察到的前后状态，不承诺精确归因；停止、进程故障后的不完整快照会标注。
- 可选的“撤销这一轮”未实现，本阶段所有审阅都是只读。
- Windows 本地版、Intel Mac、Safari 未验证。独立引擎、正式图标、单实例、动态端口和 dmg/zip 安装包留给下一阶段，不把当前旧式 App 当作第 11 阶段已完成。
