import React from 'react';

export default function ProductFormProgress({ progress }) {
  if (!progress?.items?.length) return null;
  const { items, done, total, pct } = progress;

  return (
    <div className="product-form-progress" aria-label={`Заполнено ${done} из ${total}`}>
      <div className="product-form-progress__head">
        <div>
          <div className="product-form-progress__title">Заполнение карточки</div>
          <div className="product-form-progress__subtitle">{done} из {total} обязательных полей</div>
        </div>
        <span className="product-form-progress__pct">{pct}%</span>
      </div>
      <div className="product-form-progress__bar-wrap">
        <div className="product-form-progress__bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="product-form-progress__steps">
        {items.map((item) => (
          <span
            key={item.key}
            className={`product-form-progress__step${item.done ? ' product-form-progress__step--done' : ''}`}
          >
            <span className="product-form-progress__step-dot" aria-hidden />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
