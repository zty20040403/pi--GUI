// 仅供后台自动测试，不访问模型、不读取用户的 pi 配置。
let buffer = "";
let session = 0;
let cancelNext = false;
let sessionFile;
let streaming = false;
const emit = (record) => process.stdout.write(JSON.stringify(record) + "\n");
const respond = (cmd, data) => emit({ type: "response", id: cmd.id, command: cmd.type, success: true, data });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const cmd = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    switch (cmd.type) {
      case "hang": break;
      case "crash": process.exit(3); break;
      case "cancel_next": cancelNext = true; respond(cmd, {}); break;
      case "new_session":
        if (!cancelNext) session++;
        respond(cmd, { cancelled: cancelNext }); cancelNext = false;
        break;
      case "switch_session": respond(cmd, { cancelled: false }); break;
      case "get_state": respond(cmd, { sessionId: `fake-${session}`, sessionFile, isStreaming: streaming, model: { id: "test", provider: "test", baseUrl: "private-model-endpoint", headers: { authorization: "not-public" } } }); break;
      case "test_session_file": sessionFile = cmd.path; respond(cmd, {}); break;
      case "test_busy": streaming = cmd.enabled; emit({ type: streaming ? "agent_start" : "agent_settled", aborted: false }); respond(cmd, {}); break;
      case "get_messages": respond(cmd, { messages: [] }); break;
      case "get_session_stats": respond(cmd, { cost: 0, tokens: { total: 0 } }); break;
      case "get_available_models": respond(cmd, { models: [{ id: "test", provider: "test", baseUrl: "private-model-endpoint", secret: "not-public" }] }); break;
      case "get_commands": respond(cmd, { commands: [{ name: "test-command" }] }); break;
      case "ui_request": emit({ type: "extension_ui_request", ...cmd.request }); respond(cmd, {}); break;
      case "ui_batch": for (const request of cmd.requests) emit({ type: "extension_ui_request", ...request }); respond(cmd, {}); break;
      case "extension_ui_response": emit({ type: "ui_received", payload: cmd }); break;
      case "event": respond(cmd, {}); emit({ type: "test_event", text: "汉字\u2028段落\u2029结束" }); break;
      case "fragment": {
        const record = Buffer.from(JSON.stringify({ type: "response", id: cmd.id, success: true, data: "汉字\u2028段落\u2029结束" }) + "\r\n");
        const cut = record.indexOf(Buffer.from("汉")) + 1;
        process.stdout.write(record.subarray(0, cut));
        setTimeout(() => process.stdout.write(record.subarray(cut)), 5);
        break;
      }
      case "stderr": process.stderr.write("fixture diagnostic\n"); respond(cmd, {}); break;
      default: respond(cmd, { echoed: cmd, argv: process.argv.slice(2) });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
