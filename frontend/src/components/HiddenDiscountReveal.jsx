import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Скидка скрыта от покупателя: показ при наведении на панель или долгом нажатии на «К оплате» (~0,8 с).
 * Как в мобильном приложении.
 */
export default function HiddenDiscountReveal({
  discountPanel,
  children,
  enabled = true,
}) {
  const [revealed, setRevealed] = useState(false);
  const [latched, setLatched] = useState(false);
  const hideTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    if (!enabled) return;
    clearHideTimer();
    setRevealed(true);
  }, [enabled, clearHideTimer]);

  const scheduleHide = useCallback(() => {
    if (!enabled || latched) return;
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => setRevealed(false), 2200);
  }, [enabled, latched, clearHideTimer]);

  const toggleLatch = useCallback(() => {
    if (!enabled) return;
    clearHideTimer();
    setLatched((prev) => {
      const next = !prev;
      setRevealed(next);
      return next;
    });
  }, [enabled, clearHideTimer]);

  useEffect(() => () => {
    clearHideTimer();
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  }, [clearHideTimer]);

  const onTotalPointerDown = () => {
    if (!enabled) return;
    longPressTimerRef.current = window.setTimeout(() => {
      reveal();
      setLatched(true);
    }, 800);
  };

  const onTotalPointerUp = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <div
      className="hidden-discount-wrap"
      onMouseEnter={reveal}
      onMouseLeave={scheduleHide}
    >
      {enabled && revealed && (
        <div className="hidden-discount-panel">{discountPanel}</div>
      )}
      {typeof children === 'function'
        ? children({
            discountVisible: revealed,
            onTotalPointerDown,
            onTotalPointerUp,
            toggleLatch,
          })
        : children}
    </div>
  );
}
