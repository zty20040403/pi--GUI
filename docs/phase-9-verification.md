# 第 9 阶段验收：插件管理页面

## 本次实现

- 左栏新增“插件”入口；已安装 / 发现 / 更新三个标签，搜索、下载量排序、版本、来源、许可证和外部 GitHub 链接。
- 全局 npm 包、本地扩展、pi 内置扩展启停；setup.sh / Nix 管理的本地文件标注来源，不提供删除。
- 真实 `pi install` / `pi remove`，严格校验包名和确切版本，命令使用参数数组。安装风险、卸载删除文件均在确认框说明；更新失败尝试恢复原固定版本。
- 只改 pi 全局 settings.json 的 packages / extensions，备份原文，兼容 pi 的文件锁、检测外部编辑、原子改名。为避免 CLI 改动其他配置，包操作使用临时配置副本和实际 npm 目录，最后合并目标包声明。
- 启用时恢复停用前的自定义资源筛选。拒绝修改受保护目录、符号链接设置文件和指向别处的 npm 安装目录。
- 重载等待所有项目空闲及插件问题结束；等待期间可取消。重启后恢复对话、保留草稿、不重发消息，清除旧进程的插件 UI 顺序号。
- 管理操作不注册为 AI 工具；浏览器需真实手势、来源检查和短期一次性票据。不是操作系统沙箱，也不承诺阻止任意 shell 程序自行运行包管理器。

## 自动与界面验收

以下命令均实际通过，监听 4317 的验收依次运行，未并行占用同一端口：

- `npm run typecheck`
- `npm test`：64 项通过，含插件设置保留/备份、包名/版本、插件清单、启停筛选、外部修改冲突、失败回滚、票据和来源限制、忙时重载等待/取消。
- `npm run test:desktop`：4 项通过。
- `npm run build`
- `npm run verify:phase9`
- 第 2、3、4、5、7、8 阶段全部验收重跑通过。
- `npm run desktop:build` 与 `npm run verify:phase6`：重新打包的 Mac App 通过 LaunchServices 实际打开、真实聊天、文件预览和 Finder 显示；新增插件页及 GitHub IPC 接线已测试。

`verify-phase9-ui.ts` 使用隔离 npm/pi 替身：实际 Chrome 操作已安装、发现、更新；取消不改变开关；模拟安装失败后重试；固定版本更新；卸载确认；拒绝脚本合成点击；重载后草稿保留。替身结果不冒充真实包安装证据。

## 真实 pi / npm 验收

`verify-phase9-real.ts` 使用临时 `PI_CODING_AGENT_DIR` 和临时项目，浏览器逐步操作真实后台：

1. 在发现页搜索并实际安装 `pi-web-access@0.46.0`，真实 `pi list` 出现固定版本。
2. 停用使四类资源筛选全部为空，重载后 Luna/low 回答“没有搜索工具”，没有调用 web_search。
3. 恢复启用并重载后，Luna/low 实际调用 web_search，Exa 返回 Node.js 官网。不是模拟结果。
4. 从发现页实际安装 `@juicesharp/rpiv-ask-user-question@2.15.0`，用 `pi list` 确认出现；页面确认卸载后，再用 `pi list` 确认消失。
5. 其他设置字段保持原值，备份产生；真实空对话重载后的草稿也保持不变。
6. 浏览器直接外网请求为 0；npm 查询由后台完成。用户原 settings.json / models.json 的字节摘要在测试前后相同。

首次搜索测试因模型补齐空 `model` / 空 `queries` 被第三方插件拒绝，未将失败记为通过。按插件文档将**隔离测试配置**限制为 `webSearch.allowedProviders: ["exa"]`，使用非空 queries 后重跑完整测试通过；未修改用户配置或第三方源码。最终一轮真实测试模型费用约 $0.000589（不包含之前重试和旧阶段回归）。

### setup.sh 验收边界

本机 setup.sh 会解密凭据并重建 Nix/扩展链接，按 AGENTS.md 禁止触碰用户受保护配置，因此没有直接重跑完整脚本。

脚本读取当前 activation 中实际使用的 `merge-json-settings.py` 路径与声明参数，逐个在隔离 settings.json 上运行同一 Python 合并器。确认声明不含 packages/extensions；合并前后完整 JSON 一致，停用配置和其他字段均保留。该证据覆盖**当前 setup.sh 的设置合并行为**，不覆盖未来改变声明后的脚本，也不声称已测试其解密/链接重建部分。

## 截图

本机 `.pi-desk/verification/`（忽略提交）：

- `phase-9-installed-{dark,light}-{1440,1024}.png`
- `phase-9-discover-{dark,light}-{1440,1024}.png`
- `phase-9-install-confirm-{dark,light}-{1440,1024}.png`
- `phase-9-updates-{dark,light}-{1440,1024}.png`
- `phase-9-real-installed-{dark,light}.png`
- `phase-9-real-summary.json`：隔离真实验收摘要。

共 18 张截图。已查看已安装、发现、确认、更新和真实配置的代表截图，深浅主题及 1024 窄窗口无横向溢出，确认弹窗保持在屏幕内。

## 尚未做 / 不在本阶段验证范围

- 仅管理全局插件，项目 `.pi/settings.json` 覆盖规则不由该页面修改。
- 不对用户实际插件执行安装、卸载或停用；真实修改全部发生在隔离验收配置。
- 更新失败/恢复旧版路径用替身确定性验证；真实 npm 验证的是安装与卸载。
- npm 插件和安装脚本不是沙箱代码；只应安装信任的来源。
- Windows 本地版、Intel Mac、Safari 未验证。App 仍依赖系统 Node/pi；独立引擎、图标和安装包属于后续第 11 阶段。
