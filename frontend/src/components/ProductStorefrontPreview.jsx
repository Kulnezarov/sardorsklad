import React from 'react';
import { FiGlobe, FiX } from 'react-icons/fi';

export default function ProductStorefrontPreview({ preview, onHide }) {
  if (!preview) return null;

  return (
    <aside className="product-storefront-preview" aria-label="Превью на витрине CHPARTS">
      <div className="product-storefront-preview__head">
        <div className="product-storefront-preview__head-title">
          <FiGlobe size={14} />
          <span>Как на CHPARTS</span>
        </div>
        {onHide && (
          <button
            type="button"
            className="product-storefront-preview__hide"
            onClick={onHide}
            title="Скрыть превью"
          >
            <FiX size={14} />
            Скрыть
          </button>
        )}
      </div>
      <div className="product-storefront-preview__card">
        <div className="product-storefront-preview__photo">📦</div>
        <div className="product-storefront-preview__body">
          <div className="product-storefront-preview__name">{preview.name}</div>
          {preview.purpose && (
            <div className="product-storefront-preview__purpose">{preview.purpose}</div>
          )}
          {preview.highlights?.length > 0 && (
            <div className="product-storefront-preview__highlights">
              {preview.highlights.map((h) => (
                <span key={h} className="product-storefront-preview__pill">{h}</span>
              ))}
            </div>
          )}
          {preview.compatPrimary && (
            <div className="product-storefront-preview__compat">
              Совместим с {preview.compatPrimary}
              {preview.compatMore > 0 ? ` +${preview.compatMore}` : ''}
            </div>
          )}
          <div className="product-storefront-preview__price">
            {preview.salePrice > 0
              ? `${Number(preview.salePrice).toLocaleString('ru-RU')} ₸`
              : '— ₸'}
            <span className={`product-storefront-preview__stock${preview.inStock ? ' product-storefront-preview__stock--ok' : ''}`}>
              {preview.inStock ? 'В наличии' : 'Нет в наличии'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
