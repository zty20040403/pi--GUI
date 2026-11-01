import { useEffect, useState } from "react";
import { fileBlob, type PreviewProps } from "../../api/files";
export function useResource({ file, version }: PreviewProps, text = false, api = "file") {
  const [resource, setResource] = useState<{ data?: Blob; error?: string }>({});
  useEffect(() => {
    const abort = new AbortController(); let active = true; setResource({});
    void fileBlob(file, abort.signal, api, text).then((data) => { if (active) setResource({ data }); }, (error: Error) => { if (active && !abort.signal.aborted) setResource({ error: error.message }); });
    return () => { active = false; abort.abort(); };
  }, [file.cwd, file.path, file.mtime, file.size, version, text, api]);
  return resource;
}
export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!blob) { setUrl(""); return; } const url = URL.createObjectURL(blob); setUrl(url); return () => URL.revokeObjectURL(url); }, [blob]);
  return url;
}
export function useBlobText(blob?: Blob) {
  const [text, setText] = useState<string>();
  useEffect(() => { let active = true; setText(undefined); if (blob) void blob.text().then((text) => { if (active) setText(text); }); return () => { active = false; }; }, [blob]);
  return text;
}
