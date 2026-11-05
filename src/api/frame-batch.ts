// 原始 RPC 事件仍按到达顺序广播；这里只合并用于界面绘制的状态更新。
// rAF 暂停（后台窗口）时有 100ms 后备定时器，队列也有上限，不能无限积压。
function nextFrame(flush: () => void) {
  const frame = requestAnimationFrame(flush); const timer = setTimeout(flush, 100);
  return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
}
export function frameBatch<T>(commit: (items: T[]) => void, schedule = nextFrame, limit = 256) {
  let pending: T[] = []; let cancel: (() => void) | undefined;
  const clear = () => { cancel?.(); cancel = undefined; pending = []; };
  const flush = () => { const items = pending; clear(); if (items.length) commit(items); };
  return {
    push(item: T) { pending.push(item); if (pending.length >= limit) flush(); else if (!cancel) cancel = schedule(flush); },
    flush, clear,
  };
}
