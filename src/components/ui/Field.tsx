import { useId, type ReactNode } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  optionalLabel?: string;
  children: (a: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
};

/** Label + control + hint + error, wired with ids. Never relies on placeholder text. */
export function Field({ label, hint, error, optionalLabel, children }: FieldProps) {
  const id = useId();
  const descId = `${id}-d`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optionalLabel && <span className="ml-2 font-normal text-faint">{optionalLabel}</span>}
      </label>
      {children({ id, ...(error ? { "aria-invalid": true as const } : {}), ...(error || hint ? { "aria-describedby": descId } : {}) })}
      {(error || hint) && (
        <p id={descId} className={error ? "field-error" : "field-hint"} role={error ? "alert" : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
