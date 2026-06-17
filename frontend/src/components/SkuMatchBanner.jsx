import React from 'react';
import { FiCopy, FiExternalLink, FiPackage, FiX } from 'react-icons/fi';
import { formatProductId } from '../utils/productTemplateCopy';

/**
 * Подсказка при совпадении артикула с товаром на складе.
 * mode: catalog | intake — разный текст подсказки.
 */
export default function SkuMatchBanner({
  product,
  sku,
  mode = 'catalog',
  loading = false,
  onCopy,
  onOpen,
  onDismiss,
}) {
  if (!product && !loading) return null;

  const name = product?.name || 'Товар';
  const idLabel = product?.id != null ? formatProductId(product.id) : '';
  const hint = mode === 'intake'
    ? 'Можно скопировать название, категорию, цены и фото. Штрих-код, количество и примечания строки не изменятся.'
    : 'Можно скопировать название, категорию, цены и фото. Штрих-код останется новым.';

  return (
    <div
      className="sku-match-banner"
      style={{
        marginTop: 10,
        padding: '12px 14px',
        borderRadius: 'var(--radius-ios, 14px)',
        border: '1px solid color-mix(in srgb, var(--primary) 28%, var(--border))',
        background: 'color-mix(in srgb, var(--primary) 6%, var(--surface))',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'var(--primary-light, rgba(99,102,241,0.12))',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FiPackage size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>
            {loading ? 'Проверяем артикул…' : (
              <>
                Артикул «
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{sku}</span>
                » уже на складе
              </>
            )}
          </div>
          {!loading && (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 600 }}>
                {name}
                {product?.brand ? ` · ${product.brand}` : ''}
              </div>
              {idLabel && (
                <span
                  style={{
                    display: 'inline-flex',
                    marginTop: 6,
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, monospace',
                    background: 'var(--ios-grouped-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {idLabel}
                </span>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.45 }}>
                {hint}
              </div>
            </>
          )}
        </div>
        {onDismiss && !loading && (
          <button
            type="button"
            onClick={onDismiss}
            title="Скрыть"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FiX size={16} />
          </button>
        )}
      </div>
      {!loading && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn-ios-primary"
            onClick={onCopy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <FiCopy size={15} />
            Скопировать данные
          </button>
          <button
            type="button"
            className="btn-ios-secondary"
            onClick={onOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <FiExternalLink size={15} />
            Открыть товар
          </button>
        </div>
      )}
    </div>
  );
}
