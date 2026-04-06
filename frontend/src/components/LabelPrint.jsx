import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JsBarcode from 'jsbarcode';
import QRCodeLib from 'qrcode';
import { FiPrinter, FiX, FiRefreshCw, FiTag, FiShare2, FiLoader } from 'react-icons/fi';

/* ── size presets ── */
const SIZES = {
  xs:  { label: 'Маленькая 30×20 мм',  w: '30mm',  h: '20mm',  previewW: 160, previewH: 100, minimal: true },
  def: { label: 'Стандарт 40×30 мм',   w: '40mm',  h: '30mm',  previewW: 200, previewH: 150 },
  sm:  { label: 'Средняя 58×40 мм',    w: '58mm',  h: '40mm',  previewW: 232, previewH: 160 },
  md:  { label: 'Большая 80×60 мм',    w: '80mm',  h: '60mm',  previewW: 280, previewH: 210 },
  lg:  { label: 'XL 100×70 мм',        w: '100mm', h: '70mm',  previewW: 320, previewH: 224 },
};

const escHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ─────────────────────────────────────────────
   Generate barcode PNG via hidden canvas
───────────────────────────────────────────── */
function generateBarcodeDataUrl(value) {
  return new Promise((resolve) => {
    if (!value) { resolve(null); return; }
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 80,
        displayValue: true,
        fontSize: 13,
        margin: 10,
        background: '#ffffff',
        lineColor: '#000000',
      });
      resolve(canvas.toDataURL('image/png'));
    } catch {
      // Try auto-detect format
      try {
        JsBarcode(canvas, value, {
          format: 'auto',
          width: 2,
          height: 80,
          displayValue: true,
          fontSize: 13,
          margin: 10,
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

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
const LabelPrint = ({ isOpen, onClose, product, settings, initialLabelType = 'barcode' }) => {
  const [type, setType]         = useState(initialLabelType);
  const [size, setSize]         = useState('xs');
  const [copies, setCopies]     = useState(1);
  const [custom, setCustom]     = useState('');
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing]   = useState(false);

  /* Preview canvas refs */
  const barcodeCanvasRef = useRef(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState('');

  const barcodeVal = custom.trim() || product?.barcode || product?.sku || String(product?.id || '');
  const qrVal      = product?.barcode || product?.sku || String(product?.id || '');

  /* Reset when opened */
  useEffect(() => {
    if (isOpen) {
      setType(initialLabelType);
      setSize('xs');
      setCustom('');
      setQrPreviewUrl('');
    }
  }, [isOpen, initialLabelType]);

  /* Render barcode preview to canvas */
  useEffect(() => {
    if (!isOpen || type !== 'barcode' || !barcodeCanvasRef.current || !barcodeVal) return;
    try {
      JsBarcode(barcodeCanvasRef.current, barcodeVal, {
        format: 'CODE128',
        width: 1.6,
        height: 52,
        displayValue: true,
        fontSize: 11,
        margin: 6,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      try {
        JsBarcode(barcodeCanvasRef.current, barcodeVal, { format: 'auto', width: 1.6, height: 52, displayValue: true, fontSize: 11, margin: 6, background: '#ffffff', lineColor: '#000000' });
      } catch (_) {}
    }
  }, [isOpen, type, barcodeVal]);

  /* Generate QR preview */
  useEffect(() => {
    if (!isOpen || type !== 'qrcode' || !qrVal) return;
    QRCodeLib.toDataURL(qrVal, { width: 160, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(setQrPreviewUrl)
      .catch(console.error);
  }, [isOpen, type, qrVal]);

  /* ── Print ── */
  const handlePrint = async () => {
    if (!product) return;
    setPrinting(true);

    const s = SIZES[size];
    let codeImgUrl = '';

    if (type === 'barcode') {
      codeImgUrl = await generateBarcodeDataUrl(barcodeVal);
    } else {
      try {
        codeImgUrl = await QRCodeLib.toDataURL(qrVal, {
          width: 200,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
      } catch { codeImgUrl = ''; }
    }

    const codeHtml = codeImgUrl
      ? `<div class="code-wrap"><img src="${codeImgUrl}" alt="${type}" style="max-width:100%;height:auto;display:block;" /></div>
         <div class="code-text">${escHtml(type === 'barcode' ? barcodeVal : qrVal)}</div>`
      : `<div class="code-text" style="color:red">Не удалось сгенерировать код</div>`;

    const isMinimal = s.minimal;
    const labelHtml = Array.from({ length: Math.max(1, Number(copies)) })
      .map(() => isMinimal
        ? `<div class="label label-minimal">
            ${codeHtml}
          </div>`
        : `<div class="label">
            <div class="pname">${escHtml(product.name)}</div>
            ${product.brand
              ? `<div class="psub">${escHtml(product.brand)}${product.category ? ' · ' + escHtml(product.category) : ''}</div>`
              : ''}
            ${codeHtml}
            <div class="pprice">${Number(product.sale_price || 0).toLocaleString('ru-RU')} ₸</div>
          </div>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>Этикетки SkladPro</title>
  <style>
    @page { size: ${s.w} ${s.h}; margin: 2mm 2mm 2mm 2mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .label {
      width: 100%;
      min-height: 100%;
      display: flex; flex-direction: column;
      align-items: center; justify-content: space-between;
      text-align: center;
      page-break-after: always;
    }
    .label:last-child { page-break-after: auto; }
    .pname  { font-size: 8pt; font-weight: 900; word-break: break-word; max-width: 100%; line-height: 1.2; }
    .psub   { font-size: 6.5pt; color: #666; margin-top: 0.5mm; }
    .code-wrap { display: flex; align-items: center; justify-content: center; flex: 1; padding: 0.5mm 0; }
    .code-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    .pprice { font-size: 10pt; font-weight: 900; color: #000; border-top: 0.3mm solid #e0e0e0; padding-top: 0.8mm; margin-top: 0.5mm; width: 100%; }
    .label-minimal { justify-content: center; padding: 0.5mm; }
    .label-minimal .code-wrap { padding: 0; flex: none; }
    .label-minimal .code-wrap img { max-height: 14mm; }
    .label-minimal .code-text { font-size: 6pt; margin-top: 0.3mm; }
    .label-minimal .pname, .label-minimal .psub, .label-minimal .pprice { display: none; }
    @media print { html, body { margin: 0; padding: 0; } }
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
    /* Wait for images (base64) to load, then print */
    setTimeout(() => {
      try { win.focus(); win.print(); } catch (_) {}
      setPrinting(false);
    }, 500);
  };

  /* ── Share / AirDrop ── */
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
          width: 400, margin: 2, errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
      }

      if (!dataUrl) { alert('Не удалось сгенерировать изображение'); setSharing(false); return; }

      // Convert dataURL → Blob → File
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `label_${product.name.replace(/\s+/g, '_')}_${val}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: product.name,
          text: `${product.name} — ${Number(product.sale_price || 0).toLocaleString('ru-RU')} ₸`,
          files: [file],
        });
      } else {
        // Fallback: download image
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

  const s = SIZES[size];

  /* ── RENDER ── */
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px 24px', overflowY: 'auto' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 500, background: 'var(--surface)', borderRadius: 24, border: '1px solid var(--border)', boxShadow: 'none', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}>
              <FiTag size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Печать этикетки</div>
              {product && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {product.name}
                </div>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
            <FiX size={16} />
          </button>
        </div>

        {product && (
          <div style={{ padding: '20px 22px' }}>

            {/* Type toggle */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Тип кода</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { val: 'barcode', icon: '▌▌▌▌▌', label: 'Штрих-код' },
                  { val: 'qrcode',  icon: '⬛',    label: 'QR-код' },
                ].map((t) => (
                  <button
                    key={t.val}
                    type="button"
                    onClick={() => setType(t.val)}
                    style={{
                      flex: 1, padding: '11px 10px', borderRadius: 14,
                      border: `2px solid ${type === t.val ? 'var(--primary)' : 'var(--border)'}`,
                      background: type === t.val ? 'var(--primary-light)' : 'var(--surface)',
                      color: type === t.val ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Предпросмотр</div>
              <div style={{ background: 'var(--ios-grouped-bg)', borderRadius: 16, padding: 14, border: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  width: s.previewW, height: s.previewH,
                  background: '#fff', border: '1px dashed #ccc', borderRadius: 8,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', padding: s.minimal ? 4 : 10, overflow: 'hidden', flexShrink: 0,
                }}>
                  {!s.minimal && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 800, wordBreak: 'break-word', maxWidth: '100%', marginBottom: 3, lineHeight: 1.25 }}>
                        {product.name}
                      </div>
                      {product.brand && (
                        <div style={{ fontSize: 9, color: '#666', marginBottom: 6 }}>
                          {product.brand}{product.category ? ` · ${product.category}` : ''}
                        </div>
                      )}
                    </>
                  )}

                  {type === 'barcode' ? (
                    <canvas
                      ref={barcodeCanvasRef}
                      style={{ maxWidth: s.previewW - (s.minimal ? 8 : 20), height: 'auto', display: 'block' }}
                    />
                  ) : (
                    qrPreviewUrl
                      ? <img src={qrPreviewUrl} alt="QR" style={{ width: s.minimal ? 50 : 80, height: s.minimal ? 50 : 80, display: 'block' }} />
                      : <div style={{ width: 80, height: 80, background: '#eee', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#999' }}>Генерация…</div>
                  )}

                  {s.minimal && (
                    <div style={{ fontSize: 8, fontWeight: 700, marginTop: 2, color: '#333', fontFamily: 'ui-monospace,monospace' }}>
                      {barcodeVal}
                    </div>
                  )}

                  {!s.minimal && (
                    <div style={{ fontSize: 10, fontWeight: 800, marginTop: 5 }}>
                      {Number(product.sale_price || 0).toLocaleString('ru-RU')} ₸
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Custom barcode value */}
            {type === 'barcode' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Штрих-код вручную <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none' }}>(необязательно)</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="ios-input"
                    style={{ flex: 1 }}
                    inputMode="numeric"
                    placeholder={product.barcode || product.sku || 'Текущий штрих-код'}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                  {custom && (
                    <button type="button" onClick={() => setCustom('')} style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
                      <FiRefreshCw size={15} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Size + copies */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Размер</div>
                <select
                  className="ios-input"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  style={{ fontSize: 14 }}
                >
                  {Object.entries(SIZES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Копий</div>
                <input
                  className="ios-input"
                  type="number"
                  min="1"
                  max="100"
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ fontSize: 14 }}
                />
              </div>
            </div>

            {/* Mini product info */}
            <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {[
                ['Штрих-код', product.barcode || '—'],
                ['Артикул',   product.sku || '—'],
                ['Марка',     product.brand || '—'],
                ['Категория', product.category || '—'],
                ['Цена',      `${Number(product.sale_price || 0).toLocaleString('ru-RU')} ₸`],
                ['Место',     product.location_zone || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Share / AirDrop row */}
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing || printing}
                style={{
                  width: '100%', padding: '13px', borderRadius: 14,
                  border: '2px solid var(--primary)',
                  background: 'var(--primary-light)',
                  color: 'var(--primary)',
                  fontWeight: 700, fontSize: 14, cursor: sharing ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.2s',
                }}
              >
                {sharing ? (
                  <><FiLoader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Подготовка…</>
                ) : (
                  <><FiShare2 size={16} /> AirDrop / Поделиться</>
                )}
              </button>
              {/* Print + Close row */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}
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
                  {printing ? 'Подготовка…' : `Печать · ${copies} шт`}
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
