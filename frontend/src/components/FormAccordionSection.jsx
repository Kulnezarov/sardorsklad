import React, { useState } from 'react';

/** Сворачиваемая секция формы — как в мобильном приложении. */
export default function FormAccordionSection({
  title,
  subtitle,
  icon,
  iconColor,
  initiallyExpanded = false,
  children,
  className = '',
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <section
      className={`form-accordion${expanded ? ' form-accordion--open' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className="form-accordion__head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {icon && (
          <span
            className="form-accordion__icon"
            style={iconColor ? { color: iconColor, background: `${iconColor}18` } : undefined}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <span className="form-accordion__titles">
          <span className="form-accordion__title">{title}</span>
          {subtitle && <span className="form-accordion__subtitle">{subtitle}</span>}
        </span>
        <span className="form-accordion__chevron" aria-hidden />
      </button>
      {expanded && <div className="form-accordion__body">{children}</div>}
    </section>
  );
}
