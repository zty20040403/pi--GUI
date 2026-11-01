# 第 2 阶段验收记录

范围：`PLAN.md` §4 第 2 阶段，聊天界面；没有进入第 3～6 阶段。

环境：这台 Mac 的 Node.js `v24.16.0`、npm `11.13.0`、pi `1.4.0`、已安装的 Google Chrome。浏览器自动操作使用固定开发依赖 `@playwright/test` `1.64.1`，以真实 Chrome headless 运行；不是只检查页面源码。

## 最终实际运行

```bash
npm run verify:phase2
npm run verify:phase1
```

最终两个脚本连续退出码均为 0。第 2 阶段脚本内部执行 `npm run typecheck`、`npm test`、`npm run build`，再真实启动 `npm run dev`、操作 Chrome、启动终端 `pi -r`；最后另起生产后台，验证构建页面恢复历史。

## PLAN.md 的 6 项验收

| 验收项 | 实际验证方式与结果 |
|---|---|
| 开发模式能与 gpt-6-luna 流式聊天 | 从后台打印的真实口令网址进入 Vite 页面，选择 `cliproxy/gpt-6-luna` + `low`，发送 80 行列表请求。监听到多个 `text_delta`，MutationObserver 实际观察到回复尚未结束时不同长度的 DOM；不是只看到最终文本 |
| 列目录看到 bash 卡片，展开有输出 | 在临时项目里通过输入框发“列出当前目录的文件”，AI 真正调用 bash。卡片默认折叠，点击展开后显示 `alpha.txt`、`README.txt`，内容来自真实 `ls` |
| 回复中停止 | 请求 300 行列表，在收到真实文字增量、回复仍在进行时点击“停止”。浏览器发出 `clear_queue` + `abort`，收到 `agent_settled` 且 `aborted: true`；停止按钮消失，之后仍能继续聊天。正常停止不显示红色网络错误 |
| 换模型/推理后发消息生效 | 实际切到另一个已配置模型，再切回 luna；推理实际切到 `off` 再切回 `low`。再次发消息，最终 assistant 记录的 provider/model/thinkingLevel 为 `cliproxy` / `gpt-6-luna` / `low`，磁盘也有 model_change 和 thinking_level_change。遵循省钱要求，其他模型只切换，不发付费请求 |
| 刷新后历史仍在 | 刷新真实页面，`opened.state.sessionId` 不变、用户消息数量不变、先前回复仍在。另实际关闭聊天 `/ws`，自动重连后再次验证同一 id 和历史，不重发用户消息 |
| 终端 pi -r 能看到同一对话 | `scripts/check-resume.py` 用真实伪终端在临时项目中运行 `pi -r --tui-mode regular --offline`，对话选择器确实显示浏览器首句的唯一标记；没有用读 JSONL 替代终端验收 |

本次最终真实浏览器对话显示总花费 **`$0.002510`**。金额会随运行改变，不把这个固定数字当作断言。

## 额外通过的检查

- **类型、单元/后台测试**：10 组测试全部通过、无跳过。覆盖 JSONL 多字节与 Unicode 分隔符、id 关联、进程池、鉴权、历史与流式合并、工具结果关联、队列/重试/压缩/插件状态、口令清理、快照顺序号去重、重连不重复 prompt、打开失败保留原对话。
- **真实浏览器中的模拟协议测试**：Markdown 表格和代码复制；不执行 Markdown 中的 HTML 脚本；默认折叠思考与工具、失败卡片；中文 IME 确认不发送、Shift+Enter 换行；Enter 插话、Alt+Enter 排队、Esc 停止并恢复队列文字；等待秒数、重试次数、失败后的重试按钮；插件状态；向上滚动不跳到底、回到底部按钮；系统深浅色与 600px 窄窗口不横向溢出。
- **打开期间的插件提问**：模拟后台在 `opened` 前等待 confirm。前端立即安全取消并收到打开结果，没有被历史缓冲机制卡住。完整插件弹窗仍属于第 5 阶段。
- **真实生产页面**：构建 `dist/` 后另起生产后台，在 4317 的页面打开同一保存的会话，历史和最后回复正确，没有额外模型调用。
- **后向回归**：第 1 阶段完整 5/5 再次通过。smoke 真实回复 `ok`，花费 `$0.000855`、8521 tokens；无口令 `/api/projects` 返回 401；4 个项目、7 个对话与真实文件逐项一致。
- **浏览器错误**：真实聊天测试未产生 pageerror；口令进入 sessionStorage 后已从 URL 去除。

网络等待/重试、插话/排队等边界情况使用可控协议和时钟，但运行的是实际 Chrome、实际 React 页面；6 项主验收中的聊天、工具、停止和会话均使用真正的本机 pi 和模型。没有为测试故意制造付费模型故障。

## 实现中的关键约定

- 每个项目一个活动 pi，对话文件和终端共用；只用 React useReducer + Context 管状态。
- 按 `contentIndex` 合并流式块，`message_end` 替换最终消息，工具结果按 `toolCallId` 关联。
- `opened.seq` 和事件 `seq` 表示同一子进程的 stdout 顺序，防止快照与缓冲增量重复拼接。
- 重连同一活动会话不执行 `switch_session`，避免中断正在生成的回复；未确认的命令不自动重发。
- 停止先清除队列再 abort；排队内容放回输入框。模型切换后重新读取实际状态和支持的推理档位。
- Token 和当前对话只在标签页 sessionStorage；不把口令、模型连接地址或私人对话写入提交。

## 截图、清理和复跑

实际截图：`.pi-desk/verification/phase-2-light.png`、`phase-2-dark.png`，已经查看过。该目录被 `.gitignore` 忽略，没有提交截图或测试运行时数据。

测试后台、Chrome 和终端的独立子进程组均已关闭。只对测试创建的目录/对话使用 macOS `trash`；没有永久删除用户对话，也没有修改用户的模型、插件、CortexKit 配置。

关闭其他占用 4317 / 5173 的后台后，在项目根目录运行 `npm run verify:phase2` 即可复跑。需有本机 Chrome、Python 3、`pi`、`trash`，且 luna 模型可用。

## 未做或未验证

- 左侧项目/对话列表、改名/删除：第 3 阶段。
- 文件预览、Mermaid/公式/代码高亮：第 4 阶段。
- 附件、完整插件弹窗、任务面板与工具权限：第 5 阶段；当前需要插件交互时安全取消并提示，不冒充已经支持。
- Electron、Windows 远程：第 6 阶段；Safari 未做实测。
- 历史思考耗时没有 pi 提供的记录时不编造，显示可折叠内容而非虚假的 N 秒。
- 初始固定依赖仍存在 npm audit 告警，单独列入后续安全补丁/回归；没有跨版本自动升级或宣称审计全绿。
