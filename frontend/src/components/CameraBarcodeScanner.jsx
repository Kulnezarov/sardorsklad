import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiCamera, FiX } from 'react-icons/fi';

const SUPPORTED_FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'];

export default function CameraBarcodeScanner({ isOpen, onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const lastScanRef = useRef(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;

    const stopAll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const run = async () => {
      try {
        if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia) {
          setError('Камера недоступна в этом браузере');
          return;
        }
        if (!('BarcodeDetector' in window)) {
          setError('Сканирование камерой не поддерживается на этом устройстве');
          return;
        }

        detectorRef.current = new window.BarcodeDetector({ formats: SUPPORTED_FORMATS });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const tick = async () => {
          if (!videoRef.current || !detectorRef.current) return;
          try {
            const now = Date.now();
            if (now - lastScanRef.current > 400) {
              const codes = await detectorRef.current.detect(videoRef.current);
              if (codes?.length) {
                const value = String(codes[0].rawValue || '').trim();
                if (value) {
                  lastScanRef.current = now;
                  onDetected?.(value);
                  onClose?.();
                  return;
                }
              }
            }
          } catch {
            // ignore intermittent detector errors
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setError(e?.message || 'Не удалось открыть камеру');
      }
    };

    run();
    return stopAll;
  }, [isOpen, onClose, onDetected]);

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, background: 'var(--surface)', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden' }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <FiCamera size={16} /> Сканирование камерой
          </div>
          <button type="button" onClick={onClose} style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 10, width: 30, height: 30 }}>
            <FiX size={14} />
          </button>
        </div>
        <div style={{ padding: 12 }}>
          {error ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--danger)' }}>{error}</div>
          ) : (
            <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000', minHeight: 220 }} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
