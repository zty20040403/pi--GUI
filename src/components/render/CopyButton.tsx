import { useState } from "react";
export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("复制");
  return <button className="quiet-button" type="button" onClick={() => {
    void navigator.clipboard.writeText(text).then(() => setStatus("已复制"), () => setStatus("复制失败"));
    setTimeout(() => setStatus("复制"), 2000);
  }}>{status}</button>;
}
