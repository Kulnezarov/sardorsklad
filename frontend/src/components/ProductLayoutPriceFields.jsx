import React, { useMemo } from 'react';
import { groupLayoutRowsForDisplay, layoutRowLabel } from '../utils/formLayoutUtils';
import { Input, TextArea } from './ui';

const DELIVERY_MODES = [
  { id: 'custom', label: 'Своя цена' },
  { id: 'normal', label: 'Обычная' },
  { id: 'express', label: 'Экспресс' },
];

const PURCHASE_KEYS = new Set(['cny_price', 'delivery_block']);

function optionalNum(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const roundMoneyKzt = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const roundKgVal = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

export default function ProductLayoutPriceFields({
  rows = [],
  schema,
  formData,
  setFormData,
  cnyRate = 65,
  deliveryKztPerKg = 800,
  deliveryMode = 'normal',
  setDeliveryMode,
  customDeliveryRate = '',
  setCustomDeliveryRate,
  settingsDeliveryRate = 800,
  highlightStyle = {},
}) {
  const { purchaseRows, otherRows } = useMemo(() => {
    const purchase = [];
    const other = [];
    (rows || []).forEach((r) => {
      if (PURCHASE_KEYS.has(r.key)) purchase.push(r);
      else other.push(r);
    });
    return { purchaseRows: purchase, otherRows: other };
  }, [rows]);

  const otherBlocks = groupLayoutRowsForDisplay(otherRows);

  const renderCny = (row) => (
    <div key={row.id} className="product-price-card product-price-card--cny">
      <div className="product-price-card__head">
        <span className="product-price-card__badge">¥</span>
        <span className="product-price-card__title">{layoutRowLabel(row, schema)}</span>
      </div>
      <input
        className="ios-input product-price-card__input"
        type="number"
        step="0.1"
        min="0"
        placeholder="0"
        value={formData.cny_price}
        onChange={(e) => {
          const v = e.target.value;
          setFormData((prev) => {
            const next = { ...prev, cny_price: v };
            const cny = optionalNum(v);
            const del = optionalNum(prev.delivery_cost_kzt) || 0;
            if (cny != null && cny > 0) {
              next.purchase_price = Number(cny) * cnyRate + del;
            }
            return next;
          });
        }}
        style={highlightStyle}
      />
      <p className="product-price-card__hint">
        Курс: 1 ¥ = {cnyRate} ₸ · тариф {deliveryKztPerKg.toLocaleString('ru-RU')} ₸/кг
      </p>
    </div>
  );

  const renderDelivery = (row) => (
    <div key={row.id} className="product-price-card product-price-card--delivery">
      <div className="product-price-card__head">
        <span className="product-price-card__badge product-price-card__badge--delivery">₸</span>
        <span className="product-price-card__title">{layoutRowLabel(row, schema)}</span>
      </div>
      <div className="product-delivery-chips">
        {DELIVERY_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`product-delivery-chip${deliveryMode === mode.id ? ' product-delivery-chip--active' : ''}`}
            onClick={() => setDeliveryMode?.(mode.id)}
          >
            <span>
              {mode.id === 'normal' ? `Обычная · ${settingsDeliveryRate} ₸/кг` : mode.label}
            </span>
            {mode.id === 'express' && <small>2000 ₸/кг</small>}
          </button>
        ))}
      </div>
      {deliveryMode === 'custom' && (
        <input
          className="ios-input product-price-card__input"
          type="number"
          min="0.1"
          step="0.1"
          value={customDeliveryRate}
          onChange={(e) => setCustomDeliveryRate?.(e.target.value)}
          placeholder="Свой тариф, ₸/кг"
        />
      )}
      <div className="product-delivery-fields">
        <label className="product-delivery-field">
          <span>Сумма, ₸</span>
          <input
            className="ios-input"
            type="number"
            step="0.01"
            min="0"
            placeholder="0"
            value={formData.delivery_cost_kzt}
            onChange={(e) => {
              const v = e.target.value;
              setFormData((prev) => {
                const next = { ...prev, delivery_cost_kzt: v };
                const d = optionalNum(v);
                if (d != null && d > 0 && deliveryKztPerKg > 0) {
                  const kg = roundKgVal(d / deliveryKztPerKg);
                  next.delivery_weight_kg = kg != null ? String(kg) : '';
                } else if (v === '' || v == null) {
                  next.delivery_weight_kg = '';
                }
                const cny = optionalNum(prev.cny_price);
                const del = optionalNum(v) || 0;
                if (cny != null && cny > 0) {
                  next.purchase_price = Number(cny) * cnyRate + del;
                }
                return next;
              });
            }}
            style={highlightStyle}
          />
        </label>
        <label className="product-delivery-field">
          <span>Вес, кг</span>
          <input
            className="ios-input"
            type="number"
            step="0.001"
            min="0"
            placeholder="0"
            value={formData.delivery_weight_kg}
            onChange={(e) => {
              const v = e.target.value;
              setFormData((prev) => {
                const next = { ...prev, delivery_weight_kg: v };
                const w = optionalNum(v);
                if (w != null && w > 0 && deliveryKztPerKg > 0) {
                  const m = roundMoneyKzt(w * deliveryKztPerKg);
                  next.delivery_cost_kzt = m != null ? String(m) : '';
                } else if (v === '' || v == null) {
                  next.delivery_cost_kzt = '';
                }
                const cny = optionalNum(prev.cny_price);
                const del = optionalNum(next.delivery_cost_kzt) || 0;
                if (cny != null && cny > 0) {
                  next.purchase_price = Number(cny) * cnyRate + del;
                }
                return next;
              });
            }}
            style={highlightStyle}
          />
        </label>
      </div>
    </div>
  );

  const renderBuiltin = (row) => {
    const label = layoutRowLabel(row, schema);
    const hs = highlightStyle;

    if (row.key === 'sale_price') {
      return (
        <div key={row.id} className="product-price-card product-price-card--compact">
          <Input
            label={`${label} *`}
            type="number"
            step="0.01"
            min="0"
            value={formData.sale_price || 0}
            onChange={(e) => setFormData({ ...formData, sale_price: parseFloat(e.target.value) || 0 })}
            style={hs}
          />
        </div>
      );
    }

    if (row.key === 'quantity') {
      return (
        <div key={row.id} className="product-price-card product-price-card--compact">
          <Input
            label={label}
            type="number"
            min="0"
            value={formData.quantity || 0}
            onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 0 })}
            style={hs}
          />
        </div>
      );
    }

    if (row.key === 'supplier') {
      return (
        <Input
          key={row.id}
          label={label}
          placeholder="По желанию"
          value={formData.supplier || ''}
          onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
          style={hs}
        />
      );
    }

    if (row.key === 'description') {
      return (
        <TextArea
          key={row.id}
          label={label}
          placeholder="По желанию"
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      );
    }

    return null;
  };

  return (
    <div className="product-layout-price-fields">
      {purchaseRows.length > 0 && (
        <div className="product-purchase-grid">
          {purchaseRows.map((row) => {
            if (row.key === 'cny_price') return renderCny(row);
            if (row.key === 'delivery_block') return renderDelivery(row);
            return null;
          })}
        </div>
      )}

      {otherBlocks.map((block, idx) => {
        if (block.type === 'half-row') {
          return (
            <div key={`half-${idx}`} className="product-layout-price-fields__pair">
              {block.items.map((row) => renderBuiltin(row))}
            </div>
          );
        }
        return renderBuiltin(block.row);
      })}
    </div>
  );
}
