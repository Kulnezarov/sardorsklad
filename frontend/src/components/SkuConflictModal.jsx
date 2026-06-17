import React from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { Button, Modal } from './ui';

/**
 * Диалог при совпадении артикула (SKU) с другим товаром — как в мобильном приложении.
 */
export default function SkuConflictModal({
  isOpen,
  sku,
  existing,
  saving = false,
  onCancel,
  onSaveAnyway,
  onShowExisting,
  onCopyTemplate,
}) {
  if (!isOpen) return null;

  const name = existing?.name || 'Товар';
  const brand = existing?.brand ? ` · ${existing.brand}` : '';
  const sale = existing?.sale_price != null ? Number(existing.sale_price) : null;

  return (
    <Modal
      isOpen={isOpen}
      title="Артикул уже используется"
      onClose={onCancel}
      size="md"
      icon={FiAlertTriangle}
      actions={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Отмена
          </Button>
          <Button variant="primary" onClick={onSaveAnyway} loading={saving}>
            Сохранить
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Артикул «
          <strong>{sku}</strong>
          » уже есть у другого товара.
        </p>
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-ios)',
            background: 'var(--ios-grouped-bg)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600 }}>{name}{brand}</div>
          {sale != null && !Number.isNaN(sale) && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Цена продажи:
              {' '}
              {sale.toLocaleString('ru-RU')}
              {' '}
              ₸
            </div>
          )}
        </div>
        {onCopyTemplate && (
          <Button variant="secondary" onClick={onCopyTemplate} disabled={saving}>
            Скопировать данные
          </Button>
        )}
        <Button variant="secondary" onClick={onShowExisting} disabled={saving}>
          Открыть товар
        </Button>
      </div>
    </Modal>
  );
}
