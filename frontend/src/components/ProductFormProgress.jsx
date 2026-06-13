import React from 'react';

export default function ProductFormProgress({ progress }) {
  if (!progress?.items?.length) return null;
  const { items, done, total, pct } = progress;

  return (
    <div className="product-form-progress" aria-label={`Заполнено ${done} из ${total}`}>
      <div className="product-form-progress__bar-wrap">
        <div className="product-form-progress__bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="product-form-progress__meta">
        <span className="product-form-progress__pct">{pct}%</span>
        <span className="product-form-progress__count">{done}/{total} полей</span>
      </div>
      <div className="product-form-progress__chips">
        {items.map((item) => (
          <span
            key={item.key}
            className={`product-form-progress__chip${item.done ? ' product-form-progress__chip--done' : ''}`}
          >
            {item.label} {item.done ? '✓' : '○'}
          </span>
        ))}
      </div>
    </div>
  );
}
