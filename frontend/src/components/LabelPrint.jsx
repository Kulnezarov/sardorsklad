import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JsBarcode from 'jsbarcode';
import QRCodeLib from 'qrcode';
import { FiPrinter, FiX, FiRefreshCw, FiTag, FiShare2, FiLoader } from 'react-icons/fi';

/**
 * Три физ. размера; по умолчанию «малый» — обычно только штрих-код.
 * «Название + штрихкод» или «только штрихкод» (для малых этикеток).
 */
const SPECS = {
  small: { wmm: 50, hmm: 30, label: '5×3 см', previewW: 250, previewH: 150 },
  medium: { wmm: 60, hmm: 40, label: '6×4 см', previewW: 300, previewH: 200 },
  large: { wmm: 80, hmm: 50, label: '8×5 см', previewW: 360, previewH: 220 },
};

function getSpec(k) {
  return SPECS[k] || SPECS.small;
}

const escHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Генерация PNG для печати: без встроенных цифр — цифры выводим отдельно по центру */
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

const LabelPrint = ({ isOpen, onClose, product, settings: _settings, initialLabelType = 'barcode', labelSize: labelSizeProp = 'small' }) => {
  const [type, setType] = useState(initialLabelType);
  const [custom, setCustom] = useState('');
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** name_barcode | barcode_only */
  const [contentLayout, setContentLayout] = useState('barcode_only');
  const [sizeKey, setSizeKey] = useState(labelSizeProp);

  const barcodeCanvasRef = useRef(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState('');

  const barcodeVal = custom.trim() || product?.barcode || product?.sku || String(product?.id || '');
  const qrVal = product?.barcode || product?.sku || String(product?.id || '');

  const spec = getSpec(sizeKey);

  useEffect(() => {
    if (isOpen) {
      setType(initialLabelType);
      setCustom('');
      setQrPreviewUrl('');
      setSizeKey(['small', 'medium', 'large'].includes(String(labelSizeProp)) ? labelSizeProp : 'small');
      setContentLayout(String(labelSizeProp) === 'small' ? 'barcode_only' : 'name_barcode');
    }
  }, [isOpen, initialLabelType, labelSizeProp]);

  useEffect(() => {
    if (!isOpen || type !== 'barcode' || !barcodeCanvasRef.current || !barcodeVal) return;
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
        /* нечитаемый штрих для CODE128/auto */
      }
    }
  }, [isOpen, type, barcodeVal, contentLayout]);

  useEffect(() => {
    if (!isOpen || type !== 'qrcode' || !qrVal) return;
    QRCodeLib.toDataURL(qrVal, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQrPreviewUrl)
      .catch(console.error);
  }, [isOpen, type, qrVal]);

  const handlePrint = async () => {
    if (!product) return;
    setPrinting(true);

    const wmm = spec.wmm;
    const hmm = spec.hmm;
    const maxIn = Math.max(10, wmm - 4);

    let codeImgUrl = '';
    if (type === 'barcode') {
      codeImgUrl = await generateBarcodeDataUrl(barcodeVal);
    } else {
      try {
        codeImgUrl = await QRCodeLib.toDataURL(qrVal, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
      } catch {
        codeImgUrl = '';
      }
    }

    const isQr = type === 'qrcode';
    const showName = contentLayout === 'name_barcode' && (product.name || '').trim();
    const nameBlock = showName
      ? `<div class="label-name">${escHtml(product.name)}</div>`
      : '';

    const codeBlock = codeImgUrl
      ? `<div class="code-wrap">
           <img src="${codeImgUrl}" alt="" />
         </div>
         ${!isQr ? `<div class="code-digits">${escHtml(barcodeVal)}</div>` : ''}`
      : `<div class="code-fail">Не удалось сгенерировать код</div>`;

    const labelHtml = `<div class="label ${isQr ? 'label--qr' : 'label--barcode'}">
            ${nameBlock}
            ${codeBlock}
          </div>`;

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Этикетка SkladPro</title>
  <style>
    @page {
      size: ${wmm}mm ${hmm}mm;
      margin: 0;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html {
      width: ${wmm}mm;
      margin: 0;
      padding: 0;
    }
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
    .label:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .label-name {
      flex-shrink: 0;
      width: 100%;
      max-height: 9mm;
      font-size: ${wmm >= 60 ? 8 : 6.5}pt;
      font-weight: 700;
      line-height: 1.15;
      padding: 0 1mm 0.6mm;
      overflow: hidden;
      text-overflow: ellipsis;
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
      max-height: ${showName ? (isQr ? '22mm' : '18mm') : isQr ? '26mm' : '22mm'};
      width: auto;
      height: auto;
      object-fit: contain;
      image-orientation: from-image;
      transform: none;
    }
    .label--qr .code-wrap img {
      max-width: ${Math.min(40, wmm - 6)}mm;
      max-height: ${Math.min(32, hmm - 8)}mm;
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
    .code-fail { font-size: 8pt; color: #c00; padding: 2mm; }

    @media print {
      html, body {
        width: ${wmm}mm !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
      }
      .label {
        width: ${wmm}mm !important;
        height: ${hmm}mm !important;
        max-width: ${wmm}mm !important;
        max-height: ${hmm}mm !important;
      }
    }
  </style>
</head>
<body>
  ${labelHtml}
</body>
</html>`;

    const win = window.open('', '_blank', 'width=700,height=600,menubar=no,toolbar=no');
    if (!win) {
      alert('Разрешите всплывающие окна для печати');
      setPrinting(false);
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
      setPrinting(false);
    }, 500);
  };

  const handleShare = async () => {
    if (!product) return;
    setSharing(true);
    try {
      let dataUrl = '';
      const val = type === 'barcode' ? barcodeVal : qrVal;

      if (type === 'barcode') {
        dataUrl = await generateBarcodeDataUrl(barcodeVal);
      } else {
        dataUrl = await QRCodeLib.toDataURL(qrVal, {
          width: 400,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
      }

      if (!dataUrl) {
        alert('Не удалось сгенерировать изображение');
        setSharing(false);
        return;
      }

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `label_${String(val).replace(/\s+/g, '_')}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Этикетка',
          files: [file],
        });
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
          <button
            type="button"
            onClick={onClose}
            style={{
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
            }}
          >
            <FiX size={16} />
          </button>
        </div>

        {product && (
          <div style={{ padding: '20px 22px' }}>
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Размер: <strong style={{ color: 'var(--text)' }}>{spec.label}</strong> — по умолчанию в настройках «малый», часто печать только штрихкода
            </div>

            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 10,
                }}
              >
                Размер этикетки
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { v: 'small', t: 'Малый' },
                  { v: 'medium', t: 'Средний' },
                  { v: 'large', t: 'Большой' },
                ].map((x) => (
                  <button
                    key={x.v}
                    type="button"
                    onClick={() => {
                      setSizeKey(x.v);
                      if (x.v === 'small') setContentLayout('barcode_only');
                    }}
                    style={{
                      flex: 1,
                      padding: '9px 8px',
                      borderRadius: 12,
                      border: `2px solid ${sizeKey === x.v ? 'var(--primary)' : 'var(--border)'}`,
                      background: sizeKey === x.v ? 'var(--primary-light)' : 'var(--surface)',
                      color: sizeKey === x.v ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {x.t}
                  </button>
                ))}
              </div>
            </div>

            {(type === 'barcode' || type === 'qrcode') && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    marginBottom: 10,
                  }}
                >
                  {type === 'qrcode' ? 'Содержимое (QR)' : 'Содержимое (штрих-код)'}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { v: 'name_barcode', t: type === 'qrcode' ? 'Название + QR' : 'Название + штрих' },
                    { v: 'barcode_only', t: type === 'qrcode' ? 'Только QR' : 'Только штрих' },
                  ].map((x) => (
                    <button
                      key={x.v}
                      type="button"
                      onClick={() => setContentLayout(x.v)}
                      style={{
                        flex: 1,
                        padding: '9px 8px',
                        borderRadius: 12,
                        border: `2px solid ${contentLayout === x.v ? 'var(--primary)' : 'var(--border)'}`,
                        background: contentLayout === x.v ? 'var(--primary-light)' : 'var(--surface)',
                        color: contentLayout === x.v ? 'var(--primary)' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {x.t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 10,
                }}
              >
                Тип кода
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { val: 'barcode', label: 'Штрих-код' },
                  { val: 'qrcode', label: 'QR-код' },
                ].map((t) => (
                  <button
                    key={t.val}
                    type="button"
                    onClick={() => setType(t.val)}
                    style={{
                      flex: 1,
                      padding: '11px 10px',
                      borderRadius: 14,
                      border: `2px solid ${type === t.val ? 'var(--primary)' : 'var(--border)'}`,
                      background: type === t.val ? 'var(--primary-light)' : 'var(--surface)',
                      color: type === t.val ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 10,
                }}
              >
                Предпросмотр ({spec.label})
              </div>
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
                    width: spec.previewW,
                    height: spec.previewH,
                    aspectRatio: `${spec.wmm} / ${spec.hmm}`,
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
                  {type === 'barcode' ? (
                    <>
                      {contentLayout === 'name_barcode' && product?.name && (
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            textAlign: 'center',
                            lineHeight: 1.2,
                            marginBottom: 6,
                            color: '#111',
                            maxHeight: 38,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {product.name}
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
                    </>
                  ) : qrPreviewUrl ? (
                    <>
                      {contentLayout === 'name_barcode' && product?.name && (
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            textAlign: 'center',
                            lineHeight: 1.2,
                            marginBottom: 6,
                            color: '#111',
                            maxHeight: 38,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {product.name}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, width: '100%', minHeight: 0 }}>
                        <img
                          src={qrPreviewUrl}
                          alt=""
                          style={{ width: Math.min(140, spec.previewW - 40), height: Math.min(140, spec.previewW - 40), display: 'block' }}
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: '#999' }}>Генерация…</div>
                  )}
                </div>
              </div>
            </div>

            {type === 'barcode' && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    marginBottom: 8,
                  }}
                >
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
                    >
                      <FiRefreshCw size={15} />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing || printing}
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
                  transition: 'all 0.2s',
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
                  disabled={printing || sharing}
                  style={{
                    flex: 2,
                    padding: '13px',
                    borderRadius: 14,
                    border: printing ? '1px solid var(--border)' : '1px solid #4f46e5',
                    background: printing ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                    color: printing ? 'var(--text-muted)' : '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: printing ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: 'none',
                    transition: 'opacity 0.2s, transform 0.2s',
                    willChange: 'transform',
                  }}
                >
                  <FiPrinter size={17} />
                  {printing ? 'Подготовка…' : 'Печать'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default LabelPrint;
