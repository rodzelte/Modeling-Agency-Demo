"use client";

import { useId, type ReactNode } from "react";

const labelClass = "block text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]";
const inputClass = "mt-2 w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm font-400 normal-case tracking-normal text-[#20211f] outline-none transition-colors focus:border-[#a4502f] focus-visible:ring-2 focus-visible:ring-[#a4502f]/20 disabled:bg-[#f3f3f0]";

type Base = { label: string; name: string; hint?: string; required?: boolean; disabled?: boolean; className?: string };

function Hint({ id, children }: { id: string; children?: ReactNode }) {
  return children ? <span id={id} className="mt-1.5 block text-[11px] font-400 normal-case tracking-normal text-[#6b6d66]">{children}</span> : null;
}

export function TextField({ label, name, hint, required, disabled, className = "", type = "text", defaultValue, value, onChange, placeholder, autoComplete, min, max, step }: Base & {
  type?: string; defaultValue?: string | number | null; value?: string; onChange?: (value: string) => void; placeholder?: string; autoComplete?: string; min?: string | number; max?: string | number; step?: string | number;
}) {
  const id = useId();
  return <label className={`${labelClass} ${className}`} htmlFor={id}>{label}{required && <span className="text-[#a4502f]"> *</span>}
    <input id={id} name={name} type={type} required={required} disabled={disabled} placeholder={placeholder} autoComplete={autoComplete} min={min} max={max} step={step}
      aria-describedby={hint ? `${id}-hint` : undefined}
      {...(value !== undefined ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue: defaultValue ?? "" })}
      className={inputClass} />
    <Hint id={`${id}-hint`}>{hint}</Hint>
  </label>;
}

export function TextareaField({ label, name, hint, required, disabled, className = "", defaultValue, rows = 4, value, onChange }: Base & { defaultValue?: string | null; rows?: number; value?: string; onChange?: (value: string) => void }) {
  const id = useId();
  return <label className={`${labelClass} ${className}`} htmlFor={id}>{label}{required && <span className="text-[#a4502f]"> *</span>}
    <textarea id={id} name={name} rows={rows} required={required} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined}
      {...(value !== undefined ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue: defaultValue ?? "" })}
      className={inputClass} />
    <Hint id={`${id}-hint`}>{hint}</Hint>
  </label>;
}

export function SelectField({ label, name, hint, required, disabled, className = "", defaultValue, value, onChange, options, placeholder }: Base & {
  defaultValue?: string | null; value?: string; onChange?: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string;
}) {
  const id = useId();
  return <label className={`${labelClass} ${className}`} htmlFor={id}>{label}{required && <span className="text-[#a4502f]"> *</span>}
    <select id={id} name={name} required={required} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined}
      {...(value !== undefined ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue: defaultValue ?? "" })}
      className={inputClass}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <Hint id={`${id}-hint`}>{hint}</Hint>
  </label>;
}

export function CheckboxField({ label, name, hint, disabled, className = "", defaultChecked, checked, onChange }: Omit<Base, "required"> & { defaultChecked?: boolean | null; checked?: boolean; onChange?: (checked: boolean) => void }) {
  const id = useId();
  return <label htmlFor={id} className={`flex items-start gap-3 rounded-md border border-[#e7e7e3] bg-white px-3 py-3 text-[11px] font-700 text-[#3d3f3a] ${disabled ? "opacity-60" : "cursor-pointer hover:border-[#cfcfc8]"} ${className}`}>
    <input id={id} name={name} type="checkbox" disabled={disabled} value="true" className="mt-0.5 h-4 w-4 accent-[#20211f]"
      {...(checked !== undefined ? { checked, onChange: (event) => onChange?.(event.target.checked) } : { defaultChecked: Boolean(defaultChecked) })} />
    <span>{label}{hint && <span className="mt-1 block font-400 text-[#6b6d66]">{hint}</span>}</span>
  </label>;
}

export function FormGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  const grid = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return <div className={`grid gap-5 ${grid}`}>{children}</div>;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="border-t border-[#ecece8] pt-6 first:border-t-0 first:pt-0">
    <h3 className="text-sm font-800">{title}</h3>
    {description && <p className="mt-1 text-xs leading-5 text-[#6b6d66]">{description}</p>}
    <div className="mt-5">{children}</div>
  </section>;
}
