"use client";

import { useId } from "react";

type ToggleProps = { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string };

/** Switch: real button with role=switch, keyboard and screen reader ready. */
export function Toggle({ checked, onChange, label, className }: ToggleProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={`ok-toggle ${className ?? ""}`}>
      <button id={id} type="button" role="switch" aria-checked={checked} data-sound="toggle" onClick={() => onChange(!checked)}>
        <i />
      </button>
      <span>{label}</span>
    </label>
  );
}

type SegProps<T extends string> = { value: T; onChange: (v: T) => void; options: { v: T; t: string }[]; label: string; className?: string };

export function Segmented<T extends string>({ value, onChange, options, label, className }: SegProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`ok-seg ${className ?? ""}`}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} data-sound="toggle" onClick={() => onChange(o.v)}>
          {o.t}
        </button>
      ))}
    </div>
  );
}
