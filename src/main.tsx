import ReactDOM from "react-dom/client";
import App from "./App";
import { ChatProvider } from "./api/ChatProvider";
import { FileProvider } from "./api/FileProvider";
import { ChangesProvider } from "./api/ChangesProvider";
import { AttachmentProvider } from "./api/AttachmentProvider";
import { ExtensionUiProvider } from "./api/ExtensionUiProvider";
import { GoalProvider } from "./api/GoalProvider";
import { consumeToken, restoreDesktopPreferences } from "./api/storage";
import "./styles.css";
import "./components/changes/changes.css";

let token = "";
try {
  token = consumeToken(new URL(window.location.href), sessionStorage, (url) => history.replaceState(null, "", url));
} catch {
  const url = new URL(window.location.href); url.searchParams.delete("token"); history.replaceState(null, "", url.pathname + url.search + url.hash);
}
void restoreDesktopPreferences().then(() => ReactDOM.createRoot(document.getElementById("root")!).render(token
  ? <ChatProvider token={token}><FileProvider><ChangesProvider><AttachmentProvider><ExtensionUiProvider><GoalProvider><App /></GoalProvider></ExtensionUiProvider></AttachmentProvider></ChangesProvider></FileProvider></ChatProvider>
  : <main className="access-screen"><div className="welcome-mark">π</div><h1>需要本次启动的口令</h1><p>请在终端运行 <code>npm run dev</code>，再打开它打印的完整网址。</p><p>如果网址仍打不开，请允许浏览器使用临时存储（sessionStorage）。</p><p className="muted">口令每次启动都会改变，不需要填写模型凭据。</p></main>));
