import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiChevronLeft, FiChevronRight, FiDownload, FiX } from 'react-icons/fi';
import { resolveUploadedAssetUrl } from '../api/client';

function fileNameFromUrl(url, title, index) {
  try {
    const clean = String(url || '').split('?')[0];
    const last = clean.split('/').filter(Boolean).pop();
    if (last && last.includes('.')) return last;
  } catch (_) {
    /* ignore */
  }
  const base = String(title || 'photo')
    .trim()
    .replace(/[^\w\-а-яА-ЯёЁ]+/g, '_')
    .slice(0, 40);
  return `${base || 'photo'}_${index + 1}.jpg`;
}

export default function ProductImageLightbox({
  urls = [],
  index = 0,
  title = '',
  onClose,
  onIndexChange,
}) {
  const safeUrls = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const n = safeUrls.length;
  const current = n > 0 ? Math.min(Math.max(0, index), n - 1) : 0;
  const src = n > 0 ? resolveUploadedAssetUrl(safeUrls[current]) : '';
  const [downloading, setDownloading] = useState(false);

  const goPrev = useCallback(() => {
    if (n <= 1) return;
    onIndexChange?.((current - 1 + n) % n);
  }, [n, current, onIndexChange]);

  const goNext = useCallback(() => {
    if (n <= 1) return;
    onIndexChange?.((current + 1) % n);
  }, [n, current, onIndexChange]);

  const downloadCurrent = useCallback(async () => {
    if (!src || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileNameFromUrl(src, title, current);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (_) {
      // Fallback: open in new tab if blob download blocked
      window.open(src, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }, [src, downloading, title, current]);

  useEffect(() => {
    if (!n) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [n, onClose, goPrev, goNext]);

  if (!n || !src) return null;

  return createPortal(
    <div
      className="product-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Фото: ${title}` : 'Просмотр фото'}
      onClick={onClose}
    >
      <div className="product-image-lightbox__toolbar">
        {title ? <span className="product-image-lightbox__title">{title}</span> : <span />}
        {n > 1 ? (
          <span className="product-image-lightbox__counter">
            {current + 1} / {n}
          </span>
        ) : null}
        <div className="product-image-lightbox__actions">
          <button
            type="button"
            className="product-image-lightbox__download"
            onClick={(e) => {
              e.stopPropagation();
              downloadCurrent();
            }}
            disabled={downloading}
            aria-label="Скачать фото"
            title="Скачать фото"
          >
            <FiDownload size={20} />
          </button>
          <button type="button" className="product-image-lightbox__close" onClick={onClose} aria-label="Закрыть">
            <FiX size={22} />
          </button>
        </div>
      </div>
      <div className="product-image-lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {n > 1 ? (
          <button type="button" className="product-image-lightbox__nav product-image-lightbox__nav--prev" onClick={goPrev} aria-label="Предыдущее фото">
            <FiChevronLeft size={28} />
          </button>
        ) : null}
        <img src={src} alt="" className="product-image-lightbox__img" />
        {n > 1 ? (
          <button type="button" className="product-image-lightbox__nav product-image-lightbox__nav--next" onClick={goNext} aria-label="Следующее фото">
            <FiChevronRight size={28} />
          </button>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="product-image-lightbox__dots" onClick={(e) => e.stopPropagation()}>
          {safeUrls.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`product-image-lightbox__dot${i === current ? ' product-image-lightbox__dot--active' : ''}`}
              onClick={() => onIndexChange?.(i)}
              aria-label={`Фото ${i + 1}`}
            />
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
