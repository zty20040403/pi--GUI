import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Brain } from "lucide-react";
export const LEVEL_LABELS: Record<string, string> = { off: "关", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };
export function ThinkingSlider({ levels, level, reasoning, disabled, onChange }: { levels: string[]; level?: string; reasoning?: boolean; disabled: boolean; onChange: (level: string) => Promise<void> }) {
  const [preview, setPreview] = useState(level); const dragging = useRef(false);
  useEffect(() => { if (!dragging.current && !disabled) setPreview(level); }, [level, levels, disabled]);
  const index = Math.max(0, levels.indexOf(preview ?? "")); const adjustable = reasoning !== false && levels.length > 1;
  const percentage = adjustable ? index / (levels.length - 1) * 100 : 0;
  async function commit(value: string) { if (disabled || !adjustable) return; setPreview(value); if (value !== level) await onChange(value); }
  return <section className="thinking-control" aria-label="推理设置" style={{ "--thinking-position": `${percentage}%` } as CSSProperties}>
    <div className="thinking-heading"><span><Brain size={14} aria-hidden />推理强度</span><strong aria-live="polite">{LEVEL_LABELS[levels[index]] ?? levels[index] ?? "加载中…"}</strong></div>
    <input className="thinking-slider" type="range" aria-label="推理强度" aria-valuetext={preview ? `${LEVEL_LABELS[preview] ?? preview}（${preview}）` : "加载中"} data-level={level ?? ""} data-levels={levels.join(",")} min={0} max={Math.max(1, levels.length - 1)} step={1} value={index} disabled={disabled || !adjustable}
      onPointerDown={() => { dragging.current = true; }} onPointerUp={(event) => { if (dragging.current) { dragging.current = false; void commit(levels[Number(event.currentTarget.value)]); } }}
      onPointerCancel={() => { dragging.current = false; setPreview(level); }} onBlur={() => { if (dragging.current) { dragging.current = false; if (preview) void commit(preview); } }}
      onChange={(event) => { const value = levels[Number(event.target.value)]; setPreview(value); if (!dragging.current) void commit(value); }} />
    <div className="thinking-ticks">{levels.map((value, position) => <button type="button" tabIndex={-1} key={value} data-testid={`thinking-level-${value}`} data-selected={position === index || undefined} disabled={disabled || !adjustable} title={`${LEVEL_LABELS[value] ?? value}（${value}）`} onClick={() => void commit(value)}><span />{LEVEL_LABELS[value] ?? value}</button>)}</div>
    {levels.length === 0 ? <p className="thinking-disabled" role="status">正在读取模型支持的档位…</p> : !adjustable ? <p className="thinking-disabled">这个模型不支持调节推理强度</p> : <div className="thinking-hints"><span>更快更省</span><span>更聪明更贵</span></div>}
  </section>;
}
