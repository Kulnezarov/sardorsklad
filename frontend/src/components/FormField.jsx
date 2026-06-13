import React from 'react';

/** Вертикальное поле формы: подпись сверху, контроль на всю ширину. */
export default function FormField({
  label,
  hint,
  required = false,
  accent = false,
  large = false,
  mono = false,
  className = '',
  children,
}) {
  const labelText = required && label ? `${label} *` : label;

  return (
    <div
      className={`form-field${accent ? ' form-field--accent' : ''}${large ? ' form-field--large' : ''}${mono ? ' form-field--mono' : ''}${className ? ` ${className}` : ''}`}
    >
      {labelText && <span className="form-field__label">{labelText}</span>}
      <div className="form-field__control">{children}</div>
      {hint && <span className="form-field__hint">{hint}</span>}
    </div>
  );
}
