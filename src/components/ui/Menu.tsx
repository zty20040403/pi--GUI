import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Search, X } from "lucide-react";
export type MenuOption = { id: string; label: string; description?: string; keywords?: string; group?: string; meta?: ReactNode; icon?: ReactNode; disabled?: boolean; reason?: string; danger?: boolean; testId?: string; data?: Record<`data-${string}`, string> };
export function Menu({ label, options, selected, onSelect, searchLabel, disabled = false }: { label: string; options: MenuOption[]; selected?: string; onSelect: (id: string) => void; searchLabel?: string; disabled?: boolean }) {
  const [query, setQuery] = useState(""); const [active, setActive] = useState(selected ?? options.find((option) => !option.disabled)?.id);
  const search = useRef<HTMLInputElement>(null); const root = useRef<HTMLDivElement>(null);
  const filtered = options.filter((option) => `${option.label} ${option.keywords ?? ""} ${option.group ?? ""} ${option.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const enabled = filtered.filter((option) => !option.disabled); const focused = enabled.some((option) => option.id === active) ? active : enabled[0]?.id;
  const groups = [...new Set(filtered.map((option) => option.group ?? ""))];
  function focus(id?: string) { if (id === undefined) return; setActive(id); const button = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])].find((element) => element.dataset.option === id); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest" }); }
  useLayoutEffect(() => { if (search.current) search.current.focus({ preventScroll: true }); else if (focused) focus(focused); else root.current?.focus(); }, [query]);
  function key(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const inSearch = event.target === search.current; const index = enabled.findIndex((item) => item.id === focused);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && (!inSearch || !["Home", "End"].includes(event.key))) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : inSearch ? event.key === "ArrowUp" ? enabled.length - 1 : 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      focus(enabled[next]?.id); return;
    }
    if (event.key === "Enter" && inSearch && focused) { event.preventDefault(); if (!disabled) onSelect(focused); return; }
    if (!inSearch && (event.key.length === 1 && event.key !== " " || event.key === "Backspace")) {
      event.preventDefault(); setQuery((value) => event.key === "Backspace" ? value.slice(0, -1) : value + event.key); setActive(undefined); search.current?.focus();
    }
  }
  return <div className="desk-menu-shell" onKeyDown={key}>
    {searchLabel && <div className="menu-search"><Search size={15} aria-hidden /><input ref={search} aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={(event) => { setQuery(event.target.value); setActive(undefined); }} />{query && <button type="button" className="icon-button small" aria-label="清除模型搜索" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={13} /></button>}</div>}
    {!searchLabel && query && <div className="menu-filter">筛选：{query}<button type="button" className="quiet-button" onClick={() => setQuery("")}>清除</button></div>}
    <div ref={root} className="desk-menu" role="menu" tabIndex={-1} aria-label={label} aria-busy={disabled}>
      {groups.map((group) => <div role="group" aria-label={group || undefined} key={group}>
        {group && <div className="menu-group-title" aria-hidden>{group}</div>}
        {filtered.filter((option) => (option.group ?? "") === group).map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={selected === option.id} aria-disabled={!!option.disabled || disabled} tabIndex={option.id === focused ? 0 : -1}
          className="menu-option" data-option={option.id} data-testid={option.testId} data-danger={option.danger || undefined} {...option.data} title={option.reason ?? option.label} onFocus={() => setActive(option.id)} onClick={() => { if (!disabled && !option.disabled) onSelect(option.id); }}>
          <span className="menu-check">{selected === option.id ? <Check size={14} aria-hidden /> : option.icon}</span><span className="menu-option-body"><span className="menu-option-label">{option.label}</span>{(option.description || option.reason) && <span className="menu-option-description">{option.reason ?? option.description}</span>}</span>{option.meta && <span className="menu-meta">{option.meta}</span>}
        </button>)}
      </div>)}
      {!filtered.length && <p className="menu-empty" role="status">{query ? "没有找到匹配项，换个关键词试试" : "暂无可用选项"}</p>}
    </div>
  </div>;
}
