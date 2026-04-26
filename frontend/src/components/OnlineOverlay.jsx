import React, { useEffect, useState } from 'react';
import { FiWifi } from 'react-icons/fi';

/**
 * Полноэкранное уведомление при потере сети (оформление как 404, без PWA/оффлайн-режима).
 */
function OnlineOverlay() {
  const [online, setOnline] = useState(
    () => (typeof navigator !== 'undefined' ? navigator.onLine : true)
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;

  return (
    <div className="static-page-overlay" role="alertdialog" aria-live="assertive" aria-label="Нет сети">
      <div className="static-page-mesh" />
      <div className="static-page-orb static-page-orb--tl" />
      <div className="static-page-orb static-page-orb--br" />
      <div className="static-page-card static-page-card--compact">
        <div className="static-page-icon-wrap">
          <FiWifi size={40} strokeWidth={1.5} style={{ transform: 'rotate(-45deg)', opacity: 0.9 }} />
        </div>
        <h1 className="static-page-title">Нет подключения</h1>
        <p className="static-page-text">
          Проверьте Wi‑Fi или мобильный интернет, затем нажмите кнопку ниже.
        </p>
        <button
          type="button"
          className="static-page-btn"
          onClick={() => window.location.reload()}
        >
          Повторить
        </button>
      </div>
    </div>
  );
}

export default OnlineOverlay;
