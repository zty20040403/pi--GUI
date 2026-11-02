# pi desk 项目说明（给 AI 看）

这是 Kenneth 的 pi 图形界面客户端。第一版方案在 `PLAN.md`（第 1–6 阶段，已完成）；**现在按 `PLAN-v2.md` 做第 7–13 阶段，动手前先读它。**

- 借鉴 pi-gui（MIT）的代码时，被改编的文件开头写一行出处，并在 `README.md` 的"致谢"里列出。

## 怎么干活
- 按 `PLAN.md` 第 4 节的阶段顺序做，一次只做一个阶段；每个阶段的"验收"全部通过后再 `git commit` 和 `git push`，然后停下来跟 Kenneth 汇报。

## 推送到 GitHub
- 仓库：`https://github.com/zty20040403/pi--GUI`（远程名 `origin`，分支 `main`）。**这是公开仓库。**
- 每次 `git commit` 之后直接 `git push`，Kenneth 已经同意，不用再问。
- 推送前检查这次提交里有没有不该公开的东西：`git show --stat HEAD` 看改了哪些文件，`git show HEAD | grep -niE "api[_-]?key|sk-[a-z0-9]{8}|token=[0-9a-f]{10}|BEGIN (OPENSSH|RSA)"` 应该没有结果。有的话先改掉、重新提交，再推。
- 只推 `origin` 的 `main`。不要 `--force`，不要删分支，不要改别的仓库。推送被拒绝（远程有新提交）时先 `git pull --rebase`，有冲突就停下来问 Kenneth。
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
- `git push --force`，或者推到 `origin` 的 `main` 以外的任何地方。
