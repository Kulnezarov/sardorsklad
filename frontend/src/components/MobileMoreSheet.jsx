import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FiX,
  FiTruck,
  FiList,
  FiClock,
  FiSettings,
  FiChevronRight,
} from 'react-icons/fi';

const MORE_ITEMS = [
  { path: '/reserve', label: 'Резерв', hint: 'Заказы поставщику', Icon: FiTruck },
  { path: '/orders', label: 'Заказы', hint: 'Заказы клиентов', Icon: FiList },
  { path: '/history', label: 'История', hint: 'Журнал операций', Icon: FiClock },
  { path: '/settings', label: 'Настройки', hint: 'Категории, курс, каталог', Icon: FiSettings },
];

export default function MobileMoreSheet({ open, onClose }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (path) => {
    onClose();
    navigate(path);
  };

  return createPortal(
    <div className="mobile-more-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Ещё разделы"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-more-sheet__handle" aria-hidden />
        <div className="mobile-more-sheet__head">
          <h2 className="mobile-more-sheet__title">Ещё</h2>
          <button type="button" className="mobile-more-sheet__close" aria-label="Закрыть" onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>
        <div className="mobile-more-sheet__list">
          {MORE_ITEMS.map(({ path, label, hint, Icon }) => (
            <button key={path} type="button" className="mobile-more-sheet__row" onClick={() => go(path)}>
              <span className="mobile-more-sheet__row-icon">
                <Icon size={20} strokeWidth={2} />
              </span>
              <span className="mobile-more-sheet__row-text">
                <span className="mobile-more-sheet__row-label">{label}</span>
                <span className="mobile-more-sheet__row-hint">{hint}</span>
              </span>
              <FiChevronRight size={18} className="mobile-more-sheet__row-chevron" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
