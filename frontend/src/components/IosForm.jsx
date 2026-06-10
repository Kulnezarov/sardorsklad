import React from 'react';

/** Блок формы как в iOS Settings (заголовок → белая карточка → подпись). */
export function IosFormBlock({ title, footer, children, className = '' }) {
  return (
    <section className={`ios-form-block${className ? ` ${className}` : ''}`}>
      {title && <h3 className="ios-form-section-header">{title}</h3>}
      {children}
      {footer && <p className="ios-form-section-footer">{footer}</p>}
    </section>
  );
}

/** Белая inset-карточка с разделителями между строками. */
export function IosFormGroup({ children, className = '', padded = false }) {
  return (
    <div className={`ios-form-group${padded ? ' ios-form-group--padded' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}

/** Строка формы: подпись слева, поле справа (или stacked для chip/textarea). */
export function IosFormRow({ label, children, stacked = false, className = '' }) {
  return (
    <div className={`ios-form-row${stacked ? ' ios-form-row--stacked' : ''}${className ? ` ${className}` : ''}`}>
      {label && <span className="ios-form-row__label">{label}</span>}
      <div className="ios-form-row__control">{children}</div>
    </div>
  );
}

export function IosFormHint({ children, className = '' }) {
  if (!children) return null;
  return <p className={`ios-form-hint${className ? ` ${className}` : ''}`}>{children}</p>;
}
