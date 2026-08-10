import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FiMenu, FiMoon, FiSun } from 'react-icons/fi';
import { useAuth } from '../auth/AuthContext';
import { useMediaQuery, MOBILE_MAX_WIDTH_QUERY } from '../utils/useMediaQuery';

const titles = {
  '/dashboard': 'Главная',
  '/products': 'Склад',
  '/sales': 'Продажи',
  '/reserve': 'Резерв',
  '/orders': 'Заказы',
  '/history': 'История',
  '/revision': 'Ревизия',
  '/settings': 'Настройки',
};

function pageTitle(pathname) {
  if (pathname.startsWith('/intake')) return 'Накладные';
  return titles[pathname] || 'Склад';
}

const TopBar = ({ onMenuClick }) => {
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useMediaQuery(MOBILE_MAX_WIDTH_QUERY);
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
    <header className={`topbar ios-glass-panel topbar-shell${isMobile ? ' topbar-shell--mobile' : ''}`}>
      <div className="topbar-left">
        {!isMobile && (
          <button type="button" className="menu-toggle menu-toggle--icon" onClick={onMenuClick} aria-label="Открыть меню">
            <FiMenu size={22} strokeWidth={2.25} aria-hidden />
          </button>
        )}
        <div className="topbar-title-block">
          <div className="topbar-title">
            {pageTitle(location.pathname)}
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
