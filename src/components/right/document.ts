export function parseDocument<T>(kind: "xlsx" | "docx", buffer: ArrayBuffer, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./document.worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: Error, data?: T) => { clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate(); if (error) reject(error); else resolve(data!); };
    const abort = () => finish(new DOMException("已取消", "AbortError"));
    const timer = setTimeout(() => finish(new Error("文档解析超时，请用默认软件打开")), 15000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ data: T; error?: string }>) => finish(event.data.error ? new Error(event.data.error) : undefined, event.data.data);
    worker.onerror = () => finish(new Error("文档解析失败，请刷新或用默认软件打开"));
    if (signal.aborted) abort(); else worker.postMessage({ kind, buffer }, [buffer]);
  });
}
