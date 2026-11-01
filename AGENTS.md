# pi desk 项目说明（给 AI 看）

这是 Kenneth 的 pi 图形界面客户端。**完整方案在 `PLAN.md`，动手前先读它。**

## 怎么干活
- 按 `PLAN.md` 第 4 节的阶段顺序做，一次只做一个阶段；每个阶段的"验收"全部通过后再 `git commit`，然后停下来跟 Kenneth 汇报。
- 开始一个阶段前，先用任务清单工具列出这个阶段的步骤。
- 不确定 pi 的协议细节时，去读本机 pi 文档（`PLAN.md` §2.4 有路径），不要猜。
- 新增 npm 依赖要写死版本号（不用 `^`），先 `npm view <包>@<版本> version` 确认存在。
- 改完代码跑 `npm run typecheck`；测试聊天时用 `cliproxy/gpt-6-luna`、推理强度 `low`，省钱。

## 跟 Kenneth 说话
- 用中文，说人话。他不是很熟前端、Nix 和终端，解释时给具体的操作步骤和命令。
- 每个阶段结束写：做了什么、怎么打开试、哪些还没做或没验证。

## 绝对不要
- 把 API key、服务器地址、`~/.pi/agent/secrets` 的内容写进代码、日志、提交。
- 修改 `~/.pi/agent/models.json`、`~/.pi/agent/extensions/`、`~/.local/share/pi-agent/`、`~/.config/cortexkit/` 下的文件（那是 Kenneth 的 pi 配置）。
- 用 `rm` 删用户的对话文件；删除一律用 macOS 的 `trash` 命令。
- `git push`，除非 Kenneth 明确说要。
