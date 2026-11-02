import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { childEnvironment, LaunchUrl, windowBounds, trustedSender } = require("../electron/runtime.cjs");

test("Finder 的最小 PATH 能补全用户 Node/pi，去掉 npm 和 Electron 的宿主注入", () => {
  const env = childEnvironment({ PATH: "/usr/bin:/bin:/project/node_modules/.bin", NODE_OPTIONS: "fixture", NODE_PATH: "fixture", ELECTRON_RUN_AS_NODE: "1", KEEP: "fixture" }, "/fixture/home");
  assert.equal(env.PATH.split(":")[0], "/fixture/home/.local/bin"); assert.ok(env.PATH.includes("/fixture/home/.nix-profile/bin")); assert.ok(!env.PATH.includes("node_modules/.bin"));
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.NODE_PATH, undefined); assert.equal(env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(env.KEEP, "fixture"); assert.equal(env.NODE_ENV, "production");
});
test("启动网址只接受本地固定端口/64位口令，分块输出能恢复，不把口令落盘", () => {
  const parser = new LaunchUrl(); const url = `http://127.0.0.1:4317/?token=${"a".repeat(64)}`;
  assert.equal(parser.feed(`log\n${url.slice(0, 45)}`), undefined); assert.equal(parser.feed(`${url.slice(45)}\r\n`), url);
  assert.equal(new LaunchUrl().feed(`http://example.invalid/?token=${"a".repeat(64)}\n`), undefined);
  assert.equal(new LaunchUrl().feed("http://127.0.0.1:4317/?token=short\n"), undefined);
});
test("窗口记住合理位置，屏幕移走后的越界位置不恢复", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }];
  assert.deepEqual(windowBounds({}, displays), { width: 1400, height: 900 });
  assert.deepEqual(windowBounds({ x: 20, y: 30, width: 1200, height: 700 }, displays), { width: 1200, height: 700, x: 20, y: 30 });
  assert.deepEqual(windowBounds({ x: 9000, y: 9000 }, displays), { width: 1400, height: 900 });
});
test("原生 IPC 只接受自己的主框架，子框架/外部页面/其他窗口都拒绝", () => {
  const origin = "http://127.0.0.1:4317"; const frame = { url: `${origin}/` }; const contents = { mainFrame: frame }; const window = { isDestroyed: () => false, webContents: contents };
  assert.equal(trustedSender({ sender: contents, senderFrame: frame }, window, origin), true);
  assert.equal(trustedSender({ sender: contents, senderFrame: { url: `${origin}/` } }, window, origin), false);
  assert.equal(trustedSender({ sender: {}, senderFrame: frame }, window, origin), false);
  frame.url = "https://example.invalid"; assert.equal(trustedSender({ sender: contents, senderFrame: frame }, window, origin), false);
});
