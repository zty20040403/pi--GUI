import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const OPEN_EVENT = "pi-desk:popover-open";
export type PopoverProps = {
  open: boolean; onOpenChange: (open: boolean) => void; label: string; trigger: ReactNode; children: ReactNode;
  disabled?: boolean; title?: string; tone?: string; testId?: string; attributes?: Record<`data-${string}`, string | undefined>;
};
export function Popover({ open, onOpenChange, label, trigger, children, disabled, title, tone, testId, attributes }: PopoverProps) {
  const id = useId(); const anchor = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange); change.current = onOpenChange;
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 480, ready: false });
  const close = useCallback((restore = true) => { change.current(false); if (restore) anchor.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    if (disabled) { close(false); return; }
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const place = () => {
      if (!anchor.current || !panel.current) return;
      const rect = anchor.current.getBoundingClientRect(); const element = panel.current; const margin = 8;
      const above = rect.top - margin * 2; const below = innerHeight - rect.bottom - margin * 2;
      const height = Math.min(element.scrollHeight, 480); const up = above >= height || above >= below;
      const maxHeight = Math.max(80, Math.min(480, up ? above : below));
      setPosition({ left: Math.max(margin, Math.min(rect.left, innerWidth - element.offsetWidth - margin)), top: Math.max(margin, up ? rect.top - Math.min(height, maxHeight) - margin : rect.bottom + margin), maxHeight, ready: true });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(panel.current!); observer.observe(anchor.current!);
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) close(); };
    const another = (event: Event) => { if ((event as CustomEvent).detail !== id) close(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } };
    const focus = (event: FocusEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) close(false); };
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true); window.addEventListener(OPEN_EVENT, another);
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", key, true); document.addEventListener("focusin", focus);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.removeEventListener(OPEN_EVENT, another); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); document.removeEventListener("focusin", focus); };
  }, [open, disabled, id, close]);
  useLayoutEffect(() => {
    if (open && position.ready) panel.current?.querySelector<HTMLElement>('input:not([type="range"]), [role="menuitemradio"][tabindex="0"]')?.focus({ preventScroll: true });
  }, [open, position.ready]);
  return <>
    <button ref={anchor} type="button" className="pill" data-tone={tone} data-testid={testId} {...attributes} title={title} disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : onOpenChange(true)} onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); onOpenChange(true); } }}>
      {trigger}
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} className="desk-popover" data-testid={`${testId}-panel`} style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, visibility: position.ready ? "visible" : "hidden" }}
      onWheel={(event) => event.stopPropagation()}>{children}</div>, document.body)}
  </>;
}
