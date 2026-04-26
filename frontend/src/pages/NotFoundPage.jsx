import React from 'react';
import { Link } from 'react-router-dom';
import { FiCompass, FiHome } from 'react-icons/fi';

export default function NotFoundPage() {
  return (
    <div className="static-page-root">
      <div className="static-page-mesh" />
      <div className="static-page-orb static-page-orb--tl" />
      <div className="static-page-orb static-page-orb--br" />
      <div className="static-page-card">
        <div className="static-page-icon-wrap" aria-hidden>
          <FiCompass size={40} strokeWidth={1.4} />
        </div>
        <p className="static-page-kicker">404</p>
        <h1 className="static-page-title">Страница не найдена</h1>
        <p className="static-page-text">
          Адрес изменился или введён с ошибкой. Вернитесь в раздел с меню слева.
        </p>
        <Link to="/dashboard" className="static-page-link">
          <FiHome size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          На главную
        </Link>
      </div>
    </div>
  );
}
