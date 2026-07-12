import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JsBarcode from 'jsbarcode';
import { FiPrinter, FiX, FiRefreshCw, FiTag, FiShare2, FiLoader } from 'react-icons/fi';
import { productApi } from '../api/client';
import {
  LABEL_PAPER,
  LABEL_LAYOUT_OPTIONS,
  getLabelLayoutFlags,
  labelCompatOneBrand,
  formatLabelPrice,
  normalizeLabelLayout,
  readStoredLabelLayout,
  storeLabelLayout,
} from '../utils/labelPrintUtils';

const escHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function generateBarcodeDataUrl(value) {
  return new Promise((resolve) => {
    if (!value) {
      resolve(null);
      return;
    }
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 72,
        displayValue: false,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
      resolve(canvas.toDataURL('image/png'));
    } catch {
      try {
        JsBarcode(canvas, value, {
          format: 'auto',
          width: 2,
          height: 72,
          displayValue: false,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    }
  });
}

const LabelPrint = ({
  isOpen,
  onClose,
  product: productProp,
  initialLabelLayout,
  labelSize: _labelSizeProp = 'medium',
}) => {
  const [custom, setCustom] = useState('');
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [layoutMode, setLayoutMode] = useState(readStoredLabelLayout());
  const [resolvedProduct, setResolvedProduct] = useState(null);
  const [loadingProduct, setLoadingProduct] = useState(false);

  const barcodeCanvasRef = useRef(null);
  const baseProduct = resolvedProduct || productProp;
  const product =
    baseProduct && productProp && Number(productProp.sale_price) > 0
      ? { ...baseProduct, sale_price: productProp.sale_price }
      : baseProduct;

  const barcodeVal = custom.trim() || product?.barcode || product?.sku || String(product?.id || '');
  const layoutFlags = getLabelLayoutFlags(layoutMode);
  const compatText = layoutFlags.showCompat ? labelCompatOneBrand(product) : '';
  const priceText = formatLabelPrice(product);

  useEffect(() => {
    if (!isOpen) {
      setResolvedProduct(null);
      return;
    }
    setCustom('');
    setLayoutMode(normalizeLabelLayout(initialLabelLayout || readStoredLabelLayout()));

    const id = productProp?.id;
    if (!id) {
      setResolvedProduct(productProp);
      return;
    }

    let cancelled = false;
    setLoadingProduct(true);
    productApi
      .getById(id)
      .then((r) => {
        if (!cancelled) setResolvedProduct(r.data);
      })
      .catch(() => {
        if (!cancelled) setResolvedProduct(productProp);
      })
      .finally(() => {
        if (!cancelled) setLoadingProduct(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, productProp, initialLabelLayout]);

  useEffect(() => {
    if (!isOpen || !barcodeCanvasRef.current || !barcodeVal) return;
    const canvas = barcodeCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      JsBarcode(canvas, barcodeVal, {
        format: 'CODE128',
        width: 1.8,
        height: 64,
        displayValue: false,
        margin: 8,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      try {
        JsBarcode(canvas, barcodeVal, {
          format: 'auto',
          width: 1.8,
          height: 64,
          displayValue: false,
          margin: 8,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch {
        /* нечитаемый штрих */
      }
    }
  }, [isOpen, barcodeVal, layoutMode, compatText, product?.name, product?.sale_price]);

  const buildPrintHtml = async () => {
    const { wmm, hmm } = LABEL_PAPER;
    const maxIn = Math.max(10, wmm - 4);
    const codeImgUrl = await generateBarcodeDataUrl(barcodeVal);

    const showName = layoutFlags.showName && (product?.name || '').trim();
    const showCompat = layoutFlags.showCompat && compatText;

    const nameBlock = showName
      ? `<div class="label-name">${escHtml(product.name)}</div>`
      : '';
    const compatBlock = showCompat
      ? `<div class="label-compat">${escHtml(compatText)}</div>`
      : '';

    const textBlocks = showName || showCompat;
    const baseCodeMaxH = !textBlocks ? '22mm' : showCompat ? '13mm' : '16mm';
    const codeMaxH = priceText
      ? (!textBlocks ? '19mm' : showCompat ? '10mm' : '13mm')
      : baseCodeMaxH;

    const codeBlock = codeImgUrl
      ? `<div class="code-wrap">
           <img src="${codeImgUrl}" alt="" />
         </div>
         <div class="code-digits">${escHtml(barcodeVal)}</div>`
      : `<div class="code-fail">Не удалось сгенерировать код</div>`;

    const priceBlock = priceText
      ? `<div class="label-price">${escHtml(priceText)}</div>`
      : '';

    const labelHtml = `<div class="label">
            ${nameBlock}
            ${compatBlock}
            ${codeBlock}
            ${priceBlock}
          </div>`;

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Этикетка SkladPro</title>
  <style>
    @page { size: ${wmm}mm ${hmm}mm; margin: 0; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { width: ${wmm}mm; margin: 0; padding: 0; }
    body {
      width: ${wmm}mm;
      margin: 0;
      padding: 0;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .label {
      width: ${wmm}mm;
      height: ${hmm}mm;
      max-width: ${wmm}mm;
      max-height: ${hmm}mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      page-break-after: always;
      page-break-inside: avoid;
      break-after: page;
      break-inside: avoid;
      padding: 1mm 1.2mm;
    }
    .label-name {
      flex-shrink: 0;
      width: 100%;
      max-height: 10mm;
      font-size: 8pt;
      font-weight: 700;
      line-height: 1.15;
      padding: 0 1mm 0.4mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .label-compat {
      flex-shrink: 0;
      width: 100%;
      max-height: 8mm;
      font-size: 6.5pt;
      font-weight: 600;
      line-height: 1.12;
      padding: 0 1mm 0.4mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .code-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      flex: 1 1 auto;
      min-height: 0;
    }
    .code-wrap img {
      display: block;
      margin: 0 auto;
      max-width: ${maxIn}mm;
      max-height: ${codeMaxH};
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .code-digits {
      flex-shrink: 0;
      margin-top: 0.5mm;
      padding: 0 1mm;
      font-family: ui-monospace, 'Courier New', monospace;
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #000;
      line-height: 1.1;
      max-width: ${maxIn}mm;
      word-break: break-all;
    }
    .label-price {
      flex-shrink: 0;
      margin-top: 0.6mm;
      padding: 0 1mm;
      font-size: 9pt;
      font-weight: 800;
      line-height: 1.1;
      color: #000;
      text-align: center;
      width: 100%;
    }
    .code-fail { font-size: 8pt; color: #c00; padding: 2mm; }
    @media print {
      html, body { width: ${wmm}mm !important; margin: 0 !important; padding: 0 !important; height: auto !important; }
      .label {
        width: ${wmm}mm !important;
        height: ${hmm}mm !important;
        max-width: ${wmm}mm !important;
        max-height: ${hmm}mm !important;
      }
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`;
  };

  const handlePrint = async () => {
    if (!product) return;
    setPrinting(true);
    try {
      const html = await buildPrintHtml();
      const win = window.open('', '_blank', 'width=700,height=600,menubar=no,toolbar=no');
      if (!win) {
        alert('Разрешите всплывающие окна для печати');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          /* focus/print заблокированы */
        }
      }, 500);
    } finally {
      setPrinting(false);
    }
  };

  const handleShare = async () => {
    if (!product) return;
    setSharing(true);
    try {
      const dataUrl = await generateBarcodeDataUrl(barcodeVal);
      if (!dataUrl) {
        alert('Не удалось сгенерировать изображение');
        return;
      }
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `label_${String(barcodeVal).replace(/\s+/g, '_')}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'Этикетка', files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = fileName;
        a.click();
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Share failed:', err);
    } finally {
      setSharing(false);
    }
  };

  if (!isOpen) return null;

  const previewShowName = layoutFlags.showName && Boolean(product?.name);
  const previewShowCompat = layoutFlags.showCompat && Boolean(compatText);

  const closeBtnStyle = {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    flexShrink: 0,
  };

  const sectionTitleStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: 10,
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#6b7280',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '60px 16px 24px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 500,
          background: 'var(--surface)',
          borderRadius: 24,
          border: '1px solid var(--border)',
          boxShadow: 'none',
          overflow: 'hidden',
          animation: 'sheetUp 0.22s ease-out',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'var(--primary-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                flexShrink: 0,
              }}
            >
              <FiTag size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Печать этикетки</div>
              {product && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    fontWeight: 500,
                    maxWidth: 280,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {product.name}
                </div>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="Закрыть">
            <FiX size={16} />
          </button>
        </div>

        {product && (
          <div style={{ padding: '20px 22px' }}>
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Xprinter · бумага <strong style={{ color: 'var(--text)' }}>{LABEL_PAPER.label}</strong>
              {loadingProduct && (
                <span style={{ marginLeft: 8, color: 'var(--primary)' }}>загрузка совместимости…</span>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={sectionTitleStyle}>Состав этикетки</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {LABEL_LAYOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setLayoutMode(opt.value);
                      storeLabelLayout(opt.value);
                    }}
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 12,
                      border: `2px solid ${layoutMode === opt.value ? 'var(--primary)' : 'var(--border)'}`,
                      background: layoutMode === opt.value ? 'var(--primary-light)' : 'var(--surface)',
                      color: layoutMode === opt.value ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={sectionTitleStyle}>Предпросмотр ({LABEL_PAPER.label})</div>
              <div
                style={{
                  background: 'var(--ios-grouped-bg)',
                  borderRadius: 16,
                  padding: 16,
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: LABEL_PAPER.previewW,
                    height: LABEL_PAPER.previewH,
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 8px',
                    boxSizing: 'border-box',
                  }}
                >
                  {previewShowName && (
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        textAlign: 'center',
                        lineHeight: 1.2,
                        marginBottom: 4,
                        color: '#111',
                        maxHeight: 38,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        width: '100%',
                      }}
                    >
                      {product.name}
                    </div>
                  )}
                  {previewShowCompat && (
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textAlign: 'center',
                        lineHeight: 1.15,
                        marginBottom: 4,
                        color: '#333',
                        maxHeight: 28,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        width: '100%',
                      }}
                    >
                      {compatText}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, width: '100%' }}>
                    <canvas ref={barcodeCanvasRef} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'ui-monospace, monospace',
                      letterSpacing: '0.08em',
                      color: '#111',
                      textAlign: 'center',
                      width: '100%',
                      wordBreak: 'break-all',
                    }}
                  >
                    {barcodeVal}
                  </div>
                  {priceText && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        fontWeight: 800,
                        color: '#111',
                        textAlign: 'center',
                        width: '100%',
                      }}
                    >
                      {priceText}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={sectionTitleStyle}>
                Значение штрих-кода{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none' }}>(необязательно)</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="ios-input"
                  style={{ flex: 1 }}
                  inputMode="text"
                  placeholder={product.barcode || product.sku || 'Как на этикетке'}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                {custom && (
                  <button
                    type="button"
                    onClick={() => setCustom('')}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                    aria-label="Сбросить"
                  >
                    <FiRefreshCw size={15} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing || printing || loadingProduct}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: 14,
                  border: '2px solid var(--primary)',
                  background: 'var(--primary-light)',
                  color: 'var(--primary)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: sharing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {sharing ? (
                  <>
                    <FiLoader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Подготовка…
                  </>
                ) : (
                  <>
                    <FiShare2 size={16} /> AirDrop / Поделиться
                  </>
                )}
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    flex: 1,
                    padding: '13px',
                    borderRadius: 14,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Закрыть
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={printing || sharing || loadingProduct}
                  style={{
                    flex: 2,
                    padding: '13px',
                    borderRadius: 14,
                    border: printing || loadingProduct ? '1px solid var(--border)' : '1px solid #4f46e5',
                    background: printing || loadingProduct ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                    color: printing || loadingProduct ? 'var(--text-muted)' : '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: printing || loadingProduct ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <FiPrinter size={17} />
                  {printing ? 'Подготовка…' : loadingProduct ? 'Загрузка…' : 'Печать'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default LabelPrint;
