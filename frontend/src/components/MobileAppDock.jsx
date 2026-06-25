import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FiHome,
  FiPackage,
  FiShoppingCart,
  FiFileText,
  FiMoreHorizontal,
} from 'react-icons/fi';
import { useMediaQuery, MOBILE_MAX_WIDTH_QUERY } from '../utils/useMediaQuery';
import MobileMoreSheet from './MobileMoreSheet';

const DOCK_ITEMS = [
  { path: '/dashboard', label: 'Главная', Icon: FiHome, match: (p) => p === '/dashboard' },
  { path: '/products', label: 'Склад', Icon: FiPackage, match: (p) => p === '/products' || p.startsWith('/categories') },
  { path: '/sales', label: 'Продажа', Icon: FiShoppingCart, match: (p) => p === '/sales' || p.startsWith('/sales/') },
  { path: '/intake', label: 'Накладные', Icon: FiFileText, match: (p) => p.startsWith('/intake') },
];

const MORE_PATHS = new Set(['/reserve', '/orders', '/history', '/settings']);

export default function MobileAppDock() {
  const isMobile = useMediaQuery(MOBILE_MAX_WIDTH_QUERY);
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const pathname = location.pathname;
  const moreActive = useMemo(() => MORE_PATHS.has(pathname), [pathname]);

  if (!isMobile) return null;

  return (
    <>
      <nav className="mobile-app-dock" aria-label="Основная навигация">
        {DOCK_ITEMS.map(({ path, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <button
              key={path}
              type="button"
              className={`mobile-app-dock__tab${active ? ' mobile-app-dock__tab--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(path)}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`mobile-app-dock__tab${moreActive ? ' mobile-app-dock__tab--active' : ''}`}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(true)}
        >
          <FiMoreHorizontal size={22} strokeWidth={moreActive ? 2.4 : 2} aria-hidden />
          <span>Ещё</span>
        </button>
      </nav>
      <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
