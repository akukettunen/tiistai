"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

export const inputClass =
  "h-10 w-full rounded-lg border border-[#dedde6] bg-white px-3 text-sm text-[#29283a] outline-none focus:border-[#6c63ff] disabled:bg-[#f5f5f8]";

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-[#17152f]/40 p-4">
      <button className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[90vh] w-full flex-col rounded-2xl bg-white shadow-2xl ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#ecebf1] px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            className="rounded-md p-1.5 text-[#8b8998] hover:bg-[#f2f2f7]"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-[#ecebf1] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
}) {
  const styles = {
    primary: "bg-[#6c63ff] text-white hover:bg-[#5b52f0] border-transparent",
    secondary: "bg-white text-[#29283a] hover:bg-[#f8f8fb] border-[#dedde7]",
    danger: "bg-[#e5484d] text-white hover:bg-[#d63c41] border-transparent",
    success: "bg-[#1f9d55] text-white hover:bg-[#198a4a] border-transparent",
    ghost: "bg-transparent text-[#5f5d6e] hover:bg-[#f0f0f5] border-transparent",
  }[variant];
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition-colors disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[#6b6979]">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export type ComboValue = { id: string | null; name: string };

/** Pick an existing record by name, or keep a typed name to create a new one. */
export function EntityCombo({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { id: string; name: string; hint?: string }[];
  value: ComboValue;
  onChange: (value: ComboValue) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const query = value.name.trim().toLowerCase();
  const matches = options
    .filter((option) => !query || option.name.toLowerCase().includes(query))
    .slice(0, 8);
  const exact = options.find((option) => option.name.toLowerCase() === query);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        className={inputClass}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        placeholder={placeholder}
        value={value.name}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const name = event.target.value;
          const match = options.find(
            (option) => option.name.toLowerCase() === name.trim().toLowerCase(),
          );
          onChange({ id: match?.id ?? null, name });
          setOpen(true);
        }}
      />
      {value.name && !value.id && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded bg-[#efeefe] px-1.5 py-0.5 text-[10px] font-semibold text-[#5148df]">
          NEW
        </span>
      )}
      {open && (matches.length > 0 || (query && !exact)) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[#e2e1e8] bg-white p-1 text-sm shadow-lg"
        >
          {matches.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={value.id === option.id}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left hover:bg-[#f4f4f8]"
                onClick={() => {
                  onChange({ id: option.id, name: option.name });
                  setOpen(false);
                }}
              >
                <span className="truncate">{option.name}</span>
                {option.hint && (
                  <span className="ml-2 truncate text-xs text-[#9997a5]">{option.hint}</span>
                )}
              </button>
            </li>
          ))}
          {query && !exact && (
            <li className="px-2.5 py-2 text-xs text-[#6b6979]">
              Will create “{value.name.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const palette = ["#6c63ff", "#1f9d55", "#e5484d", "#f59e0b", "#0ea5e9", "#d946ef"];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const color = palette[Math.abs(hash) % palette.length];
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
      style={{ width: size, height: size, background: color }}
    >
      {letters || "?"}
    </span>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="fixed bottom-5 left-1/2 z-100 -translate-x-1/2 rounded-xl bg-[#19172e] px-4 py-3 text-sm text-white shadow-xl">
      {message}
    </div>
  );
}
