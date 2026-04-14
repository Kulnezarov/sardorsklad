import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FiMenu, FiMoon, FiSun } from 'react-icons/fi';
import { useAuth } from '../auth/AuthContext';

const titles = {
  '/dashboard': 'Главная',
  '/products': 'Склад',
  '/sales': 'Продажи',
  '/reserve': 'Резерв',
  '/orders': 'Заказы',
  '/categories': 'Категории',
  '/history': 'История',
  '/revision': 'Ревизия',
  '/settings': 'Настройки',
};

const TopBar = ({ onMenuClick }) => {
  const location = useLocation();
  const { user } = useAuth();
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  );

  useEffect(() => {
    const saved = localStorage.getItem('skladpro-theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      setDark(true);
    } else {
      document.documentElement.removeAttribute('data-theme');
      setDark(false);
    }
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('skladpro-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('skladpro-theme', 'light');
    }
  };

  const initials = (user?.email || 'U')
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="topbar ios-glass-panel topbar-shell">
      <div className="topbar-left">
        <button type="button" className="menu-toggle menu-toggle--icon" onClick={onMenuClick} aria-label="Открыть меню">
          <FiMenu size={22} strokeWidth={2.25} aria-hidden />
        </button>
        <div className="topbar-title-block">
          <div className="topbar-title" style={{ fontSize: '20px', fontWeight: 700 }}>
            {titles[location.pathname] || 'Склад'}
          </div>
          <div className="topbar-subtitle topbar-subtitle-hideable" style={{ fontSize: '13px' }}>
            Синхронизация с API
          </div>
        </div>
      </div>

      <div className="user-info" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          className="topbar-theme-toggle"
          onClick={toggleTheme}
          title={dark ? 'Светлая тема' : 'Тёмная тема'}
          aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
        >
          <span className="topbar-theme-icon" aria-hidden>
            {dark ? <FiSun size={20} strokeWidth={2.25} /> : <FiMoon size={20} strokeWidth={2.25} />}
          </span>
        </button>
        <div className="topbar-avatar-wrap" title={user?.email || 'Профиль'}>
          <div className="topbar-avatar-ring">
            <div className="topbar-avatar-inner">
              <span className="topbar-avatar-initials">{initials}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
