"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// Native <dialog>: focus trapping, Escape to close, and an inert background for free.
export function Dialog({ open, onClose, title, description, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start typing straight away: focus the first field rather than the close button.
      dialog.querySelector<HTMLElement>("[data-dialog-body] :is(input:not([type=hidden]), select, textarea)")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={ref} onClose={onClose} aria-labelledby={titleId}
    className={`m-auto w-[calc(100%_-_32px)] ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl border border-[#e7e7e3] bg-white p-0 text-[#20211f] shadow-2xl backdrop:bg-[#20211f]/45`}>
    <div className="flex items-start justify-between gap-4 border-b border-[#efefeb] px-6 py-5">
      <div><h2 id={titleId} className="text-lg font-700">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-[#6b6d66]">{description}</p>}</div>
      <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-[#6b6d66] hover:bg-[#efefeb] hover:text-[#20211f]"><X size={18} /></button>
    </div>
    <div data-dialog-body className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
    {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-[#efefeb] px-6 py-4">{footer}</div>}
  </dialog>;
}
