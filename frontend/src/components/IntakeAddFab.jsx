import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiRefreshCw, FiEdit3, FiCamera, FiX } from 'react-icons/fi';

/**
 * Круглая кнопка «+» справа снизу; по нажатию — выбор действия по центру экрана.
 */
export default function IntakeAddFab({
  disabled = false,
  showScan = false,
  onScan,
  onAutoBarcode,
  onEnterBarcode,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn) => {
    setOpen(false);
    fn?.();
  };

  if (disabled) return null;

  const choices = [
    showScan && {
      key: 'scan',
      icon: FiCamera,
      title: 'Сканировать штрих-код',
      hint: 'Камера устройства',
      onClick: onScan,
    },
    onEnterBarcode && {
      key: 'enter',
      icon: FiEdit3,
      title: 'Ввести штрих-код',
      hint: 'Вручную, подставит данные со склада',
      onClick: onEnterBarcode,
    },
    {
      key: 'auto',
      icon: FiRefreshCw,
      title: 'Новый штрих-код',
      hint: 'Автогенерация EAN-13',
      onClick: onAutoBarcode,
    },
  ].filter(Boolean);

  return (
    <>
      <div className="intake-add-fab-root">
        <button
          type="button"
          className={`intake-add-fab-btn${open ? ' intake-add-fab-btn--open' : ''}`}
          aria-label="Добавить товар"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <FiPlus size={26} className="intake-add-fab-icon" />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            className="intake-add-overlay"
            role="presentation"
            onClick={() => setOpen(false)}
          >
            <div
              className="intake-add-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="intake-add-sheet-title"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="intake-add-sheet-close"
                aria-label="Закрыть"
                onClick={() => setOpen(false)}
              >
                <FiX size={20} />
              </button>
              <h2 id="intake-add-sheet-title" className="intake-add-sheet-title">
                Добавить товар
              </h2>
              <p className="intake-add-sheet-sub">Выберите способ</p>
              <div className="intake-add-sheet-choices">
                {choices.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="intake-add-choice"
                      style={{ animationDelay: `${80 + i * 60}ms` }}
                      onClick={() => run(item.onClick)}
                    >
                      <span className="intake-add-choice-icon">
                        <Icon size={22} />
                      </span>
                      <span className="intake-add-choice-text">
                        <span className="intake-add-choice-title">{item.title}</span>
                        <span className="intake-add-choice-hint">{item.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
