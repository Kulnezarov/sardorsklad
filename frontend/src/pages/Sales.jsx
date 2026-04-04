import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiSearch, FiGrid, FiShoppingCart, FiX, FiPlus, FiMinus,
  FiEdit2, FiCheckCircle, FiTrash2, FiZap,
} from 'react-icons/fi';
import { saleApi, fetchAllProducts, productApi } from '../api/client';

/* ── helpers ── */
const num = (v) => { const n = parseFloat(String(v || 0).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

/** Сканеры часто шлют пробелы / перевод строки после кода */
const normalizeScanCode = (s) => String(s ?? '').replace(/[\s\r\n\t\u0000]+/g, '').trim();

/* ── POS component ── */
const Sales = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Products data
  const { data: products = [] } = useQuery({
    queryKey: ['products-pos'],
    queryFn: () => fetchAllProducts(),
    staleTime: 60000,
  });

  const CART_STORAGE_KEY = 'skladpro-cart-draft';

  const loadCartDraft = () => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch { return []; }
  };

  // Cart state: [{ product, quantity, unitPrice }]
  const [cart, setCart] = useState(loadCartDraft);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanFlash, setScanFlash] = useState(null); // 'ok' | 'err' | null
  const [scannedResult, setScannedResult] = useState(null); // { product, barcode, found }
  const [showSuccess, setShowSuccess] = useState(false);
  const [successAmount, setSuccessAmount] = useState(0);
  const [editingPrice, setEditingPrice] = useState(null); // cart item index

  const searchRef = useRef(null);
  const barcodeRef = useRef(null);
  const dropdownRef = useRef(null);

  // Persist cart draft to localStorage
  useEffect(() => {
    try {
      if (cart.length > 0) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      } else {
        localStorage.removeItem(CART_STORAGE_KEY);
      }
    } catch {}
  }, [cart]);

  // Search with debounce
  useEffect(() => {
    if (!searchInput.trim()) { setSearchResults([]); setShowDropdown(false); return; }
    const t = setTimeout(() => {
      const q = searchInput.toLowerCase();
      const results = products.filter((p) =>
        p.quantity > 0 && (
          p.name?.toLowerCase().includes(q) ||
          p.brand?.toLowerCase().includes(q) ||
          p.barcode?.includes(q) ||
          p.sku?.includes(q)
        )
      ).slice(0, 8);
      setSearchResults(results);
      setShowDropdown(results.length > 0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, products]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && !searchRef.current?.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addToCart = useCallback((product) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = updated[idx];
        const newQty = item.quantity + 1;
        if (newQty > product.quantity) { toast.error(`Нет столько: остаток ${product.quantity} шт`); return prev; }
        updated[idx] = { ...item, quantity: newQty };
        return updated;
      }
      if (product.quantity <= 0) { toast.error('Товара нет в наличии'); return prev; }
      return [...prev, { product, quantity: 1, unitPrice: num(product.sale_price) }];
    });
    setSearchInput('');
    setShowDropdown(false);
  }, []);

  const removeFromCart = (idx) => setCart((prev) => prev.filter((_, i) => i !== idx));
  const changeQty = (idx, delta) => {
    setCart((prev) => {
      const updated = [...prev];
      const item = updated[idx];
      const newQty = item.quantity + delta;
      if (newQty <= 0) return prev.filter((_, i) => i !== idx);
      if (newQty > item.product.quantity) { toast.error(`Максимум: ${item.product.quantity} шт`); return prev; }
      updated[idx] = { ...item, quantity: newQty };
      return updated;
    });
  };

  const updatePrice = (idx, price) => {
    setCart((prev) => { const updated = [...prev]; updated[idx] = { ...updated[idx], unitPrice: num(price) }; return updated; });
  };

  const total = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  // Barcode scan — show confirmation instead of immediately adding
  const handleBarcodeScan = async (barcode) => {
    const bc = normalizeScanCode(barcode);
    if (!bc) return;
    setBarcodeInput('');

    // Search locally first (нормализуем поля — пробелы в БД / с сканера)
    let found = products.find((p) => {
      const pb = normalizeScanCode(p.barcode);
      const ps = normalizeScanCode(p.sku);
      return (pb && pb === bc) || (ps && ps === bc);
    });

    // Fallback: API lookup
    if (!found) {
      try {
        const r = await productApi.getByBarcode(bc);
        if (r.data) found = r.data;
      } catch { /* not found */ }
    }

    if (found) {
      setScanFlash('ok');
      setTimeout(() => setScanFlash(null), 700);
      setScannedResult({ product: found, barcode: bc, found: true });
    } else {
      setScanFlash('err');
      setTimeout(() => setScanFlash(null), 700);
      setScannedResult({ product: null, barcode: bc, found: false });
    }
  };

  // Sale mutation
  const saleMutation = useMutation({
    mutationFn: () => {
      if (cart.length === 0) throw new Error('Корзина пуста');
      return saleApi.create({
        items: cart.map((i) => ({ product_id: i.product.id, quantity: i.quantity, unit_price: i.unitPrice })),
        payment_method: 'cash',
      });
    },
    onSuccess: () => {
      setSuccessAmount(total);
      setShowSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['products-pos'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      // Play cash sound
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(); osc.stop(ctx.currentTime + 0.3);
      } catch (_) {}
      setTimeout(() => { setShowSuccess(false); setCart([]); localStorage.removeItem(CART_STORAGE_KEY); }, 1500);
    },
    onError: (err) => { toast.error(err.message || 'Ошибка при продаже'); },
  });

  /* ─── RENDER ─── */
  return (
    <div className="page-ios sales-page" style={{ position: 'relative' }}>

      {/* ── Scan confirmation modal ── */}
      {scannedResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.48)', backdropFilter: 'blur(6px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 360, background: 'var(--surface)', borderRadius: 24, boxShadow: 'var(--shadow-xl)', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}>
            {scannedResult.found ? (
              <>
                <div style={{ padding: '26px 22px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Товар найден</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 4, lineHeight: 1.25 }}>{scannedResult.product.name}</div>
                  {scannedResult.product.brand && <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Марка: {scannedResult.product.brand}</div>}
                  {scannedResult.product.category && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Категория: {scannedResult.product.category}</div>}
                  {(scannedResult.product.barcode || scannedResult.product.sku) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 8, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                      {scannedResult.product.barcode && <span>ШК: {scannedResult.product.barcode}</span>}
                      {scannedResult.product.barcode && scannedResult.product.sku ? ' · ' : null}
                      {scannedResult.product.sku && <span>Арт.: {scannedResult.product.sku}</span>}
                    </div>
                  )}
                  {scannedResult.product.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 12, textAlign: 'left', lineHeight: 1.45, maxHeight: '4.35em', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {scannedResult.product.description}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <div style={{ padding: '10px 16px', borderRadius: 14, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>Цена</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{formatMoney(scannedResult.product.sale_price)} ₸</div>
                    </div>
                    <div style={{ padding: '10px 16px', borderRadius: 14, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>Остаток</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: scannedResult.product.quantity > 0 ? 'var(--success)' : 'var(--danger)' }}>{scannedResult.product.quantity} шт</div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '0 20px 22px', display: 'flex', gap: 10 }}>
                  <button type="button" onClick={() => setScannedResult(null)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Отменить</button>
                  <button
                    type="button"
                    disabled={scannedResult.product.quantity <= 0}
                    onClick={() => { addToCart(scannedResult.product); setScannedResult(null); }}
                    style={{ flex: 2, padding: '13px', borderRadius: 14, border: 'none', background: scannedResult.product.quantity > 0 ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : 'var(--bg-secondary)', color: scannedResult.product.quantity > 0 ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: 14, cursor: scannedResult.product.quantity > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <FiPlus size={16} /> Добавить в чек
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: '26px 22px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Товар не найден</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>Штрих-код:</div>
                  <div style={{ padding: '8px 14px', borderRadius: 12, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', fontFamily: 'ui-monospace,monospace', fontSize: 15, fontWeight: 700, color: 'var(--primary)', marginBottom: 16, wordBreak: 'break-all' }}>
                    {scannedResult.barcode}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>Добавить этот товар в каталог?</div>
                </div>
                <div style={{ padding: '0 20px 22px', display: 'flex', gap: 10 }}>
                  <button type="button" onClick={() => setScannedResult(null)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Отменить</button>
                  <button
                    type="button"
                    onClick={() => { setScannedResult(null); navigate('/products', { state: { openAdd: true, barcode: scannedResult.barcode } }); }}
                    style={{ flex: 2, padding: '13px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <FiPlus size={16} /> В каталог
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Success overlay */}
      {showSuccess && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16,185,129,0.92)', backdropFilter: 'blur(12px)', animation: 'sheetUp 0.2s ease-out' }}>
          <div style={{ textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: 64, marginBottom: 12, animation: 'popIn 0.25s ease-out' }}>✅</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em', marginBottom: 8 }}>Продано!</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.04em' }}>{formatMoney(successAmount)} ₸</div>
          </div>
        </div>
      )}

      {/* ── POS layout ── */}
      <div className="pos-layout" style={{ flex: 1, overflow: 'hidden', padding: '10px 14px', gap: 14 }}>

        {/* LEFT: search + scanner */}
        <div className="pos-left" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minHeight: 0 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h1 className="ios-mega-title">Продажи</h1>
          </div>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <FiSearch style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} size={17} />
              <input
                ref={searchRef}
                className="catalog-search-input"
                style={{ paddingLeft: 44, fontSize: 16 }}
                placeholder="Найти товар по названию, марке, штрих-коду…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              />
              {searchInput && <button type="button" onClick={() => { setSearchInput(''); setShowDropdown(false); }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><FiX size={16} /></button>}
            </div>

            {/* Dropdown results */}
            {showDropdown && (
              <div ref={dropdownRef} style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', zIndex: 50, overflow: 'hidden', backdropFilter: 'blur(20px)' }}>
                {searchResults.map((p) => (
                  <button key={p.id} type="button" onClick={() => addToCart(p)}
                    style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border-light)', textAlign: 'left', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--primary-light)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{p.brand ? `${p.brand} · ` : ''}Остаток: {p.quantity} шт</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--primary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatMoney(p.sale_price)} ₸</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scanner zone */}
          <div
            className={`pos-scanner-zone ${scanFlash === 'ok' ? 'pos-scanner-ok' : scanFlash === 'err' ? 'pos-scanner-err' : ''}`}
            style={{ flex: 1, minHeight: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 22, border: `2px dashed ${scanFlash === 'ok' ? 'var(--success)' : scanFlash === 'err' ? 'var(--danger)' : 'var(--border)'}`, background: scanFlash === 'ok' ? 'rgba(16,185,129,0.08)' : scanFlash === 'err' ? 'rgba(239,68,68,0.08)' : 'var(--ios-grouped-bg)', transition: 'all 0.2s', cursor: 'text', gap: 12, padding: 20 }}
            onClick={() => barcodeRef.current?.focus()}
          >
            <div style={{ fontSize: 36 }}>{scanFlash === 'ok' ? '✅' : scanFlash === 'err' ? '❌' : '📷'}</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center' }}>
              {scanFlash === 'ok' ? 'Штрих-код распознан' : scanFlash === 'err' ? 'Товар не найден' : 'Наведите сканер или найдите товар выше'}
            </div>
            {!scanFlash && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Сканер ведёт ввод здесь — отправьте Enter</div>}
            <input
              ref={barcodeRef}
              type="text"
              autoComplete="off"
              aria-label="Штрих-код сканера"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { handleBarcodeScan(barcodeInput); e.preventDefault(); } }}
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
            />
          </div>
        </div>

        {/* RIGHT: Cart */}
        <div className="pos-right" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>

          {/* Cart header */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}><FiShoppingCart size={18} /></div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.02em' }}>Чек · {cartCount} поз.</div>
              {cart.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{cart.length} {cart.length === 1 ? 'товар' : cart.length < 5 ? 'товара' : 'товаров'}</div>}
            </div>
          </div>

          {/* Cart items */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 160, color: 'var(--text-muted)', gap: 10, padding: 20 }}>
                <FiShoppingCart size={32} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center' }}>Найдите товар или<br />отсканируйте штрих-код</div>
              </div>
            ) : (
              <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cart.map((item, idx) => (
                  <div key={`${item.product.id}-${idx}`} style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product.name}</div>
                        {item.product.brand && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{item.product.brand}</div>}
                      </div>
                      <button type="button" onClick={() => removeFromCart(idx)} style={{ width: 26, height: 26, borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FiX size={13} /></button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      {/* Qty */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button type="button" onClick={() => changeQty(idx, -1)} style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}><FiMinus size={13} /></button>
                        <span style={{ width: 28, textAlign: 'center', fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{item.quantity}</span>
                        <button type="button" onClick={() => changeQty(idx, 1)} style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}><FiPlus size={13} /></button>
                      </div>
                      {/* Price */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {editingPrice === idx ? (
                          <input
                            autoFocus
                            type="number"
                            min="0"
                            value={item.unitPrice}
                            onChange={(e) => updatePrice(idx, e.target.value)}
                            onBlur={() => setEditingPrice(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingPrice(null)}
                            style={{ width: 80, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--primary)', background: 'var(--surface)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: 'var(--primary)' }}
                          />
                        ) : (
                          <button type="button" onClick={() => setEditingPrice(idx)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, padding: '4px 6px', borderRadius: 8 }}>
                            <FiEdit2 size={11} />
                            <span>{formatMoney(item.unitPrice)} ₸</span>
                          </button>
                        )}
                      </div>
                      {/* Line total */}
                      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap' }}>{formatMoney(item.unitPrice * item.quantity)} ₸</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cart footer */}
          <div style={{ borderTop: '2px solid var(--border)', padding: '14px 16px', background: 'var(--surface)' }}>
            {/* Total */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ИТОГО</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.04em' }}>{formatMoney(total)} ₸</span>
            </div>

            {/* Sell button */}
            <button
              type="button"
              disabled={cart.length === 0 || saleMutation.isPending}
              onClick={() => saleMutation.mutate()}
              style={{ width: '100%', height: 56, borderRadius: 18, border: 'none', background: cart.length === 0 ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #6366f1, #7c3aed)', color: cart.length === 0 ? 'var(--text-muted)' : '#fff', fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em', cursor: cart.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: cart.length === 0 ? 'none' : '0 10px 30px rgba(99,102,241,0.4)', transition: 'all 0.2s', marginBottom: 10 }}
            >
              <FiZap size={20} strokeWidth={2.5} />
              {saleMutation.isPending ? 'Продаём…' : 'ПРОДАТЬ'}
            </button>

            {cart.length > 0 && (
              <button type="button" onClick={() => { if (window.confirm('Очистить чек?')) { setCart([]); localStorage.removeItem(CART_STORAGE_KEY); } }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, padding: '6px', textAlign: 'center' }}>
                Очистить чек
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom dock */}
      <nav className="catalog-dock" aria-label="Навигация">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {cart.length > 0 ? <><div>В чеке: {cartCount} шт</div><div style={{ color: 'var(--primary)', marginTop: 3, fontWeight: 700 }}>{formatMoney(total)} ₸</div></> : <div>Чек пуст</div>}
        </div>
        <div className="catalog-dock-center">
          <button type="button" className="catalog-dock-nav" onClick={() => navigate('/products')}><FiGrid size={22} strokeWidth={2} /><span>Каталог</span></button>
          <button type="button" className="catalog-dock-nav catalog-dock-nav-active" onClick={() => navigate('/sales')}><FiShoppingCart size={22} strokeWidth={2} /><span>Продажа</span></button>
        </div>
        <div style={{ width: 100 }} />
      </nav>
    </div>
  );
};

export default Sales;
