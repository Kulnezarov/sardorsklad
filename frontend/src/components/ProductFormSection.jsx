import React from 'react';
import { IosFormBlock, IosFormGroup } from './IosForm';

/** Секция формы товара в стиле iOS Settings (inset grouped). */
export default function ProductFormSection({
  step,
  title,
  subtitle,
  footer,
  icon,
  iconColor,
  children,
  className = '',
  muted = false,
}) {
  const sectionTitle = title || (step != null ? `Шаг ${step}` : null);
  const sectionFooter = footer || subtitle;

  return (
    <IosFormBlock
      title={sectionTitle}
      footer={sectionFooter}
      className={`product-form-section${muted ? ' product-form-section--muted' : ''}${className ? ` ${className}` : ''}`}
    >
      <IosFormGroup padded className="product-form-section__group">
        {children}
      </IosFormGroup>
    </IosFormBlock>
  );
}

export function ProductFormTemplateBadge({ path }) {
  if (!path) return null;
  return (
    <div className="product-form-template-badge">
      <span className="product-form-template-badge__label">Шаблон</span>
      <span className="product-form-template-badge__path">{path}</span>
    </div>
  );
}
