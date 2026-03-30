import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiPackage, FiShoppingCart } from 'react-icons/fi';
import { productApi } from '../api/client';
import { LoadingSpinner } from '../components/ui';

const ProductFound = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [product, setProduct] = useState(location.state?.product ?? null);
  const [loading, setLoading] = useState(!location.state?.product);

  useEffect(() => {
    if (product) {
      setLoading(false);
      return;
    }
    const bc = new URLSearchParams(location.search).get('barcode');
    if (!bc) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await productApi.getByBarcode(bc.trim());
        if (!cancelled) setProduct(r.data);
      } catch {
        if (!cancelled) {
          toast.error('Товар не найден');
          navigate('/sales', { replace: true });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.search, location.state?.product, navigate, product]);

  if (loading) {
    return <LoadingSpinner message="Ищем товар…" />;
  }

  if (!product) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Нет данных о товаре</p>
        <Link to="/sales" className="btn-ios-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
          На продажи
        </Link>
      </div>
    );
  }

  const code = product.barcode || product.sku || '—';
  const inStock = (product.quantity || 0) > 0;

  return (
    <div className="catalog-page-bottom-pad" style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 100px' }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          border: 'none',
          background: 'none',
          color: 'var(--primary)',
          fontWeight: 600,
          fontSize: 16,
          cursor: 'pointer',
          marginBottom: 20,
          padding: 0,
        }}
      >
        <FiArrowLeft size={20} />
        Товар найден
      </button>

      <div className="ios-glass-panel" style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FiPackage size={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="ios-mega-title" style={{ fontSize: 24 }}>
              {product.name}
            </h1>
            <div style={{ marginTop: 10, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              <div>Марка: {product.brand || '—'}</div>
              <div>Кат.: {product.category || '—'}</div>
              <div>ID: {product.sku}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span>Штрих-код:</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--primary)', fontWeight: 600 }}>{code}</span>
              </div>
              {product.location_zone ? (
                <div style={{ marginTop: 4 }}>Место: {product.location_zone}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Цена продажи:</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success)', letterSpacing: '-0.03em' }}>
              ₸{Number(product.sale_price || 0).toLocaleString('ru-RU')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                display: 'inline-block',
                padding: '8px 14px',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 14,
                background: inStock ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                color: inStock ? '#15803d' : 'var(--danger)',
              }}
            >
              {inStock ? `В наличии: ${product.quantity} шт` : 'Нет в наличии'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              Закуп: ₸{Number(product.purchase_price || 0).toLocaleString('ru-RU')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 20 }}>
        <button
          type="button"
          className="topbar-theme-toggle"
          style={{
            padding: '16px',
            borderWidth: 2,
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
            fontWeight: 700,
            fontSize: 15,
          }}
          onClick={() => navigate(-1)}
        >
          Отменить
        </button>
        <button
          type="button"
          className="catalog-dock-add"
          style={{ justifyContent: 'center', width: '100%' }}
          onClick={() => {
            navigate('/sales', { state: { preselectProductId: product.id } });
          }}
        >
          <FiShoppingCart size={18} />
          Выбрать
        </button>
      </div>

      <nav className="catalog-dock" aria-label="Навигация" style={{ justifyContent: 'center' }}>
        <div className="catalog-dock-center" style={{ width: '100%', justifyContent: 'center' }}>
          <button type="button" className="catalog-dock-nav" onClick={() => navigate('/products')}>
            <FiPackage size={22} />
            <span>Каталог</span>
          </button>
          <button type="button" className="catalog-dock-nav catalog-dock-nav-active" onClick={() => navigate('/sales')}>
            <FiShoppingCart size={22} />
            <span>Продажа</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default ProductFound;
