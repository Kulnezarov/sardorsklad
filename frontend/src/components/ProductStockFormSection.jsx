import React, { useState } from 'react';
import { FiGlobe, FiLock, FiUnlock, FiRefreshCw, FiMaximize2, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { Input } from './ui';
import ProductLayoutPriceFields from './ProductLayoutPriceFields';
import ProductFormSection from './ProductFormSection';

/**
 * Блок «Коды, цены и склад» в форме товара.
 */
export default function ProductStockFormSection({
  formData,
  setFormData,
  barcodeLocked,
  setBarcodeLocked,
  barcodeCanvasRef,
  sanitizeBarcodeInput,
  generateEAN13,
  layoutPriceRows,
  selectedSubcategorySchema,
  cnyRate,
  deliveryKztPerKg,
  deliveryMode,
  setDeliveryMode,
  customDeliveryRate,
  setCustomDeliveryRate,
  settingsDeliveryRate,
  highlightStyle,
  profitPreview,
  effPurchasePreview,
  optionalNum,
  num,
}) {
  const [showBarcodePreview, setShowBarcodePreview] = useState(false);
  const hasBarcode = Boolean(formData.barcode?.trim());

  return (
    <>
      <ProductFormSection
        title="Коды, цены и склад"
        footer="Штрих-код, закуп, продажа, количество"
        className="product-stock-section"
      >
        <div className="product-stock-grid">
          <div className="product-stock-card product-stock-card--sku">
            <Input
              label="Артикул"
              placeholder="AUTO-000001 или свой"
              value={formData.sku || ''}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              style={highlightStyle}
            />
          </div>

          <div className="product-stock-card product-stock-card--barcode">
            <label className="product-stock-label">Штрих-код</label>
            <div className="product-barcode-row">
              <input
                className="ios-input product-barcode-row__input"
                value={formData.barcode || ''}
                readOnly={barcodeLocked}
                onChange={(e) => !barcodeLocked && setFormData({ ...formData, barcode: sanitizeBarcodeInput(e.target.value) })}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="EAN-13 для сканера"
                style={highlightStyle}
              />
              <div className="product-barcode-toolbar">
                <button
                  type="button"
                  className="product-barcode-tool"
                  title={barcodeLocked ? 'Разблокировать' : 'Замкнуть'}
                  onClick={() => setBarcodeLocked((v) => !v)}
                >
                  {barcodeLocked ? <FiUnlock size={17} /> : <FiLock size={17} />}
                </button>
                <button
                  type="button"
                  className="product-barcode-tool"
                  title="Новый EAN-13"
                  disabled={barcodeLocked}
                  onClick={() => setFormData({ ...formData, barcode: generateEAN13() })}
                >
                  <FiRefreshCw size={17} />
                </button>
                {hasBarcode && (
                  <button
                    type="button"
                    className={`product-barcode-tool${showBarcodePreview ? ' product-barcode-tool--active' : ''}`}
                    title="Превью"
                    onClick={() => setShowBarcodePreview((v) => !v)}
                  >
                    {showBarcodePreview ? <FiChevronUp size={17} /> : <FiMaximize2 size={17} />}
                  </button>
                )}
              </div>
            </div>
            {hasBarcode && showBarcodePreview && (
              <div className="product-barcode-preview">
                <div className="product-barcode-preview__bars">
                  <canvas ref={barcodeCanvasRef} className="product-barcode-preview__canvas" />
                </div>
                <div className="product-barcode-preview__qr">
                  <QRCodeSVG value={String(formData.barcode)} size={120} level="M" />
                </div>
              </div>
            )}
          </div>
        </div>

        <label className="product-storefront-toggle">
          <input
            type="checkbox"
            checked={formData.show_on_storefront !== false}
            onChange={(e) => setFormData({ ...formData, show_on_storefront: e.target.checked })}
          />
          <span className="product-storefront-toggle__icon" aria-hidden>
            <FiGlobe size={18} />
          </span>
          <span className="product-storefront-toggle__text">
            <strong>Показывать на сайте (CHPARTS)</strong>
            <small>Скрытые позиции не видны в каталоге</small>
          </span>
        </label>

        <ProductLayoutPriceFields
          rows={layoutPriceRows}
          schema={selectedSubcategorySchema}
          formData={formData}
          setFormData={setFormData}
          cnyRate={cnyRate}
          deliveryKztPerKg={deliveryKztPerKg}
          deliveryMode={deliveryMode}
          setDeliveryMode={setDeliveryMode}
          customDeliveryRate={customDeliveryRate}
          setCustomDeliveryRate={setCustomDeliveryRate}
          settingsDeliveryRate={settingsDeliveryRate}
          highlightStyle={highlightStyle}
        />

        <div className="product-stock-grid product-stock-grid--bottom">
          <Input
            label="Закуп (₸)"
            type="number"
            step="0.01"
            min="0"
            value={formData.purchase_price ?? 0}
            onChange={(e) => setFormData({ ...formData, purchase_price: parseFloat(e.target.value) || 0 })}
            style={highlightStyle}
          />
          <Input
            label="Место на складе"
            placeholder="А25, B87…"
            value={formData.storage_location || ''}
            onChange={(e) => setFormData({ ...formData, storage_location: e.target.value.toUpperCase() })}
            style={highlightStyle}
          />
        </div>
      </ProductFormSection>

      <div className="product-profit-banner">
        <div className="product-profit-banner__main">
          <span className="product-profit-banner__label">Прибыль</span>
          <span
            className={`product-profit-banner__value${
              parseFloat(profitPreview) < 0
                ? ' product-profit-banner__value--neg'
                : parseFloat(profitPreview) >= 50
                  ? ' product-profit-banner__value--pos'
                  : ''
            }`}
          >
            {profitPreview}%
          </span>
        </div>
        <div className="product-profit-banner__meta">
          Закуп: <strong>{Math.round(effPurchasePreview).toLocaleString('ru-RU')} ₸</strong>
          {(optionalNum(formData.cny_price) || 0) > 0 && num(formData.purchase_price) <= 0 && (
            <span> · из ¥ × {cnyRate}</span>
          )}
        </div>
      </div>
    </>
  );
}
