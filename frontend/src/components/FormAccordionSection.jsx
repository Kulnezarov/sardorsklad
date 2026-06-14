import React, { useState } from 'react';

/** Сворачиваемая секция формы — как в мобильном приложении. */
export default function FormAccordionSection({
  title,
  subtitle,
  icon,
  iconColor,
  initiallyExpanded = false,
  /** В накладной: секции всегда развёрнуты, без клика по заголовку */
  alwaysOpen = false,
  children,
  className = '',
}) {
  const [expanded, setExpanded] = useState(alwaysOpen || initiallyExpanded);
  const isOpen = alwaysOpen || expanded;

  const headContent = (
    <>
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
      {!alwaysOpen && <span className="form-accordion__chevron" aria-hidden />}
    </>
  );

  return (
    <section
      className={`form-accordion${isOpen ? ' form-accordion--open' : ''}${alwaysOpen ? ' form-accordion--always-open' : ''}${className ? ` ${className}` : ''}`}
    >
      {alwaysOpen ? (
        <div className="form-accordion__head form-accordion__head--static" aria-expanded="true">
          {headContent}
        </div>
      ) : (
        <button
          type="button"
          className="form-accordion__head"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={isOpen}
        >
          {headContent}
        </button>
      )}
      {isOpen && <div className="form-accordion__body">{children}</div>}
    </section>
  );
}
