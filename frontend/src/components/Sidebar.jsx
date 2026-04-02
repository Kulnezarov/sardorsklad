import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FiHome,
  FiPackage,
  FiShoppingCart,
  FiClock,
  FiMessageCircle,
  FiSettings,
} from 'react-icons/fi';

const Sidebar = ({ isOpen, onClose }) => {
  const location = useLocation();

  const navItems = [
    { path: '/dashboard', label: 'Главная', Icon: FiHome },
    { path: '/products', label: 'Склад', Icon: FiPackage },
    { path: '/reserve', label: 'Резерв', Icon: FiShoppingCart },
    { path: '/history', label: 'История', Icon: FiClock },
    { path: '/astra', label: 'ASTRA', Icon: FiMessageCircle },
    { path: '/settings', label: 'Настройки', Icon: FiSettings },
  ];

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar drawer ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-icon" aria-hidden>
              <img src="/skladpro-mark.svg" alt="" width={40} height={40} className="sidebar-brand-img" />
            </div>
            <div>
              <div className="sidebar-kicker">Система</div>
              <div className="sidebar-title">Склад</div>
            </div>
          </div>
          <div className="sidebar-caption">Учёт запчастей и продаж</div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(({ path, label, Icon }) => (
            <Link
              key={path}
              to={path}
              className={`nav-item ${location.pathname === path ? 'active' : ''}`}
              onClick={onClose}
            >
              <span className="nav-icon">
                <Icon size={17} strokeWidth={2.2} aria-hidden />
              </span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
