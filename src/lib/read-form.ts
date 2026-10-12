// Collects a form's named fields: checkboxes become booleans (including unchecked
// ones, which FormData omits), everything else is the trimmed string value.
export function readForm(form: HTMLFormElement): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
    if (!element.name || element.disabled) continue;
    if (element instanceof HTMLInputElement && element.type === "checkbox") values[element.name] = element.checked;
    else if (element instanceof HTMLInputElement && element.type === "file") continue;
    else values[element.name] = element.value.trim();
  }
  return values;
}
