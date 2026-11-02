import assert from "node:assert/strict";
import { test } from "node:test";
import { errorInfo, errorData } from "../server/errors.js";
import { DeskError } from "../shared/errors.js";
test("错误统一中文：文件/权限/占用/pi 退出/断网/401；脱敏详情不丢失", () => {
  for (const [raw, expected] of [["ENOENT: no such file", /不存在/], ["ENOENT: no such file '/测试目录'", /不存在/], ["EACCES permission denied", /没有权限/], ["listen EADDRINUSE", /端口已被占用/], ["pi exited (SIGKILL)", /进程已退出/], ["fetch failed ECONNREFUSED", /连接模型服务失败/], ["Connection error.", /连接模型服务失败/], ["401 Unauthorized", /凭据/]]) {
    const info = errorInfo(new Error(raw as string)); assert.match(info.message, expected as RegExp); assert.equal(info.details, raw);
    assert.deepEqual(errorInfo(new DeskError(info)), info);
  }
  const secret = "sk" + "-syntheticcredential123"; const address = "https:" + "//synthetic.invalid/service";
  const info = errorInfo(`401 Unauthorized ${address} Bearer ${secret}`); assert.ok(!JSON.stringify(info).includes(secret)); assert.ok(!JSON.stringify(info).includes(address));
  assert.deepEqual(errorData({ type: "message_end", message: { errorMessage: "401 Unauthorized", content: "normal English content" } }), { type: "message_end", message: { errorMessage: errorInfo("401 Unauthorized").message, errorMessageDetails: "401 Unauthorized", content: "normal English content" } });
  assert.deepEqual(errorInfo("请先重新载入对话"), { message: "请先重新载入对话" });
});
