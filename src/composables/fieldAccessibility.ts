import type { ObjectDirective } from 'vue';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Check = (() => string) | undefined;
let sequence = 0;
const states = new WeakMap<Field, { update: (check: Check) => void; dispose: () => void }>();

/** Keep native validation and associate each field with its own label, help and error. */
export const vField: ObjectDirective<Field, Check> = {
  mounted(field, binding) {
    if (!field.closest) return; // Non-DOM component renderers do not run browser validation.
    field.id ||= `pam-field-${++sequence}`;
    const label = field.closest('label') || field.labels?.[0];
    if (label) label.htmlFor = field.id;
    const helps = [...(label?.querySelectorAll('small') || [])];
    helps.forEach((help, index) => (help.id ||= `${field.id}-help-${index}`));
    const message = document.createElement('span');
    message.id = `${field.id}-error`;
    message.className = 'field-error';
    message.hidden = true;
    field.insertAdjacentElement('afterend', message);
    let touched = false;
    let check = binding.value;
    const refresh = () => {
      field.setCustomValidity(check?.() || '');
      const invalid = touched && !field.validity.valid;
      field.setAttribute('aria-invalid', String(invalid));
      message.textContent = invalid
        ? field.validity.valueMissing
          ? 'Renseignez ce champ.'
          : field.validationMessage
        : '';
      message.hidden = !invalid;
      const ids = (field.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== message.id);
      helps.forEach((help) => ids.push(help.id));
      if (invalid) ids.push(message.id);
      if (ids.length) field.setAttribute('aria-describedby', [...new Set(ids)].join(' '));
      else field.removeAttribute('aria-describedby');
    };
    const blur = () => {
      touched = true;
      refresh();
    };
    const invalid = () => {
      touched = true;
      for (let parent = field.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      refresh();
    };
    field.addEventListener('input', refresh);
    field.addEventListener('change', refresh);
    field.addEventListener('blur', blur);
    field.addEventListener('invalid', invalid);
    refresh();
    states.set(field, {
      update(next) {
        check = next;
        refresh();
      },
      dispose() {
        field.removeEventListener('input', refresh);
        field.removeEventListener('change', refresh);
        field.removeEventListener('blur', blur);
        field.removeEventListener('invalid', invalid);
        message.remove();
      },
    });
  },
  updated(field, binding) {
    states.get(field)?.update(binding.value);
  },
  beforeUnmount(field) {
    states.get(field)?.dispose();
    states.delete(field);
  },
};

export function argumentsError(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return '';
  } catch {
    /* Native form validation reports the error on the JSON field. */
  }
  return 'Les arguments doivent être un tableau JSON de textes, par exemple ["--new-window", "{input}"].';
}
