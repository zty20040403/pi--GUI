# 第 8 阶段验收：Codex 式菜单与推理滑杆

## 完成内容

- `Popover` / `Menu`：自绘面板、默认向上弹出、自动避边、外部点击关闭、同一时间只开一个。支持搜索、方向键、Enter、Esc、焦点返回、跳过禁用项，以及 `menu` / `menuitemradio` / `aria-checked`。
- 合并模型与推理胶囊，例如 `gpt-6-luna · 低`。模型支持搜索、提供商分组、输入/输出价格、当前项勾选；下方直接调整推理。
- 推理滑杆只使用真实 `get_available_thinking_levels` 返回值，不写死档位集合；鼠标拖动松手后提交一次，点刻度和键盘也可调整。模型不支持或只有一个档位时禁用并解释。
- 权限三项自绘菜单；“完全放开”用红色提示并二次确认，默认聚焦取消，取消不发送权限修改。
- 原验收中的原生 `selectOption` 全部替换为 `scripts/ui-helpers.ts` 的 `chooseModel` / `setThinking` / `setPermission`；保留原来的真实行为断言。
- `ModelBar.tsx` 标明 pi-gui 出处；README 致谢、完整 MIT 文本以及打包后的 `app.asar/licenses/pi-gui-MIT.txt` 均保留。

## 已实际运行

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 57 项通过，0 失败 |
| `npm run test:desktop` | 4 项通过 |
| `npm run verify:phase8` | 通用菜单、浏览器界面、真实 pi 隔离模型三部分全部通过 |
| `npm run verify:phase2` | 全部通过，包含真实模型/推理切换与聊天 |
| `npm run verify:phase3` | 全部通过，包含会话新建/切换/改名/废纸篓删除 |
| `npm run verify:phase4` | 全部通过，包含文档/媒体预览和真实文件编辑刷新 |
| `npm run verify:phase5` | 7 项通过，包含真实插件问题/计划/任务清单/权限；105 条权限流水线检查通过 |
| `npm run verify:phase7` | 同步保护、失效目录、故障中文提示、通知过滤均通过 |
| `npm run desktop:build` + `npm run verify:phase6` | 打包成功；macOS LaunchServices 实际打开 App、Luna/low 聊天、Markdown 预览、Finder 显示通过 |

这些会监听同一个端口的验收都是串行运行。付费聊天仍只用 `cliproxy/gpt-6-luna` + `low`。第 8 阶段本身的菜单专项测试不调用模型。

### 键盘与鼠标专项

`verify-menu.ts` 和 `verify-phase8.ts` 在真实 Chrome 中操作页面：

- 全程键盘打开模型面板 → 输入 luna → 选择 → Home/方向键调到低 → Esc 关闭，检查焦点返回胶囊。
- 权限项上下移动、跳过禁用项、Enter 选择；打字过滤、空结果、清除过滤；Tab 从列表移到滑杆。
- 窗口边缘自动避让、滚动/调整窗口后重新定位；切另一个菜单和点击外部关闭。
- 鼠标连续拖动不发设置请求，松手只提交一次。
- 六档、两档、仅 off 的界面变化；设置 RPC 失败不假装成功，当前模型保持不变并显示错误。
- 权限取消不发送 `/permissions full`，确认才发送；回复开始时模型面板关闭并禁用。
- 深浅主题、1440/1024 宽度无横向溢出，`prefers-reduced-motion` 下不播放菜单动效。

上述界面压力场景使用明确的 WebSocket 合成数据，以稳定覆盖真实账号未必配置的模型能力及失败分支。

### 真实 pi 验证（不是只测模拟数据）

`verify-phase8-pi.ts` 使用本机系统 pi 1.4、临时的 agent/session 目录以及测试扩展注册的两个合成模型，不读取或改写用户模型配置，也不发送模型请求：

1. 真实 RPC 返回五档 `off / minimal / low / medium / high`，界面刻度与返回数组逐项相同。
2. 用新菜单切到非推理模型，真实 RPC 返回仅 `off`，界面只剩一个刻度，滑杆禁用并显示原因。
3. 切回推理模型并设置 low。
4. 通过真实权限扩展切换只读 → 自动 → 完全放开 → 自动；完全放开需通过新确认框。

摘要保存于 `.pi-desk/verification/phase-8-pi-summary.json`。这证明档位来自真实 pi；并不表示对合成模型执行过推理。真实已配置模型的切换和聊天由第 2–7 阶段回归覆盖。

## 截图

均位于忽略提交的 `.pi-desk/verification/`，命名如下：

- `phase-8-models-{dark,light}-{1440,1024}.png`
- `phase-8-no-reasoning-{dark,light}-{1440,1024}.png`
- `phase-8-permissions-{dark,light}-{1440,1024}.png`
- `phase-8-permission-confirm-{dark,light}-{1440,1024}.png`

共 16 张，使用合成项目与模型数据，避免将用户真实会话标题/配置带进截图。已查看模型面板和权限菜单截图，确认不再显示原生 select。

## 使用方式与边界

- 重开 `~/Applications/pi desk.app`。底部点击模型胶囊，搜索 luna，选择后用下方滑杆或方向键调到“低”，Esc 返回。
- 点击权限胶囊可查看三项说明。“完全放开”确认框中取消不改变权限。
- 不额外向模型服务发送在线探测请求。配置列表存在不代表此刻在线；当前模型从可用列表中移除时会灰显并说明。网络故障仍由已有中文错误界面处理。
- 这次没有新增 npm 依赖，没有修改用户 pi 配置，没有改变工具权限的执行边界。
- Safari、Windows 本地桌面版及 Intel Mac 未在本轮验证；Windows 本地版不是本阶段范围。第 9–11 阶段尚未在本阶段实现。
