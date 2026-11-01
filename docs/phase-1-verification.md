# 第 1 阶段验收记录

范围：`PLAN.md` §4 第 1 阶段，只实现后台，不进入聊天界面阶段。

环境：macOS，Node.js `v24.16.0`，npm `11.13.0`，本机 pi `1.4.0`。没有新增 npm 依赖，也没有修改用户的模型或插件配置。

## 实际执行结果

已独立运行：

```bash
npm run typecheck
npm test
npx tsx scripts/smoke.ts
npm run verify:phase1
```

`verify:phase1` 内部真实运行 `npx tsx server/index.ts` 和 `npx tsx scripts/smoke.ts`，不是只检查代码或模拟模型。

| PLAN.md 验收项 | 实际结果 |
|---|---|
| TypeScript 无错误 | `npm run typecheck` 退出码 0；包括 server、scripts 和 Vite 配置 |
| 后台正常启动并打印带口令网址 | 子进程启动成功，读到 `127.0.0.1:4317` 的网址及 64 位 hex 随机口令；不把真实网址写入验收日志 |
| smoke 输出 ok 和花费 | `cliproxy/gpt-6-luna` + `low` 真实回复 `ok`，花费 `$0.000855`，使用 `8521 tokens` |
| 无口令请求返回 401 | 实际 HTTP 请求 `/api/projects` 返回 401；带有效口令返回 200 |
| 对话列表与磁盘一致 | 当次验收为 4 个项目、7 个对话；独立读取真实 sessions JSONL，对路径、id、cwd、首句、最后名字逐项比对，并验证排序 |

smoke 同时验证收到 `text_delta`、按 `contentIndex` 拼接后等于最终回复、等待 `agent_settled`、保存对话，再切离并通过 `open + switch_session` 重新打开原对话。没有用第二次模型请求代替“重新打开”验证。

## 额外自动测试

`npm test` 的 6 组测试全部通过、没有跳过项：

1. 随机口令、HTTP Host/Bearer、WebSocket Host/Origin/query，拒绝缺失/错误口令、恶意 Host/Origin、重复 token；生产模式拒绝开发 Origin。
2. 客户端数据和后台日志脱敏；正常内容和插件状态键保留。
3. RPC 多字节拆包、Unicode 行/段分隔符、CRLF、并发 id 关联、事件和 stderr 分流、请求超时、启动失败、意外退出。
4. 项目进程复用、并发创建、软链接归一化、带空格的权限插件路径/缺失插件、退出删除、空闲回收；`agent_end` 之后不误判完全空闲。
5. 对话首句、最后名字、项目/时间排序、空对话、坏行容错、跨项目及软链接越界对话路径拒绝。
6. 真实 HTTP/WebSocket 连接、双客户端事件广播、插件 UI 回答透传、非法请求、会话取消、退出通知、生产静态资源和 SPA 回退、静态路径越界拒绝。

第 3～6 组中不需要模型的部分使用专用假 pi 子进程，不访问私人配置；真正的模型调用由上述 smoke 单独验证。

## 如何复跑

关闭其他占用 4317 端口的 pi desk 后台，在项目目录运行：

```bash
npm run verify:phase1
```

花费、token 用量、项目/对话数量会随实际环境变化；判断依据是脚本当次的完整断言及退出码，不是上面的固定数字。

测试产生的临时项目和测试对话使用 macOS `trash` 移到废纸篓；没有删除用户已有对话。后台口令只在内存里传给测试客户端；没有把真实口令、私人对话或模型连接配置写入仓库。

## 明确未做/未验证

- 聊天网页、附件、文件预览、插件弹窗界面、工具权限审批、Electron 和 Windows 远程使用均未做，属于后续阶段。
- 未运行聊天网页构建：第 1 阶段没有 `src/main.tsx`，不能把 `npm run build` 当作已通过。生产静态服务使用临时文件完成实际 HTTP 测试。
- 未等待真实的 30 分钟：空闲回收用可控时钟和真实子进程测试。
- 第 5 阶段权限插件尚不存在，此阶段只验证了加载开关及参数传递；口令授权不等于操作权限限制。
