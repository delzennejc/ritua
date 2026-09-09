import { createContext, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";

const DropdownRootContext = createContext(null);

// Items support actions, radio choices, and persistent checkbox filters.
// Controlled opening and an external trigger ref allow confirmation handoffs.
export function Dropdown({
  label, title, trigger, items, triggerClassName = "toolbar-trigger",
  className = "", align = "start", open: controlledOpen, onOpenChange,
  triggerRef: externalTriggerRef, triggerTitle, menuWidth = 196, children,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const localTriggerRef = useRef(null);
  const triggerRef = externalTriggerRef ?? localTriggerRef;
  const menuRef = useRef(null);
  const initialFocus = useRef("selected");
  const id = useId();
  const parentRoot = useContext(DropdownRootContext);
  const rootId = parentRoot ?? id;
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    const triggerElement = triggerRef.current;
    if (!menu || !triggerElement) return undefined;
    const position = () => {
      const bounds = triggerElement.getBoundingClientRect();
      menu.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
      const { width, height } = menu.getBoundingClientRect();
      const left = align === "end" ? bounds.right - width : bounds.left;
      menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
      const top = bounds.bottom + 7 + height <= window.innerHeight - 8
        ? bounds.bottom + 7 : bounds.top - height - 7;
      menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    };
    position();
    const buttons = [...menu.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
    const focused = initialFocus.current === "last" ? buttons.at(-1)
      : initialFocus.current === "first" ? buttons[0]
        : buttons.find((button) => button.getAttribute("aria-checked") === "true") ?? buttons[0];
    (focused ?? (children ? menu.querySelector("button, input, select, textarea") : null) ?? menu).focus({ preventScroll: true });
    focused?.scrollIntoView({ block: "nearest" });
    const dismiss = (event) => {
      if (!menu.contains(event.target) && !triggerElement.contains(event.target)
        && event.target.closest?.("[data-dropdown-root]")?.dataset.dropdownRoot !== rootId) setOpenRef.current(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer.disconnect();
    };
  }, [open, align, triggerRef, rootId]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className={`toolbar-control-wrap ${className}`.trim()}>
      <button
        ref={triggerRef} type="button" className={triggerClassName}
        title={triggerTitle} aria-label={label} aria-haspopup={children ? "dialog" : "menu"}
        aria-expanded={open} aria-controls={open ? id : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          initialFocus.current = "selected";
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialFocus.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
          if (event.key === "Escape" && open) { event.preventDefault(); close(); }
        }}
      >{trigger}</button>
      {open ? createPortal(
        <div
          ref={menuRef} id={id} role={children ? "dialog" : "menu"} aria-label={label} tabIndex={-1}
          data-dropdown-root={rootId}
          style={{ width: `min(${menuWidth}px, calc(100vw - 16px))` }}
          className="dropdown-menu"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); close(); return; }
            if (children) {
              if (event.key === "Tab") {
                const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
                const first = controls[0], last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
              return;
            }
            // Return Tab to the trigger's DOM position before native traversal.
            if (event.key === "Tab") { close(); return; }
            const buttons = [...event.currentTarget.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
            const index = buttons.indexOf(document.activeElement);
            let next;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
          }}
        >
          {title ? <span className="dropdown-title">{title}</span> : null}
          <DropdownRootContext.Provider value={rootId}>
          {children ?? items.map((item) => (
            <button
              ref={item.buttonRef} key={item.id} type="button" className={`dropdown-option${item.danger ? " dropdown-option-danger" : ""}`}
              role={item.role ?? "menuitem"} disabled={item.disabled}
              aria-checked={item.role === "menuitemcheckbox" || item.role === "menuitemradio" ? Boolean(item.checked) : undefined}
              onClick={() => {
                if (item.closeOnSelect ?? item.role !== "menuitemcheckbox") close();
                item.onSelect?.();
              }}
            >
              <span className="dropdown-option-icon" aria-hidden="true">{item.icon}</span>
              <span className="dropdown-option-label">{item.label}</span>
              {item.checked ? <Check className="dropdown-check" size={14} weight="bold" aria-hidden="true" /> : null}
            </button>
          ))}
          </DropdownRootContext.Provider>
        </div>, document.body,
      ) : null}
    </div>
  );
}

// Value selectors use the same menu, keyboard navigation, and positioning as actions.
export function ChoiceDropdown({ label, value, options, onChange, className = "", trigger, triggerClassName = "choice-dropdown-trigger", menuWidth = 280 }) {
  const selected = options.find((option) => option.value === value);
  return <Dropdown
    label={label}
    className={`choice-dropdown ${className}`}
    triggerClassName={triggerClassName}
    menuWidth={menuWidth}
    trigger={trigger ?? <><span>{selected?.label ?? "Choose…"}</span><CaretDown size={13} aria-hidden="true" /></>}
    items={options.map((option) => ({
      id: option.value, label: option.label, icon: option.icon,
      disabled: option.disabled, role: "menuitemradio", checked: option.value === value,
      onSelect: () => onChange(option.value),
    }))}
  />;
}
