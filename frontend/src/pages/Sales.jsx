import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiSearch, FiGrid, FiShoppingCart, FiX, FiPlus, FiMinus,
  FiZap, FiCamera,
} from 'react-icons/fi';
import { saleApi, debtApi, fetchAllProducts, productApi, getApiErrorMessage } from '../api/client';
import CameraBarcodeScanner from '../components/CameraBarcodeScanner';
import DebtCustomerPickModal from '../components/DebtCustomerPickModal';
import DebtReceiptModal from '../components/DebtReceiptModal';

/* ── helpers ── */
const num = (v) => { const n = parseFloat(String(v || 0).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

/** Сканеры часто шлют пробелы / перевод строки после кода */
const normalizeScanCode = (s) => String(s ?? '').replaceAll('\u0000', '').replace(/[\s\r\n\t]+/g, '').trim();

/* ── POS component ── */
const Sales = ({ mode = 'cash', onOpenClients }) => {
  const isDebt = mode === 'debt';
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
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successAmount, setSuccessAmount] = useState(0);
  /** Индекс позиции чека для карточки «подробнее» (марка, описание…) */
  const [cartDetailIdx, setCartDetailIdx] = useState(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showDebtPick, setShowDebtPick] = useState(false);
  const [debtReceipt, setDebtReceipt] = useState(null);
  const [debtCustomer, setDebtCustomer] = useState(null);

  const searchRef = useRef(null);
  const barcodeRef = useRef(null);
  const dropdownRef = useRef(null);
  const scanBufferRef = useRef('');
  const scanTimerRef = useRef(null);

  // Persist cart draft to localStorage
  useEffect(() => {
    try {
      if (cart.length > 0) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      } else {
        localStorage.removeItem(CART_STORAGE_KEY);
      }
    } catch {
      /* private mode / quota */
    }
  }, [cart]);

  useEffect(() => {
    if (cartDetailIdx != null && cartDetailIdx >= cart.length) setCartDetailIdx(null);
  }, [cart.length, cartDetailIdx]);

  // Search with debounce
  useEffect(() => {
    if (!searchInput.trim()) { setSearchResults([]); setShowDropdown(false); return; }
    const t = setTimeout(() => {
      const q = searchInput.toLowerCase();
      const results = products.filter((p) =>
        p.quantity > 0 && (
          p.name?.toLowerCase().includes(q) ||
          p.brand?.toLowerCase().includes(q) ||
          p.model?.toLowerCase().includes(q) ||
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

  const total = useMemo(() => cart.reduce((s, i) => s + num(i.product.sale_price) * i.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  // Barcode scan — show confirmation instead of immediately adding
  const handleBarcodeScan = useCallback(async (barcode) => {
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
        const r = await productApi.getByBarcode(bc, { allow404: true });
        if (r.status === 200 && r.data) found = r.data;
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
  }, [products]);

  useEffect(() => {
    const isEditableTarget = (target) => {
      const tag = target?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
    };

    const clearBufferSoon = () => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = window.setTimeout(() => {
        scanBufferRef.current = '';
      }, 80);
    };

    const onKeyDown = (e) => {
      if (scannedResult || showSuccess) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === 'Enter') {
        const code = scanBufferRef.current;
        scanBufferRef.current = '';
        if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
        if (normalizeScanCode(code).length >= 4) {
          e.preventDefault();
          handleBarcodeScan(code);
        }
        return;
      }

      if (e.key.length === 1) {
        scanBufferRef.current += e.key;
        if (scanBufferRef.current.length > 80) scanBufferRef.current = scanBufferRef.current.slice(-80);
        clearBufferSoon();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    };
  }, [handleBarcodeScan, scannedResult, showSuccess]);

  // Sale mutation
  const saleMutation = useMutation({
    mutationFn: () => {
      if (cart.length === 0) throw new Error('Корзина пуста');
      return saleApi.create({
        items: cart.map((i) => ({ product_id: i.product.id, quantity: i.quantity, unit_price: num(i.product.sale_price) })),
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
      } catch {
        /* AudioContext / автозапуск */
      }
      setTimeout(() => { setShowSuccess(false); setCart([]); localStorage.removeItem(CART_STORAGE_KEY); }, 1500);
    },
    onError: (err) => { toast.error(getApiErrorMessage(err, 'Ошибка при продаже')); },
  });

  const debtSaleMutation = useMutation({
    mutationFn: (customer) => {
      if (cart.length === 0) throw new Error('Корзина пуста');
      const body = {
        items: cart.map((i) => ({
          product_id: i.product.id,
          quantity: i.quantity,
          unit_price: num(i.product.sale_price),
        })),
        customer_id: customer.id,
      };
      return debtApi.createSale(body);
    },
    onSuccess: (res) => {
      setDebtReceipt(res.data);
      setDebtCustomer(null);
      setCart([]);
      localStorage.removeItem(CART_STORAGE_KEY);
      queryClient.invalidateQueries({ queryKey: ['products-pos'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['debt-customers'] });
      toast.success('Продажа в долг оформлена');
    },
    onError: (err) => { toast.error(getApiErrorMessage(err, 'Ошибка продажи в долг')); },
  });

  /* ─── RENDER ─── */
  return (
    <div className="page-ios sales-page sales-page-with-dock" style={{ position: 'relative' }}>

      {/* ── Scan confirmation modal ── */}
      {scannedResult && (
        <div style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 360, background: 'var(--surface)', borderRadius: 24, border: '1px solid var(--border)', boxShadow: 'none', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}>
            {scannedResult.found ? (
              <>
                <div style={{ padding: '26px 22px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Товар найден</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 4, lineHeight: 1.25 }}>{scannedResult.product.name}</div>
                  {scannedResult.product.brand && <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Марка: {scannedResult.product.brand}</div>}
                  {scannedResult.product.model && <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Модель: {scannedResult.product.model}</div>}
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

      {/* Карточка товара в чеке: марка и доп. сведения */}
      {cartDetailIdx != null && cart[cartDetailIdx] && (() => {
        const row = cart[cartDetailIdx];
        const p = row.product;
        const loc = [p.location_zone, p.location_row, p.location_shelf, p.location_position].filter(Boolean).join(' · ');
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-line-detail-title"
            style={{ position: 'fixed', inset: 0, background: 'rgba(55, 65, 81, 0.45)', zIndex: 620, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setCartDetailIdx(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--border)', boxShadow: 'none', maxHeight: '85vh', overflowY: 'auto' }}
            >
              <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div id="cart-line-detail-title" style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', lineHeight: 1.3 }}>{p.name}</div>
                  {p.brand && <div style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 700, marginTop: 6 }}>Марка: {p.brand}</div>}
                  {p.model && <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4 }}>Модель: {p.model}</div>}
                </div>
                <button type="button" onClick={() => setCartDetailIdx(null)} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--ios-grouped-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} aria-label="Закрыть"><FiX size={18} /></button>
              </div>
              <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                {p.category && (
                  <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Категория: </span>{p.category}</div>
                )}
                {p.model && (
                  <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Модель: </span>{p.model}</div>
                )}
                {(p.sku || p.barcode) && (
                  <div style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', lineHeight: 1.45 }}>
                    {p.sku && <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Артикул: </span>{p.sku}</div>}
                    {p.barcode && <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Штрих-код: </span>{p.barcode}</div>}
                  </div>
                )}
                {p.supplier && (
                  <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Поставщик: </span>{p.supplier}</div>
                )}
                {loc && (
                  <div><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Место на складе: </span>{loc}</div>
                )}
                {p.description && (
                  <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {p.description}
                  </div>
                )}
                <div style={{ paddingTop: 4, fontWeight: 700, color: 'var(--text)' }}>
                  Цена в чеке: {formatMoney(num(p.sale_price))} ₸ × {row.quantity} шт = {formatMoney(num(p.sale_price) * row.quantity)} ₸
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Success overlay */}
      {showSuccess && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#10b981', animation: 'sheetUp 0.2s ease-out' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 className="ios-mega-title" style={{ margin: 0 }}>
                {isDebt ? 'В долг' : 'Продажи'}
              </h1>
              {isDebt && (
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', maxWidth: 420 }}>
                  Сканируйте товары как при обычной продаже, выберите клиента и оформите чек.
                </p>
              )}
            </div>
            {isDebt && onOpenClients && (
              <button
                type="button"
                onClick={onOpenClients}
                style={{
                  padding: '8px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Клиенты и история
              </button>
            )}
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
              <div ref={dropdownRef} style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, boxShadow: 'none', zIndex: 50, overflow: 'hidden' }}>
                {searchResults.map((p) => (
                  <button key={p.id} type="button" onClick={() => addToCart(p)}
                    style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border-light)', textAlign: 'left', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--primary-light)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{[p.brand, p.model].filter(Boolean).join(' · ')}{p.brand || p.model ? ' · ' : ''}Остаток: {p.quantity} шт</div>
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
            style={{ flex: 1, minHeight: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 22, border: `2px dashed ${scanFlash === 'ok' ? 'var(--success)' : scanFlash === 'err' ? 'var(--danger)' : 'var(--border)'}`, background: scanFlash === 'ok' ? '#ecfdf5' : scanFlash === 'err' ? '#fef2f2' : 'var(--ios-grouped-bg)', transition: 'border-color 0.2s, background-color 0.2s', cursor: 'text', gap: 12, padding: 20 }}
            onClick={() => barcodeRef.current?.focus()}
          >
            <div style={{ fontSize: 36 }}>{scanFlash === 'ok' ? '✅' : scanFlash === 'err' ? '❌' : '📷'}</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center' }}>
              {scanFlash === 'ok' ? 'Штрих-код распознан' : scanFlash === 'err' ? 'Товар не найден' : 'Наведите сканер или найдите товар выше'}
            </div>
            {!scanFlash && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Сканер ведёт ввод здесь — отправьте Enter</div>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCameraScanner(true); }}
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 12, padding: '8px 10px', fontWeight: 600, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FiCamera size={14} /> Камера (телефон)
            </button>
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
        <div className="pos-right" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', background: 'var(--surface)', borderRadius: 22, border: '1px solid var(--border)', boxShadow: 'none' }}>

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
                {cart.map((item, idx) => {
                  const lineUnit = num(item.product.sale_price);
                  return (
                    <div
                      key={`${item.product.id}-${idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setCartDetailIdx(idx)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCartDetailIdx(idx); } }}
                      style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border-light)', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product.name}</div>
                          {item.product.brand && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{item.product.brand}</div>}
                          {item.product.model && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>Модель: {item.product.model}</div>}
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>Нажмите для подробностей</div>
                        </div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeFromCart(idx); }} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid #fecaca', background: '#fee2e2', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FiX size={13} /></button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => changeQty(idx, -1)} style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}><FiMinus size={13} /></button>
                          <span style={{ width: 28, textAlign: 'center', fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{item.quantity}</span>
                          <button type="button" onClick={() => changeQty(idx, 1)} style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}><FiPlus size={13} /></button>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatMoney(lineUnit)} ₸ / шт</div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap' }}>{formatMoney(lineUnit * item.quantity)} ₸</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart footer */}
          <div style={{ borderTop: '2px solid var(--border)', padding: '14px 16px', background: 'var(--surface)' }}>
            {isDebt && (
              <button
                type="button"
                onClick={() => setShowDebtPick(true)}
                style={{
                  width: '100%',
                  marginBottom: 12,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: debtCustomer ? '2px solid #d97706' : '1px dashed var(--border)',
                  background: debtCustomer ? '#fff7ed' : 'var(--ios-grouped-bg)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Клиент
                </div>
                {debtCustomer ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{debtCustomer.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{debtCustomer.phone}</div>
                  </>
                ) : (
                  <div style={{ fontWeight: 700, color: '#b45309' }}>Выберите клиента →</div>
                )}
              </button>
            )}
            {/* Total */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ИТОГО</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.04em' }}>{formatMoney(total)} ₸</span>
            </div>

            {/* Sell button */}
            <button
              type="button"
              disabled={cart.length === 0 || saleMutation.isPending || debtSaleMutation.isPending}
              onClick={() => {
                if (isDebt) {
                  if (debtCustomer) debtSaleMutation.mutate(debtCustomer);
                  else setShowDebtPick(true);
                } else {
                  setShowPayModal(true);
                }
              }}
              style={{
                width: '100%',
                height: 56,
                borderRadius: 18,
                border: cart.length === 0 ? '1px solid var(--border)' : isDebt ? '1px solid #d97706' : '1px solid #4f46e5',
                background: cart.length === 0 ? 'var(--bg-secondary)' : isDebt ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                color: cart.length === 0 ? 'var(--text-muted)' : '#fff',
                fontWeight: 800,
                fontSize: 17,
                letterSpacing: '-0.02em',
                cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <FiZap size={20} strokeWidth={2.5} />
              {saleMutation.isPending || debtSaleMutation.isPending ? 'Оформляем…' : isDebt ? 'В ДОЛГ' : 'ПРОДАТЬ'}
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
      <CameraBarcodeScanner
        isOpen={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onDetected={(code) => handleBarcodeScan(code)}
      />

      {showPayModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowPayModal(false)}
          role="presentation"
        >
          <div
            style={{ width: '100%', maxWidth: 360, background: 'var(--surface)', borderRadius: 24, padding: '22px 20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>Способ оплаты</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', textAlign: 'center', marginBottom: 16 }}>{formatMoney(total)} ₸</div>
            <button
              type="button"
              onClick={() => { setShowPayModal(false); saleMutation.mutate(); }}
              style={{ width: '100%', padding: 14, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--ios-grouped-bg)', fontWeight: 700, marginBottom: 8, cursor: 'pointer' }}
            >
              Наличные / сразу
            </button>
            {!isDebt && (
              <button
                type="button"
                onClick={() => { setShowPayModal(false); setShowDebtPick(true); }}
                style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                В долг
              </button>
            )}
          </div>
        </div>
      )}

      <DebtCustomerPickModal
        isOpen={showDebtPick}
        onClose={() => setShowDebtPick(false)}
        onSelect={(c) => {
          if (isDebt) {
            setDebtCustomer(c);
            setShowDebtPick(false);
          } else {
            debtSaleMutation.mutate(c);
          }
        }}
      />
      <DebtReceiptModal sale={debtReceipt} onClose={() => setDebtReceipt(null)} />
    </div>
  );
};

export default Sales;
