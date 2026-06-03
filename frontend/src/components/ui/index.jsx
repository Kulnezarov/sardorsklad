import React, { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import {
  FiLoader, FiX, FiCheck, FiAlertCircle, FiInfo,
  FiChevronDown,
} from 'react-icons/fi';

const TabsContext = createContext(null);

// ============================================================================
// BUTTON COMPONENT
// ============================================================================
export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon = null,
  className = '',
  style,
  ...props
}) => {
  const variantStyles = {
    primary: { 
      background: 'var(--primary)', 
      color: '#fff', 
      border: 'none',
      hover: 'var(--primary-dark)'
    },
    secondary: { 
      background: 'var(--surface)', 
      color: 'var(--text)', 
      border: '1px solid var(--border)',
      hover: 'var(--surface-hover)'
    },
    danger: { 
      background: 'var(--danger)', 
      color: '#fff', 
      border: 'none',
      hover: '#b91c1c'
    },
    success: { 
      background: 'var(--success)', 
      color: '#fff', 
      border: 'none',
      hover: '#047857'
    },
    warning: { 
      background: 'var(--warning)', 
      color: '#fff', 
      border: 'none',
      hover: '#b45309'
    },
    ghost: { 
      background: 'transparent', 
      color: 'var(--primary)', 
      border: '1px solid transparent',
      hover: 'var(--primary-light)'
    },
  };

  const sizeStyles = {
    sm: { padding: '8px 12px', fontSize: '13px', gap: '6px' },
    md: { padding: '10px 16px', fontSize: '14px', gap: '8px' },
    lg: { padding: '12px 20px', fontSize: '15px', gap: '10px' },
  };

  const variant_config = variantStyles[variant];
  
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={className}
      style={{
        borderRadius: 'var(--radius)',
        fontWeight: 600,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        transition: 'var(--transition)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...variant_config,
        ...sizeStyles[size],
        ...style,
      }}
      {...props}
    >
      {loading ? <FiLoader className="animate-spin" size={16} /> : Icon && <Icon size={16} />}
      {children}
    </button>
  );
};

// ============================================================================
// BADGE COMPONENT
// ============================================================================
export const Badge = ({ children, variant = 'default', size = 'md', icon: Icon = null }) => {
  const variants = {
    default: { background: 'var(--bg-secondary)', color: 'var(--text)' },
    primary: { background: 'var(--primary-light)', color: 'var(--primary-dark)' },
    success: { background: '#d1fae5', color: '#065f46' },
    warning: { background: '#fef3c7', color: '#92400e' },
    danger: { background: '#fee2e2', color: '#991b1b' },
    info: { background: '#cffafe', color: '#164e63' },
  };

  const sizeStyles = {
    sm: { padding: '3px 8px', fontSize: '12px' },
    md: { padding: '5px 12px', fontSize: '13px' },
    lg: { padding: '8px 16px', fontSize: '14px' },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        borderRadius: '999px',
        fontWeight: 600,
        ...variants[variant],
        ...sizeStyles[size],
      }}
    >
      {Icon && <Icon size={14} />}
      {children}
    </span>
  );
};

// ============================================================================
// INPUT COMPONENT
// ============================================================================
export const Input = ({ 
  label, 
  error, 
  icon: Icon = null, 
  placeholder,
  style, 
  ...props 
}) => (
  <label style={{ display: 'block', width: '100%' }}>
    {label && (
      <span style={{ 
        display: 'block', 
        marginBottom: '8px', 
        fontSize: '13px', 
        fontWeight: 600, 
        color: 'var(--text)' 
      }}>
        {label}
      </span>
    )}
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {Icon && (
        <Icon 
          size={18} 
          style={{ 
            position: 'absolute', 
            left: '12px',
            color: 'var(--text-muted)',
            pointerEvents: 'none'
          }} 
        />
      )}
      <input
        placeholder={placeholder}
        style={{
          width: '100%',
          minHeight: '44px',
          padding: Icon ? '12px 14px 12px 42px' : '12px 14px',
          borderRadius: 'var(--radius-ios)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          background: 'var(--surface)',
          fontSize: '16px',
          color: 'var(--text)',
          transition: 'var(--transition)',
          ...style,
        }}
        {...props}
      />
    </div>
    {error && (
      <span style={{ 
        display: 'block', 
        marginTop: '6px', 
        color: 'var(--danger)', 
        fontSize: '12px' 
      }}>
        {error}
      </span>
    )}
  </label>
);

// ============================================================================
// SELECT COMPONENT
// ============================================================================
export const Select = ({ 
  label, 
  error, 
  options = [], 
  placeholder = 'Выберите...',
  icon: Icon = FiChevronDown,
  style, 
  ...props 
}) => (
  <label style={{ display: 'block', width: '100%' }}>
    {label && (
      <span style={{ 
        display: 'block', 
        marginBottom: '8px', 
        fontSize: '13px', 
        fontWeight: 600, 
        color: 'var(--text)' 
      }}>
        {label}
      </span>
    )}
    <div style={{ position: 'relative' }}>
      <select
        style={{
          width: '100%',
          minHeight: '44px',
          padding: '12px 14px',
          paddingRight: '36px',
          borderRadius: 'var(--radius-ios)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          background: 'var(--surface)',
          fontSize: '16px',
          color: 'var(--text)',
          cursor: 'pointer',
          transition: 'var(--transition)',
          appearance: 'none',
          ...style,
        }}
        {...props}
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Icon 
        size={18} 
        style={{ 
          position: 'absolute', 
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
          pointerEvents: 'none'
        }} 
      />
    </div>
    {error && (
      <span style={{ 
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: '6px', 
        color: 'var(--danger)', 
        fontSize: '12px' 
      }}>
        <FiAlertCircle size={14} />
        {error}
      </span>
    )}
  </label>
);

// ============================================================================
// TEXT AREA COMPONENT
// ============================================================================
export const TextArea = ({ 
  label, 
  error, 
  style, 
  ...props 
}) => (
  <label style={{ display: 'block', width: '100%' }}>
    {label && (
      <span style={{ 
        display: 'block', 
        marginBottom: '8px', 
        fontSize: '13px', 
        fontWeight: 600, 
        color: 'var(--text)' 
      }}>
        {label}
      </span>
    )}
    <textarea
      style={{
        width: '100%',
        padding: '12px 14px',
        borderRadius: 'var(--radius-ios)',
        border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
        background: 'var(--surface)',
        fontSize: '16px',
        color: 'var(--text)',
        fontFamily: 'inherit',
        resize: 'vertical',
        minHeight: '100px',
        transition: 'var(--transition)',
        ...style,
      }}
      {...props}
    />
    {error && (
      <span style={{ 
        display: 'block', 
        marginTop: '6px', 
        color: 'var(--danger)', 
        fontSize: '12px' 
      }}>
        {error}
      </span>
    )}
  </label>
);

// ============================================================================
// CARD COMPONENT
// ============================================================================
export const Card = ({ children, clickable = false, style, ...props }) => (
  <div
    style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)',
      padding: '20px',
      boxShadow: 'none',
      transition: 'var(--transition)',
      cursor: clickable ? 'pointer' : 'default',
      willChange: clickable ? 'transform' : undefined,
      ...style
    }}
    {...props}
  >
    {children}
  </div>
);

// ============================================================================
// LOADING SPINNER COMPONENT
// ============================================================================
export const LoadingSpinner = ({ message = 'Загрузка...' }) => (
  <div style={{ 
    padding: '40px 20px', 
    textAlign: 'center', 
    color: 'var(--text-muted)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px'
  }}>
    <FiLoader size={32} style={{ animation: 'spin 1s linear infinite' }} />
    <div>{message}</div>
  </div>
);

// ============================================================================
// TABLE COMPONENT
// ============================================================================
export const Table = ({ 
  columns = [], 
  data = [], 
  loading = false, 
  emptyMessage = 'Нет данных',
  emptyIcon: EmptyIcon = null,
  onRowClick = null,
}) => {
  if (loading) return <LoadingSpinner />;
  
  if (!data.length) {
    return (
      <div style={{
        padding: '40px 20px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px'
      }}>
        {EmptyIcon && <EmptyIcon size={32} />}
        <div>{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ 
        width: '100%', 
        borderCollapse: 'collapse' 
      }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr 
              key={row.id ?? index}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
              style={{
                borderBottom: '1px solid var(--border)',
                transition: 'var(--transition)',
                background: 'var(--surface)',
                cursor: onRowClick ? 'pointer' : undefined,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface)'}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  onClick={column.noRowClick ? (e) => e.stopPropagation() : undefined}
                  style={{
                    padding: '14px 16px',
                    verticalAlign: 'middle',
                    color: 'var(--text)',
                    fontSize: '14px'
                  }}
                >
                  {column.render ? column.render(row[column.key], row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================================
// MODAL COMPONENT
// ============================================================================
export const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  actions = null,
  size = 'md',
  icon: Icon = null
}) => {
  if (!isOpen) return null;
  const width =
    size === 'intake'
      ? 'min(720px, 100vw - 32px)'
      : size === 'xl'
        ? 'min(540px, 100vw - 32px)'
        : size === 'lg'
          ? '900px'
          : size === 'sm'
            ? '480px'
            : '640px';

  return createPortal(
    <div
      className="app-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(107, 114, 128, 0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '20px',
        zIndex: 1000,
        overflowY: 'auto',
        paddingTop: '60px',
      }}
      onClick={onClose}
    >
      <div
        className="app-modal-box"
        style={{
          width: '100%',
          maxWidth: width,
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'none',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {Icon && <Icon size={24} color='var(--primary)' />}
            <h2 style={{ 
              margin: 0, 
              fontSize: '18px', 
              fontWeight: 700,
              color: 'var(--text)'
            }}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              fontSize: '20px', 
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '4px',
              transition: 'var(--transition)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="app-modal-body" style={{ padding: '24px' }}>
          {children}
        </div>

        {/* Actions */}
        {actions && (
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end'
          }}>
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// ============================================================================
// ALERT COMPONENT
// ============================================================================
export const Alert = ({ 
  type = 'info', 
  title, 
  message,
  onClose = null,
  icon: Icon = null
}) => {
  const typeConfig = {
    info: { bg: '#eff6ff', border: '#93c5fd', color: '#1e40af', icon: FiInfo },
    success: { bg: '#f0fdf4', border: '#86efac', color: '#15803d', icon: FiCheck },
    warning: { bg: '#fffbeb', border: '#fcd34d', color: '#b45309', icon: FiAlertCircle },
    danger: { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b', icon: FiAlertCircle },
  };

  const config = typeConfig[type];
  const TheIcon = Icon || config.icon;

  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 'var(--radius)',
      border: `1px solid ${config.border}`,
      background: config.bg,
      color: config.color,
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-start'
    }}>
      <TheIcon size={18} style={{ marginTop: '2px', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: '13px' }}>
          {message}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            padding: '4px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <FiX size={16} />
        </button>
      )}
    </div>
  );
};

// ============================================================================
// TABS COMPONENT
// ============================================================================
export const Tabs = ({ value, defaultValue, onValueChange, children }) => {
  const active = value ?? defaultValue;
  return (
    <TabsContext.Provider value={{ value: active, onValueChange }}>
      {children}
    </TabsContext.Provider>
  );
};

export const TabsList = ({ children }) => (
  <div
    style={{
      display: 'flex',
      gap: '8px',
      borderBottom: '1px solid var(--border)',
      marginBottom: '20px',
      overflow: 'auto'
    }}
  >
    {children}
  </div>
);

export const TabsTrigger = ({ value, children, icon: Icon = null }) => {
  const context = useContext(TabsContext);
  const isActive = context?.value === value;

  return (
    <button
      type="button"
      onClick={() => context?.onValueChange?.(value)}
      style={{
        padding: '12px 16px',
        border: 'none',
        borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '14px',
        color: isActive ? 'var(--primary)' : 'var(--text-muted)',
        transition: 'var(--transition)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        whiteSpace: 'nowrap'
      }}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
};

export const TabsContent = ({ value, children }) => {
  const context = useContext(TabsContext);
  if (context?.value !== value) return null;
  return <>{children}</>;
};

// ============================================================================
// STATS CARD COMPONENT
// ============================================================================
export const StatsCard = ({ 
  label, 
  value, 
  change = null, 
  icon: Icon = null,
  trend = 'up',
  color = 'primary'
}) => {
  const colorMap = {
    primary: { bg: '#eff6ff', color: 'var(--primary)' },
    success: { bg: '#f0fdf4', color: 'var(--success)' },
    warning: { bg: '#fffbeb', color: 'var(--warning)' },
    danger: { bg: '#fef2f2', color: 'var(--danger)' },
  };

  const colors = colorMap[color];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px' }}>
            {label}
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text)' }}>
            {value}
          </div>
          {change && (
            <div style={{ 
              fontSize: '12px', 
              marginTop: '8px',
              color: trend === 'up' ? 'var(--success)' : 'var(--danger)'
            }}>
              {trend === 'up' ? '↑' : '↓'} {change}
            </div>
          )}
        </div>
        {Icon && (
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius)',
            background: colors.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.color
          }}>
            <Icon size={24} />
          </div>
        )}
      </div>
    </Card>
  );
};

// ============================================================================
// ANIMATIONS
// ============================================================================
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .animate-spin {
    animation: spin 1s linear infinite;
  }
`;
document.head.appendChild(style);
