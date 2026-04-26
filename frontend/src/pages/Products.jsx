import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus, FiEdit2, FiTrash2, FiSearch, FiAlertTriangle,
  FiImage, FiGrid, FiShoppingCart, FiLock, FiUnlock, FiRefreshCw, FiMaximize2,
  FiTag, FiUpload, FiDownload, FiX, FiLoader, FiClock, FiPackage,
} from 'react-icons/fi';
import { Button, Modal, Input, TextArea, LoadingSpinner, Alert } from '../components/ui';
import { productApi, resolveUploadedAssetUrl, compatibilityApi, getApiErrorMessage } from '../api/client';
import { importExcelStream } from '../api/importExcelStream';
import { settingsApi } from '../api/settings';
import { generateEAN13 } from '../utils/barcodeGen';
import LabelPrint from '../components/LabelPrint';
import { QRCodeSVG } from 'qrcode.react';
import JsBarcode from 'jsbarcode';

/* ── helpers ── */
function formatImportError(err) {
  if (!err || err.code === 'ERR_CANCELED') return '';
  const status = err.response?.status;
  const data = err.response?.data;
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((e) => (typeof e === 'object' ? e.msg || JSON.stringify(e) : String(e))).join('; ');
  if (err.message === 'Network Error') return 'Нет связи с сервером.';
  if (status === 413) return 'Файл слишком большой.';
  return getApiErrorMessage(err, status ? `Ошибка сервера (${status})` : 'Неизвестная ошибка импорта');
}
function shouldFallbackImport(err) {
  const status = err?.response?.status;
  return status === 404 || status === 405 || status === 501;
}

/** Как в POS: убираем хвосты после сканера */
function normalizeScanCode(s) {
  return String(s ?? '')
    .replaceAll('\u0000', '')
    .replace(/[\s\r\n\t]+/g, '')
    .trim();
}

function productMatchesScan(p, code) {
  const c = normalizeScanCode(code);
  if (!c) return false;
  const pb = normalizeScanCode(p.barcode);
  const ps = normalizeScanCode(p.sku);
  return (pb && pb === c) || (ps && ps === c);
}

/**
 * Ручной ввод штрих-кода: те же символы, что и у сканера (0–9, A–Z, a–z, -).
 * Длина до 50 (как в БД). Автогенерация через generateEAN13 — только цифры.
 */
function sanitizeBarcodeFieldInput(raw) {
  const s = String(raw ?? '').replaceAll('\u0000', '').replace(/[\s\r\n\t]+/g, '');
  let out = '';
  for (let i = 0; i < s.length && out.length < 50; i += 1) {
    const c = s[i];
    if (/[0-9A-Za-z-]/.test(c)) out += c;
  }
  return out;
}

const CAT_COLORS = [
  { bg: '#e8e8fc', color: '#4338ca' },
  { bg: '#d1fae5', color: '#047857' },
  { bg: '#fef3c7', color: '#b45309' },
  { bg: '#fee2e2', color: '#b91c1c' },
  { bg: '#cffafe', color: '#0e7490' },
  { bg: '#f3e8ff', color: '#7e22ce' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#dbeafe', color: '#1d4ed8' },
];
function getCatColor(cat) {
  if (!cat) return CAT_COLORS[0];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) & 0xfffff;
  return CAT_COLORS[h % CAT_COLORS.length];
}

const emptyForm = () => ({
  id: null, name: '', sku: '', barcode: '', brand: '', model: '', category: '',
  purchase_price: 0, sale_price: 0, cny_price: '', delivery_cost_kzt: '', delivery_weight_kg: '',
  quantity: 0, min_quantity: 0, description: '', supplier: '', storage_location: '',
  image_url: '',
  compatibility_vehicle_model_ids: [],
  compatibility_engine_family_ids: [],
});

const num = (v) => { if (v === '' || v == null) return 0; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const optionalNum = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

const roundMoneyKzt = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const roundKgVal = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

function formatSideDeliveryKg(product, ratePerKg) {
  if (product?.delivery_weight_kg != null && Number(product.delivery_weight_kg) > 0) {
    return `${Number(product.delivery_weight_kg)} кг`;
  }
  const d = optionalNum(product?.delivery_cost_kzt);
  if (d != null && d > 0 && ratePerKg > 0) {
    const kg = roundKgVal(d / ratePerKg);
    return kg != null ? `${kg} кг` : '—';
  }
  return '—';
}

/** Единая логика закупа в ₸: сначала поле «Закуп (₸)», иначе из ¥×курс+доставка (как при сохранении). */
function effectivePurchaseTenge(formData, cnyRate = 65) {
  const cny = optionalNum(formData.cny_price);
  const del = optionalNum(formData.delivery_cost_kzt) || 0;
  let purchase = num(formData.purchase_price);
  if (purchase <= 0 && cny != null && cny > 0) purchase = Number(cny) * Number(cnyRate) + del;
  return purchase;
}

function buildPayload(formData, cnyRate = 65) {
  const skuTrim = formData.sku?.trim();
  const cny = optionalNum(formData.cny_price);
  const purchase = effectivePurchaseTenge(formData, cnyRate);
  const efs = formData.compatibility_engine_family_ids || [];
  const vms = formData.compatibility_vehicle_model_ids || [];
  return {
    id: formData.id ?? null,
    name: formData.name.trim(),
    sku: skuTrim || undefined,
    barcode: formData.barcode?.trim() || null,
    brand: formData.brand?.trim() || null,
    model: formData.model?.trim() || null,
    category: formData.category?.trim() || null,
    description: formData.description?.trim() || null,
    image_url: (formData.image_url || '').split('?')[0].trim() || null,
    supplier: formData.supplier?.trim() || null,
    location_zone: formData.storage_location?.trim() || null,
    purchase_price: purchase,
    sale_price: num(formData.sale_price),
    cny_price: cny,
    delivery_cost_kzt: optionalNum(formData.delivery_cost_kzt),
    delivery_weight_kg: optionalNum(formData.delivery_weight_kg),
    quantity: parseInt(formData.quantity, 10) || 0,
    min_quantity: parseInt(formData.min_quantity, 10) || 0,
    ...(formData.id
      ? { compatibility_engine_family_ids: efs, compatibility_vehicle_model_ids: vms }
      : {
          ...(efs.length ? { compatibility_engine_family_ids: efs } : {}),
          ...(vms.length ? { compatibility_vehicle_model_ids: vms } : {}),
        }),
  };
}

function genMathProblem() {
  const a = Math.floor(Math.random() * 20) + 5;
  const b = Math.floor(Math.random() * 20) + 5;
  return { problem: `${a} + ${b}`, answer: String(a + b) };
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const PRODUCTS_PAGE_SIZE = 30;
/** Фиксированная высота строки каталога для виртуального скролла (px) */
const CATALOG_ROW_HEIGHT = 52;
const CATALOG_OVERSCAN = 12;
function isStale(p) {
  if (!p.quantity || p.quantity <= 0) return false;
  const now = Date.now();
  const stockDate = p.received_at ? new Date(p.received_at).getTime()
    : p.created_at ? new Date(p.created_at).getTime()
    : null;
  if (!stockDate) return false;
  return now - stockDate > STALE_MS;
}

/* ── component ── */
const Products = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showStale, setShowStale] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [barcodeLocked, setBarcodeLocked] = useState(false);
  const [showQrPanel, setShowQrPanel] = useState(false);

  const [sideProduct, setSideProduct] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);

  const [showPrint, setShowPrint] = useState(false);
  const [printProduct, setPrintProduct] = useState(null);
  const [printType, setPrintType] = useState('barcode');
  const [showPrintSuggest, setShowPrintSuggest] = useState(false);
  const [savedProduct, setSavedProduct] = useState(null);

  const [imageUploading, setImageUploading] = useState(false);
  /** 0–100 во время upload; null когда не качаем */
  const [imageUploadPct, setImageUploadPct] = useState(null);
  const [imagePreviewBust, setImagePreviewBust] = useState(0);
  /** Мгновенное превью выбранного файла до ответа сервера */
  const [imageBlobUrl, setImageBlobUrl] = useState('');

  const [importReport, setImportReport] = useState(null);
  const [importOverlay, setImportOverlay] = useState(null);
  const [importError, setImportError] = useState('');

  const [scanNotFound, setScanNotFound] = useState(null); // scanned barcode string when not found
  const [showSuggestions, setShowSuggestions] = useState(false);

  const importAbortRef = useRef(null);
  const searchWrapRef = useRef(null);
  const importFileRef = useRef(null);
  const barcodeCanvasRef = useRef(null);
  const formRef = useRef(formData);
  /** Пользователь вручную правит поле «Совместимость» — не перезаписывать при выборе кода */
  const compatibilityTextTouchedRef = useRef(false);
  const productsRef = useRef([]);
  const scanBufRef = useRef('');
  const scanLastRef = useRef(0);
  const tableScrollRef = useRef(null);
  const queryClient = useQueryClient();

  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportH, setTableViewportH] = useState(480);

  useEffect(() => { formRef.current = formData; }, [formData]);

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: settingsRow } = useQuery({
    queryKey: ['settings-row'],
    queryFn: async () => { try { const r = await settingsApi.getSettings(); return r.data; } catch { return { cny_rate: 65, delivery_kzt_per_kg: 800 }; } },
    staleTime: 120000,
  });
  const cnyRate = Number(settingsRow?.cny_rate) || 65;
  const deliveryKztPerKg = Number(settingsRow?.delivery_kzt_per_kg) || 800;

  const { data: compatEngineFamilies = [] } = useQuery({
    queryKey: ['compatibility', 'engine-families'],
    queryFn: () => compatibilityApi.engineFamilies().then((r) => r.data),
    staleTime: 60000,
  });
  const { data: compatVehicleModels = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-models'],
    queryFn: () => compatibilityApi.vehicleModels().then((r) => r.data),
    staleTime: 60000,
  });

  const [compatVmFilter, setCompatVmFilter] = useState('');
  const filteredCompatVehicles = useMemo(() => {
    const q = compatVmFilter.trim().toLowerCase();
    if (!q) return compatVehicleModels;
    return compatVehicleModels.filter((vm) => {
      const b = (vm.brand && vm.brand.name) || '';
      return `${b} ${vm.name}`.toLowerCase().includes(q);
    });
  }, [compatVehicleModels, compatVmFilter]);

  const handleToggleEngineCode = useCallback((id) => {
    let was = false;
    let shouldFill = false;
    setFormData((fd) => {
      const s = new Set(fd.compatibility_engine_family_ids || []);
      was = s.has(id);
      if (was) s.delete(id);
      else s.add(id);
      shouldFill = !was && !compatibilityTextTouchedRef.current;
      return { ...fd, compatibility_engine_family_ids: [...s] };
    });
    if (!shouldFill) return;
    (async () => {
      try {
        const { data: fam } = await compatibilityApi.getEngineFamily(id);
        const vms = fam?.vehicle_models || [];
        if (vms.length) {
          const m = vms[0];
          const line = [m.brand?.name, m.name].filter(Boolean).join(' ').trim();
          if (line) setFormData((x) => ({ ...x, model: line }));
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn('getEngineFamily', err);
      }
    })();
  }, []);

  const handleToggleVehicleModel = useCallback((id) => {
    setFormData((fd) => {
      const s = new Set(fd.compatibility_vehicle_model_ids || []);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return { ...fd, compatibility_vehicle_model_ids: [...s] };
    });
  }, []);

  // openVoiceAdd: открыть форму нового товара (как «Добавить»)
  // openAdd + barcode: со страницы продаж
  useEffect(() => {
    if (location.state?.openVoiceAdd) {
      setImageBlobUrl((p) => {
        if (p) URL.revokeObjectURL(p);
        return '';
      });
      setFormData({ ...emptyForm(), barcode: generateEAN13() });
      setFormError(''); setBarcodeLocked(false); setShowQrPanel(false); setShowForm(true);
      navigate(location.pathname, { replace: true, state: {} });
    } else if (location.state?.openAdd) {
      setImageBlobUrl((p) => {
        if (p) URL.revokeObjectURL(p);
        return '';
      });
      const bc = location.state.barcode || '';
      setFormData({ ...emptyForm(), barcode: bc });
      setFormError(''); setBarcodeLocked(Boolean(bc)); setShowQrPanel(false); setShowForm(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  // Barcode canvas (CODE128: цифры и латиница; автогенерация EAN-13 — только цифры)
  useEffect(() => {
    if (!showForm || !formData.barcode || !barcodeCanvasRef.current) return;
    const v = String(formData.barcode).trim();
    if (!v) return;
    try {
      JsBarcode(barcodeCanvasRef.current, v, { format: 'CODE128', displayValue: true, width: 2, height: 56, margin: 6 });
    } catch {
      /* формат/набор символов не подходит для CODE128 */
    }
  }, [showForm, formData.barcode]);

  const {
    data: productsPages,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ['products', search, selectedCategory],
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const r = await productApi.getAll({
          search: search || undefined,
          category: selectedCategory || undefined,
          skip: pageParam,
          limit: PRODUCTS_PAGE_SIZE,
        });
        const data = r.data;
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.items)) return data.items;
        return [];
      }
      catch (err) {
        console.error('Error fetching products:', err);
        toast.error(`✕ ${getApiErrorMessage(err, 'Не удалось загрузить товары')}`);
        return [];
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PRODUCTS_PAGE_SIZE) return undefined;
      return allPages.length * PRODUCTS_PAGE_SIZE;
    },
    initialPageParam: 0,
    staleTime: 30000,
  });
  const products = useMemo(() => (productsPages?.pages || []).flat(), [productsPages]);

  useEffect(() => { productsRef.current = products; }, [products]);

  // Search autocomplete suggestions (max 6); must be after `products` is defined
  const searchSuggestions = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    const results = [];
    const allProducts = productsRef.current.length ? productsRef.current : products;
    for (const p of allProducts) {
      if (results.length >= 6) break;
      const entries = [
        { val: p.name, type: 'Товар' },
        { val: p.brand, type: 'Марка' },
        { val: p.model, type: 'Модель' },
        { val: p.category, type: 'Категория' },
      ];
      for (const { val, type } of entries) {
        if (!val) continue;
        const key = val.toLowerCase();
        if (key.includes(q) && !seen.has(key)) {
          seen.add(key);
          results.push({ label: val, type });
          if (results.length >= 6) break;
        }
      }
    }
    return results;
  }, [searchInput, products]);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      try {
        const r = await productApi.getCategories({ limit: 500 });
        const data = r.data;
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data?.categories)) return data.categories;
        return [];
      } catch {
        return [];
      }
    },
  });
  const safeCategories = Array.isArray(categories) ? categories : [];

  const { data: productsStats } = useQuery({
    queryKey: ['products-stats'],
    queryFn: async () => {
      try {
        const r = await productApi.getStats();
        return r.data || null;
      } catch {
        return null;
      }
    },
    staleTime: 30000,
  });

  // Stale filter from URL params (from Dashboard)
  const stockFilter = searchParams.get('stock');
  useEffect(() => {
    if (stockFilter === 'stale') { setShowStale(true); setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('stock'); return n; }, { replace: true }); }
    else if (stockFilter === 'out') { setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('stock'); return n; }, { replace: true }); }
    else if (stockFilter === 'low') { setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('stock'); return n; }, { replace: true }); }
  }, [stockFilter]);

  useEffect(() => {
    const pid = searchParams.get('product');
    if (!pid || !products.length) return;
    const p = products.find((x) => String(x.id) === pid);
    if (p) { setSideProduct(p); setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('product'); return n; }, { replace: true }); }
  }, [products, searchParams, setSearchParams]);

  const displayProducts = useMemo(() => {
    if (showStale) return products.filter(isStale);
    return products;
  }, [products, showStale]);

  const catalogVirtual = useMemo(() => {
    const rows = displayProducts;
    const n = rows.length;
    if (n === 0) return { padTop: 0, padBottom: 0, slice: [] };
    const rh = CATALOG_ROW_HEIGHT;
    const vh = Math.max(1, tableViewportH);
    const st = tableScrollTop;
    const rowStart = Math.max(0, Math.floor(st / rh) - CATALOG_OVERSCAN);
    const rowEnd = Math.min(n, Math.ceil((st + vh) / rh) + CATALOG_OVERSCAN);
    const padTop = rowStart * rh;
    const padBottom = (n - rowEnd) * rh;
    return { padTop, padBottom, slice: rows.slice(rowStart, rowEnd) };
  }, [displayProducts, tableScrollTop, tableViewportH]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return undefined;
    const measure = () => setTableViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleTableScroll = useCallback((e) => {
    setTableScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (el) el.scrollTop = 0;
    setTableScrollTop(0);
  }, [showStale, selectedCategory, search]);

  /* mutations */
  const saveMutation = useMutation({
    mutationFn: (payload) => {
      const id = payload?.id ?? formRef.current?.id;
      const body = { ...payload };
      delete body.id;
      return id ? productApi.update(id, body) : productApi.create(body);
    },
    onSuccess: (res) => {
      const wasEdit = Boolean(formRef.current?.id);
      toast.success(wasEdit ? '✓ Товар обновлён' : '✓ Товар создан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      if (!wasEdit && res.data) { setSavedProduct(res.data); setShowPrintSuggest(true); }
      resetForm();
    },
    onError: (err) => {
      const detail = err.response?.data?.detail;
      const message = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((x) => `${x?.loc?.join?.('.') || 'field'}: ${x?.msg || 'invalid'}`).join('; ')
          : 'Ошибка при сохранении товара';
      toast.error(`✕ ${message}`);
      setFormError(message);
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file) => {
      const controller = new AbortController();
      importAbortRef.current = controller;
      try {
        return await importExcelStream(file, {
          signal: controller.signal,
          onUploadProgress: (ev) => {
            const { loaded, total } = ev;
            setImportOverlay((prev) => {
              if (!prev) return prev;
              if (total != null && total > 0) { const pct = Math.min(100, Math.round((loaded * 100) / total)); return { ...prev, uploadPct: pct, phase: loaded >= total ? 'processing' : 'upload' }; }
              return { ...prev, uploadPct: null, phase: 'upload' };
            });
          },
          onServerProgress: (current, total) => {
            setImportOverlay((prev) => {
              if (!prev) return prev;
              const serverPct = total > 0 ? Math.min(100, Math.round((current * 100) / total)) : null;
              return { ...prev, phase: 'processing', serverCurrent: current, serverTotal: total, serverPct };
            });
          },
        });
      } catch (err) {
        if (!shouldFallbackImport(err)) throw err;
        // Legacy/non-stream backend compatibility: fallback to regular import endpoint.
        return productApi.importExcel(file, {
          signal: controller.signal,
          onUploadProgress: (ev) => {
            const { loaded, total } = ev;
            setImportOverlay((prev) => {
              if (!prev) return prev;
              if (total != null && total > 0) {
                const pct = Math.min(100, Math.round((loaded * 100) / total));
                return { ...prev, uploadPct: pct, phase: loaded >= total ? 'processing' : 'upload', serverCurrent: null, serverTotal: null, serverPct: null };
              }
              return { ...prev, uploadPct: null, phase: 'upload', serverCurrent: null, serverTotal: null, serverPct: null };
            });
          },
        });
      }
    },
    onMutate: (file) => { setImportError(''); setImportOverlay({ fileName: file.name, uploadPct: 0, phase: 'upload', serverCurrent: null, serverTotal: null, serverPct: null }); },
    onSuccess: (res) => {
      setImportError('');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      const { created, skipped } = res.data || {};
      const n = skipped?.length ?? 0;
      toast.success(n > 0 ? `Импорт: добавлено ${created ?? 0}, пропущено ${n}` : `Импорт: добавлено ${created ?? 0}`);
      setImportReport({ created: created ?? 0, skipped: skipped || [] });
    },
    onError: (err) => {
      if (err?.code === 'ERR_CANCELED') { toast('Импорт отменён', { icon: '⏹️' }); return; }
      const msg = formatImportError(err) || err?.message || 'Ошибка импорта';
      setImportError(msg); toast.error(`Импорт: ${msg}`);
    },
    onSettled: () => { importAbortRef.current = null; setImportOverlay(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (rawId) => { const id = Number(rawId); if (!Number.isInteger(id) || id <= 0) throw new Error('Некорректный ID'); return productApi.delete(id); },
    onSuccess: async (_r, deletedId) => {
      toast.success('✓ Товар удалён');
      setSideProduct((p) => (p && Number(p.id) === Number(deletedId) ? null : p));
      await queryClient.invalidateQueries({ queryKey: ['products'], refetchType: 'all' });
      setDeleteModal(null);
    },
    onError: (err) => {
      const d = err.response?.data?.detail;
      let msg = 'Ошибка при удалении';
      if (typeof d === 'string') msg = d;
      else if (Array.isArray(d)) msg = d.map((x) => x?.msg || JSON.stringify(x)).join('; ');
      else if (err.message) msg = err.message;
      toast.error(`✕ ${msg}`);
    },
  });

  /* form helpers */
  const resetForm = () => {
    compatibilityTextTouchedRef.current = false;
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setFormData(emptyForm());
    setShowForm(false);
    setFormError('');
    setBarcodeLocked(false);
    setShowQrPanel(false);
  };

  const showFormRef = useRef(false);
  const blockScanRef = useRef(false);
  useEffect(() => {
    showFormRef.current = showForm;
  }, [showForm]);
  useEffect(() => {
    blockScanRef.current = !!(deleteModal || importOverlay || showPrint);
  }, [deleteModal, importOverlay, showPrint]);

  /* ── Глобальный сканер (HID-клавиатура), как на складе ──
     - capture: true — раньше поля поиска; цифры/код не «съедаются» полем.
     - Длинная пауза между символами → новый код (до 220 мс — медленные сканеры).
     - Поиск: сначала кэш страницы, затем GET /products/barcode/… (вся БД, штрих или SKU).
     - В поле поиска по-прежнему можно искать по-русски; латиница/цифры уходят в буфер скана. */
  const SCAN_MAX_GAP_MS = 220;
  const MIN_SCAN_LEN = 3;
  const SCAN_CHAR = /^[0-9A-Za-z-]$/;

  useEffect(() => {
    const handleKey = (e) => {
      if (showFormRef.current || blockScanRef.current) return;

      if (e.key === 'Enter') {
        const raw = scanBufRef.current;
        scanBufRef.current = '';
        scanLastRef.current = 0;
        const buf = normalizeScanCode(raw);
        if (buf.length < MIN_SCAN_LEN) return;
        e.preventDefault();
        e.stopPropagation();

        void (async () => {
          let found = productsRef.current.find((p) => productMatchesScan(p, buf));
          if (!found) {
            try {
              const r = await productApi.getByBarcode(buf);
              if (r?.data) found = r.data;
            } catch {
              /* 404 */
            }
          }
          if (found) {
            setSideProduct(found);
            setSearchInput('');
            setShowSuggestions(false);
          } else {
            setScanNotFound(buf);
          }
        })();
        return;
      }

      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!SCAN_CHAR.test(e.key)) {
        scanBufRef.current = '';
        scanLastRef.current = 0;
        return;
      }

      const now = Date.now();
      const gap = now - scanLastRef.current;
      const active = document.activeElement;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/i.test(active?.tagName || '');
      const onCatalog = active?.closest?.('.products-page-shell');
      const isMainSearch = active?.classList?.contains('catalog-search-input');

      if (gap > SCAN_MAX_GAP_MS) scanBufRef.current = '';

      /* В главном поиске: медленные буквы — обычный ввод (марка латиницей); цифры и быстрый поток — сканер */
      if (isMainSearch && gap > SCAN_MAX_GAP_MS && !/^[0-9-]$/.test(e.key)) {
        scanLastRef.current = now;
        scanBufRef.current = '';
        return;
      }

      scanLastRef.current = now;
      scanBufRef.current += e.key;

      const rapidBurst = gap <= SCAN_MAX_GAP_MS;
      if (inField && onCatalog) {
        if (!isMainSearch) {
          e.preventDefault();
          e.stopPropagation();
        } else if (/^[0-9-]$/.test(e.key) || rapidBurst) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, []);

  const handleEdit = async (product) => {
    compatibilityTextTouchedRef.current = false;
    let p = { ...product };
    if (product?.id) {
      try {
        const { data } = await productApi.getById(product.id);
        p = { ...p, ...data };
      } catch { /* list row only */ }
    }
    const rate = Number(settingsRow?.delivery_kzt_per_kg) || 800;
    const delNum = p.delivery_cost_kzt != null ? Number(p.delivery_cost_kzt) : null;
    let wKg = p.delivery_weight_kg != null ? String(p.delivery_weight_kg) : '';
    if (!wKg && delNum != null && delNum > 0 && rate > 0) {
      const kg = roundKgVal(delNum / rate);
      wKg = kg != null ? String(kg) : '';
    }
    setFormData({
      ...emptyForm(),
      ...p,
      sku: p.sku || '',
      purchase_price: p.purchase_price != null ? Number(p.purchase_price) : 0,
      cny_price: p.cny_price != null ? String(p.cny_price) : '',
      delivery_cost_kzt: p.delivery_cost_kzt != null ? String(p.delivery_cost_kzt) : '',
      delivery_weight_kg: wKg,
      supplier: p.supplier || '',
      storage_location: p.location_zone || '',
      image_url: p.image_url || '',
      compatibility_engine_family_ids: (p.compatibility?.engine_families || []).map((x) => x.id),
      compatibility_vehicle_model_ids: (p.compatibility?.vehicle_models || []).map((x) => x.id),
    });
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setShowForm(true); setBarcodeLocked(true); setShowQrPanel(false); setFormError('');
    setSideProduct(null);
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.(); setFormError('');
    if (!formData.name?.trim()) { setFormError('Название товара обязательно'); return; }
    if (num(formData.sale_price) <= 0) { setFormError('Цена продажи должна быть больше 0'); return; }
    saveMutation.mutate(buildPayload(formData, cnyRate));
  };

  const openNew = () => {
    compatibilityTextTouchedRef.current = false;
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setFormData({ ...emptyForm(), barcode: generateEAN13() });
    setFormError('');
    setBarcodeLocked(false);
    setShowQrPanel(false);
    setShowForm(true);
  };

  const productImageDisplaySrc = (url) => {
    const base = (url || '').split('?')[0].trim();
    if (!base) return '';
    return `${resolveUploadedAssetUrl(base)}?v=${imagePreviewBust}`;
  };

  const productImageThumbSrc = () => {
    if (imageBlobUrl) return imageBlobUrl;
    if (formData.image_url) return productImageDisplaySrc(formData.image_url);
    return '';
  };

  const handleUploadProductImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!formData.id) {
      toast.error('Сначала сохраните товар, затем загрузите фото');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Выберите файл изображения (JPG, PNG, WEBP)');
      return;
    }
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setImageUploading(true);
    setImageUploadPct(0);
    try {
      const response = await productApi.uploadProductImage(formData.id, file, {
        onUploadProgress: (ev) => {
          if (ev.total) {
            setImageUploadPct(Math.min(100, Math.round((ev.loaded * 100) / ev.total)));
          } else {
            setImageUploadPct((p) => (p == null ? 5 : Math.min(95, (p || 0) + 8)));
          }
        },
      });
      const imageUrl = (response?.data?.image_url || '').split('?')[0].trim();
      if (!imageUrl) {
        toast.error('Сервер не вернул путь к фото');
        return;
      }
      setFormData((prev) => ({ ...prev, image_url: imageUrl }));
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      const w = response?.data?.width;
      const h = response?.data?.height;
      const b = response?.data?.size_bytes;
      const dim = w && h ? ` ${w}×${h} px` : '';
      const sz = b != null ? `, ${(b / 1024).toFixed(1)} КБ` : '';
      toast.success(`Фото сохранено${dim}${sz}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Не удалось загрузить фото'));
    } finally {
      setImageUploading(false);
      setImageUploadPct(null);
    }
  };

  const handleDeleteProductImage = async () => {
    if (!formData.id) {
      toast.error('Сначала сохраните товар');
      return;
    }
    if (!formData.image_url) return;
    try {
      await productApi.deleteProductImage(formData.id);
      setFormData((prev) => ({ ...prev, image_url: '' }));
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Фото удалено');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Не удалось удалить фото'));
    }
  };

  const openDeleteConfirm = (product, e) => {
    e?.stopPropagation?.();
    const { problem, answer } = genMathProblem();
    setDeleteModal({ product, problem, answer, input: '' });
  };

  const openPrintForRow = (product, e) => {
    e?.stopPropagation?.();
    setPrintProduct(product); setPrintType('barcode'); setShowPrint(true);
  };

  const handleExportExcel = async () => {
    try {
      const r = await productApi.exportExcel();
      const blob = new Blob([r.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      let name = `skladpro_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.xlsx`;
      const cd = r.headers['content-disposition'];
      if (cd) { const utf = cd.match(/filename\*=UTF-8''([^;\s]+)/i); if (utf) { try { name = decodeURIComponent(utf[1]); } catch { /* невалидный percent-encoding */ } } else { const m = cd.match(/filename="([^"]+)"/i); if (m) name = m[1]; } }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
      toast.success('Файл Excel скачан');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Не удалось выгрузить каталог'));
    }
  };

  /* computed */
  const profitPct = (row) => {
    const pp = Number(row.purchase_price) || 0;
    const sp = Number(row.sale_price) || 0;
    if (pp <= 0) return null;
    return (((sp - pp) / pp) * 100).toFixed(1);
  };

  const effPurchasePreview = effectivePurchaseTenge(formData, cnyRate);
  const profitPreview =
    effPurchasePreview > 0 && num(formData.sale_price) > 0
      ? (((num(formData.sale_price) - effPurchasePreview) / effPurchasePreview) * 100).toFixed(1)
      : '0';

  const staleCount = useMemo(() => products.filter(isStale).length, [products]);
  const pagedPurchaseValue = useMemo(
    () => products.reduce((s, p) => s + (parseFloat(p.purchase_price || 0) * (p.quantity || 0)), 0),
    [products],
  );
  const totalPurchaseValue = Number(productsStats?.warehouse_value ?? pagedPurchaseValue);
  const totalCatalog = productsStats?.total_products != null ? Number(productsStats.total_products) : null;

  const handleRefreshCatalog = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['products-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
    ]);
    toast.success('Список обновлён');
  }, [queryClient]);

  const listId = 'product-category-suggestions';

  /* Только первый холодный старт: иначе при смене search весь экран → Spinner и инпут размонтируется (потеря фокуса). */
  if (isPending && !productsPages) return <LoadingSpinner message="Загружаем товары..." />;

  /* ─────────── RENDER ─────────── */
  return (
    <div className="products-page-shell products-page-desk-dock-space"
      style={{ padding: '10px 14px 0', maxWidth: '1440px', margin: '0 auto', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >

      {/* Import progress overlay */}
      {importOverlay && (
        <div className="import-progress-overlay" role="alertdialog" aria-busy="true">
          <div className="import-progress-card">
            <div style={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>{importOverlay.fileName}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
              {(importOverlay.phase === 'processing' && (importOverlay.serverTotal == null || importOverlay.serverPct == null)) || (importOverlay.phase === 'upload' && importOverlay.uploadPct == null)
                ? <FiLoader size={18} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} /> : null}
              <span>
                {importOverlay.phase === 'processing' && importOverlay.serverTotal != null && importOverlay.serverTotal > 0 && importOverlay.serverCurrent != null
                  ? `Строки: ${importOverlay.serverCurrent} / ${importOverlay.serverTotal} (${importOverlay.serverPct ?? 0}%)`
                  : importOverlay.phase === 'processing' ? 'Обработка на сервере…'
                  : importOverlay.uploadPct == null ? 'Отправка файла…'
                  : `Загрузка: ${importOverlay.uploadPct}%`}
              </span>
            </div>
            <div className={`import-progress-track ${importOverlay.phase === 'upload' && importOverlay.uploadPct == null ? 'import-progress-indeterminate' : importOverlay.phase === 'processing' && (importOverlay.serverTotal === 0 || importOverlay.serverPct == null || importOverlay.serverTotal == null) ? 'import-progress-indeterminate' : ''}`}>
              <div className="import-progress-fill" style={{ width: importOverlay.phase === 'upload' && importOverlay.uploadPct == null ? undefined : importOverlay.phase === 'processing' && importOverlay.serverTotal != null && importOverlay.serverTotal > 0 && importOverlay.serverPct != null ? `${importOverlay.serverPct}%` : importOverlay.phase === 'processing' ? undefined : `${importOverlay.uploadPct ?? 0}%` }} />
            </div>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" icon={FiX} onClick={() => importAbortRef.current?.abort()}>Отменить</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="ios-mega-title">Каталог</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            {products.length} из {totalCatalog != null ? totalCatalog : '…'} в каталоге
            {showStale && displayProducts.length !== products.length ? ` · показано ${displayProducts.length}` : ''}
            {' · '}
            {Math.round(totalPurchaseValue).toLocaleString('ru-RU')} ₸
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ios-secondary"
            onClick={() => handleRefreshCatalog()}
            disabled={Boolean(isFetching && !isFetchingNextPage)}
            title="Обновить список с сервера"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 13, cursor: isFetching && !isFetchingNextPage ? 'wait' : 'pointer', color: 'var(--text)', transition: 'var(--transition)' }}
          >
            <FiRefreshCw size={15} style={isFetching && !isFetchingNextPage ? { animation: 'spin 1s linear infinite' } : undefined} />
            Обновить
          </button>
          <button type="button" className="btn-ios-secondary" onClick={() => importFileRef.current?.click()} disabled={importMutation.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: 'var(--text)', transition: 'var(--transition)' }}>
            <FiUpload size={15} /> Импорт Excel
          </button>
          <button type="button" onClick={handleExportExcel} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: 'var(--text)', transition: 'var(--transition)' }}>
            <FiDownload size={15} /> Экспорт
          </button>
          <input ref={importFileRef} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importMutation.mutate(f); e.target.value = ''; }} />
          <button type="button" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 12, border: '1px solid #4f46e5', background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', boxShadow: 'none', willChange: 'transform' }}>
            <FiPlus size={16} strokeWidth={2.5} /> Добавить товар
          </button>
        </div>
      </div>

      {/* ── Errors ── */}
      {isError && <Alert type="danger" title="Ошибка загрузки" message="Не удалось загрузить список товаров." icon={FiAlertTriangle} />}
      {importError && <div style={{ marginBottom: 12 }}><Alert type="danger" title="Ошибка импорта Excel" message={importError} icon={FiAlertTriangle} onClose={() => setImportError('')} /></div>}

      {/* ── Search + categories ── */}
      <div className="ios-glass-panel" style={{ padding: '14px 16px', marginBottom: 12 }}>
        <div ref={searchWrapRef} style={{ position: 'relative', marginBottom: 10 }}>
          <div className="catalog-search-wrap">
            <FiSearch className="catalog-search-icon" size={17} />
            <input
              className="catalog-search-input"
              placeholder="Поиск по названию, марке, штрих-коду…"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setShowSuggestions(true); }}
              onFocus={() => searchSuggestions.length > 0 && setShowSuggestions(true)}
              aria-label="Поиск"
            />
            {searchInput && (
              <button type="button" onClick={() => { setSearchInput(''); setShowSuggestions(false); }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, zIndex: 2 }}>
                <FiX size={16} />
              </button>
            )}
          </div>
          {showSuggestions && searchSuggestions.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'none', zIndex: 50, overflow: 'hidden' }}>
              {searchSuggestions.map((s, i) => (
                <button
                  key={`${s.label}-${i}`}
                  type="button"
                  onClick={() => { setSearchInput(s.label); setShowSuggestions(false); }}
                  style={{ width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottom: i < searchSuggestions.length - 1 ? '1px solid var(--border-light)' : 'none', textAlign: 'left', transition: 'background 0.12s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--primary-light)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0 }}>{s.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="catalog-chips-scroll">
          <button type="button" className={`catalog-chip ${selectedCategory === '' && !showStale ? 'catalog-chip-active' : ''}`} onClick={() => { setSelectedCategory(''); setShowStale(false); }}>Все</button>
          {safeCategories.map((cat) => (
            <button key={cat} type="button" className={`catalog-chip ${selectedCategory === cat && !showStale ? 'catalog-chip-active' : ''}`} onClick={() => { setSelectedCategory(cat); setShowStale(false); }}>{cat}</button>
          ))}
          <button type="button" className={`catalog-chip ${showStale ? 'catalog-chip-stale' : 'catalog-chip-stale-off'}`} onClick={() => { setShowStale((s) => !s); setSelectedCategory(''); }}>
            <FiClock size={13} style={{ marginRight: 5 }} />Залежалось {staleCount > 0 && <span style={{ marginLeft: 4, background: showStale ? '#fbbf24' : '#fde047', border: '1px solid', borderColor: showStale ? '#d97706' : '#f59e0b', borderRadius: 8, padding: '1px 6px', fontSize: 11 }}>{staleCount}</span>}
          </button>
        </div>
      </div>

      {/* ── Table (виртуальный скролл: в DOM только видимые строки + буфер) ── */}
      <div
        ref={tableScrollRef}
        className="products-table-scroll"
        style={{ marginBottom: 0 }}
        onScroll={handleTableScroll}
      >
        {displayProducts.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <FiPackage size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>{search || selectedCategory || showStale ? 'Ничего не найдено по фильтрам' : 'Добавьте первый товар'}</div>
          </div>
        ) : (
          <table className="products-catalog-table">
            <thead className="products-catalog-thead">
              <tr>
                {['Штрих-код', 'Название', 'Марка', 'Модель', 'Категория', 'Закуп', 'Продажа', 'Прибыль', 'Место', 'Остаток', ''].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalogVirtual.padTop > 0 && (
                <tr aria-hidden="true" style={{ height: catalogVirtual.padTop, pointerEvents: 'none' }}>
                  <td colSpan={11} style={{ padding: 0, border: 'none', height: catalogVirtual.padTop, lineHeight: 0 }} />
                </tr>
              )}
              {catalogVirtual.slice.map((row) => {
                const qty = Number(row.quantity) || 0;
                const stale = isStale(row);
                const pp = profitPct(row);
                const ppNum = pp ? parseFloat(pp) : null;
                const catColor = getCatColor(row.category);
                const rowCls = `products-catalog-row${stale && showStale ? ' products-catalog-row--stale' : ''}`;
                return (
                  <tr
                    key={row.id}
                    className={rowCls}
                    style={{ height: CATALOG_ROW_HEIGHT }}
                    onClick={() => setSideProduct(row)}
                  >
                    <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace,monospace', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.barcode || row.sku || '—'}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text)', minWidth: 140, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.brand || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.model || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {row.category
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, background: catColor.bg, color: catColor.color, whiteSpace: 'nowrap', border: '1px solid var(--border-light)' }}>{row.category}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{Number(row.purchase_price || 0).toLocaleString('ru-RU')} ₸</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{Number(row.sale_price || 0).toLocaleString('ru-RU')} ₸</td>
                    <td style={{ padding: '12px 14px' }}>
                      {ppNum != null
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, background: ppNum >= 50 ? '#d1fae5' : '#fef3c7', color: ppNum >= 50 ? '#047857' : '#b45309', whiteSpace: 'nowrap', border: '1px solid var(--border-light)' }}>{pp}%</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace,monospace', fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.location_zone || '—'}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: qty === 0 ? 'var(--danger)' : qty <= 5 ? '#d97706' : 'var(--success)', whiteSpace: 'nowrap' }}>{qty} шт</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                      <div className="products-catalog-row-actions">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleEdit(row); }} title="Редактировать" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FiEdit2 size={14} /></button>
                        <button type="button" onClick={(e) => openPrintForRow(row, e)} title="Этикетка" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FiTag size={14} /></button>
                        <button type="button" onClick={(e) => openDeleteConfirm(row, e)} title="Удалить" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #fecaca', background: '#fee2e2', color: 'var(--danger)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FiTrash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {catalogVirtual.padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: catalogVirtual.padBottom, pointerEvents: 'none' }}>
                  <td colSpan={11} style={{ padding: 0, border: 'none', height: catalogVirtual.padBottom, lineHeight: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {hasNextPage && (
        <div className="products-load-more-bar">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="btn-ios-primary products-load-more-btn"
          >
            {isFetchingNextPage ? 'Загрузка...' : `Ещё ${PRODUCTS_PAGE_SIZE}`}
          </button>
        </div>
      )}

      {/* ── Bottom dock ── */}
      <nav className="catalog-dock" aria-label="Навигация">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          <div>
            {products.length} из {totalCatalog != null ? totalCatalog : '…'}
            {showStale && displayProducts.length !== products.length ? ` · ${displayProducts.length} в фильтре` : ''}
          </div>
          <div style={{ color: 'var(--text)', marginTop: 3 }}>{Math.round(totalPurchaseValue).toLocaleString('ru-RU')} ₸</div>
        </div>
        <div className="catalog-dock-center">
          <button type="button" className="catalog-dock-nav catalog-dock-nav-active" onClick={() => navigate('/products')}><FiGrid size={22} strokeWidth={2} /><span>Каталог</span></button>
          <button type="button" className="catalog-dock-nav" onClick={() => navigate('/sales')}><FiShoppingCart size={22} strokeWidth={2} /><span>Продажа</span></button>
        </div>
        <div style={{ width: 100 }} />
      </nav>

      {/* ── Scanner: not found modal ── */}
      {scanNotFound && (
        <div style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 360, background: 'var(--surface)', borderRadius: 24, border: '1px solid var(--border)', boxShadow: 'none', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}>
            <div style={{ padding: '28px 24px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Товар не найден</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>Штрих-код / код:</div>
              <div style={{ padding: '8px 14px', borderRadius: 12, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', fontFamily: 'ui-monospace,monospace', fontSize: 15, fontWeight: 700, color: 'var(--primary)', marginBottom: 20, wordBreak: 'break-all' }}>
                {scanNotFound}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 20 }}>
                Хотите добавить этот товар в каталог?
              </div>
            </div>
            <div style={{ padding: '0 20px 22px', display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setScanNotFound(null)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                Отменить
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...emptyForm(), barcode: scanNotFound });
                  setBarcodeLocked(true);
                  setFormError('');
                  setShowForm(true);
                  setScanNotFound(null);
                }}
                style={{ flex: 2, padding: '13px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <FiPlus size={16} /> Добавить товар
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Side Sheet ── */}
      {sideProduct && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: '#9ca3af', zIndex: 300 }} onClick={() => setSideProduct(null)} />
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(420px, 100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'none', zIndex: 301, overflow: 'auto', display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.25s ease-out', willChange: 'transform' }}>
            {/* Header */}
            <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.2, wordBreak: 'break-word' }}>{sideProduct.name}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {sideProduct.brand && <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>{sideProduct.brand}</span>}
                  {sideProduct.model && <span style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700 }}>Модель: {sideProduct.model}</span>}
                  {sideProduct.category && (() => { const cc = getCatColor(sideProduct.category); return <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: cc.bg, color: cc.color }}>{sideProduct.category}</span>; })()}
                </div>
              </div>
              <button type="button" onClick={() => setSideProduct(null)} style={{ width: 36, height: 36, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}><FiX size={18} /></button>
            </div>
            {/* Specs grid */}
            <div style={{ padding: '18px 22px', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                {[
                  ['Штрих-код', sideProduct.barcode || sideProduct.sku || '—', true],
                  ['Модель', sideProduct.model || '—'],
                  ['Поставщик', sideProduct.supplier || '—'],
                  ['Закуп (₸)', `${Number(sideProduct.purchase_price || 0).toLocaleString('ru-RU')} ₸`],
                  ['Доставка', sideProduct.delivery_cost_kzt ? `${Number(sideProduct.delivery_cost_kzt).toLocaleString('ru-RU')} ₸` : '—'],
                  ['Вес (доставка)', formatSideDeliveryKg(sideProduct, deliveryKztPerKg)],
                  ['Продажа (₸)', `${Number(sideProduct.sale_price || 0).toLocaleString('ru-RU')} ₸`],
                  ['Прибыль', profitPct(sideProduct) ? `${profitPct(sideProduct)}%` : '—'],
                  ['Место', sideProduct.location_zone || '—', true],
                  ['Мин. остаток', String(sideProduct.min_quantity ?? 0)],
                ].map(([label, val, mono]) => (
                  <div key={label} style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: mono ? 'ui-monospace,monospace' : undefined, wordBreak: 'break-word' }}>{val}</div>
                  </div>
                ))}
              </div>
              {/* Stock big number */}
              <div style={{ padding: '16px 18px', borderRadius: 18, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', textAlign: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Остаток</div>
                <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em', color: Number(sideProduct.quantity) === 0 ? 'var(--danger)' : Number(sideProduct.quantity) <= 5 ? '#d97706' : 'var(--success)', lineHeight: 1 }}>{sideProduct.quantity ?? 0}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>штук</div>
              </div>
              {sideProduct.description && <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: 18 }}>{sideProduct.description}</div>}
            </div>
            {/* Actions */}
            <div style={{ padding: '14px 22px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, background: 'var(--surface)', position: 'sticky', bottom: 0 }}>
              <button type="button" onClick={() => handleEdit(sideProduct)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><FiEdit2 size={16} />Редактировать</button>
              <button type="button" onClick={() => openPrintForRow(sideProduct)} style={{ padding: '13px 16px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><FiTag size={16} /></button>
              <button type="button" onClick={(e) => openDeleteConfirm(sideProduct, e)} style={{ padding: '13px 16px', borderRadius: 14, border: '1px solid #fecaca', background: '#fee2e2', color: 'var(--danger)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><FiTrash2 size={16} /></button>
            </div>
          </div>
        </>
      )}

      {/* ── Delete Math Confirm ── */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', borderRadius: 24, border: '1px solid var(--border)', boxShadow: 'none', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}>
            <div style={{ padding: '22px 22px 0' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Удалить товар?</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, wordBreak: 'break-word' }}>«{deleteModal.product.name}»</div>
              <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fee2e2', border: '1px solid #fecaca', fontSize: 13, color: 'var(--danger)', fontWeight: 600, marginBottom: 16 }}>⚠️ Операция необратима</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Введите ответ: <strong style={{ color: 'var(--text)', fontSize: 15 }}>{deleteModal.problem} = ?</strong>
              </div>
              <input
                autoFocus
                className="ios-input"
                type="number"
                inputMode="numeric"
                placeholder="Ваш ответ"
                value={deleteModal.input}
                onChange={(e) => setDeleteModal((m) => ({ ...m, input: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && deleteModal.input === deleteModal.answer) deleteMutation.mutate(deleteModal.product.id); }}
                style={{ marginBottom: 16 }}
              />
            </div>
            <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setDeleteModal(null)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Отмена</button>
              <button type="button" disabled={deleteModal.input !== deleteModal.answer || deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteModal.product.id)}
                style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid', borderColor: deleteModal.input === deleteModal.answer ? '#b91c1c' : '#fca5a5', background: deleteModal.input === deleteModal.answer ? 'var(--danger)' : '#fecaca', color: '#fff', fontWeight: 700, fontSize: 14, cursor: deleteModal.input === deleteModal.answer ? 'pointer' : 'not-allowed', transition: 'background-color 0.2s, border-color 0.2s' }}>
                {deleteMutation.isPending ? '…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print suggest after create ── */}
      {showPrintSuggest && savedProduct && (
        <div style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 340, background: 'var(--surface)', borderRadius: 24, border: '1px solid var(--border)', boxShadow: 'none', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}>
            <div style={{ padding: '24px 22px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🏷️</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Распечатать этикетку?</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>Товар «{savedProduct.name}» создан</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20 }}>
                {[{ val: 'barcode', label: '■ Штрих-код' }, { val: 'qrcode', label: '⬛ QR-код' }].map((t) => (
                  <button key={t.val} type="button" onClick={() => setPrintType(t.val)} style={{ padding: '8px 16px', borderRadius: 12, border: `2px solid ${printType === t.val ? 'var(--primary)' : 'var(--border)'}`, background: printType === t.val ? 'var(--primary-light)' : 'var(--surface)', color: printType === t.val ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{t.label}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setShowPrintSuggest(false)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Пропустить</button>
              <button type="button" onClick={() => { setPrintProduct(savedProduct); setShowPrint(true); setShowPrintSuggest(false); }} style={{ flex: 1, padding: '13px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Печатать</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import report modal ── */}
      <Modal isOpen={importReport != null} title="Результат импорта" icon={FiUpload} onClose={() => setImportReport(null)} size="lg" actions={<Button variant="primary" onClick={() => setImportReport(null)}>Понятно</Button>}>
        {importReport && (
          <div>
            <p style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600 }}>Добавлено товаров: {importReport.created}</p>
            {importReport.skipped?.length > 0 ? (
              <>
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Пропущенные строки ({importReport.skipped.length})</p>
                <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}><th style={{ padding: 10 }}>Строка</th><th style={{ padding: 10 }}>Причина</th><th style={{ padding: 10 }}>Данные</th></tr></thead>
                    <tbody>{importReport.skipped.map((s, i) => (<tr key={`${s.row}-${i}`} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: 10, fontWeight: 700 }}>{s.row}</td><td style={{ padding: 10 }}>{s.reason}</td><td style={{ padding: 10, color: 'var(--text-muted)', wordBreak: 'break-word' }}>{s.raw || '—'}</td></tr>))}</tbody>
                  </table>
                </div>
              </>
            ) : <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Все строки обработаны без пропусков.</p>}
          </div>
        )}
      </Modal>

      {/* ── Add / Edit product modal ── */}
      <Modal isOpen={showForm} title={formData.id ? 'Редактировать товар' : 'Новый товар'} onClose={resetForm} size="xl" icon={formData.id ? FiEdit2 : FiPlus}
        actions={<>
          <Button variant="secondary" onClick={resetForm}>Отмена</Button>
          <Button variant="primary" icon={formData.id ? FiEdit2 : FiPlus} onClick={handleSubmit} loading={saveMutation.isPending}>{formData.id ? 'Сохранить изменения' : 'Сохранить товар'}</Button>
        </>}
      >
        {formError && <Alert type="danger" message={formError} onClose={() => setFormError('')} style={{ marginBottom: 16 }} />}

        <div style={{ marginBottom: 18, padding: '12px 16px', borderRadius: 'var(--radius-ios)', background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FiImage size={16} /> Фото товара
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>JPG, PNG или WEBP (на сервере сохраняется как WebP). Сначала сохраните товар, затем загрузите фото.</div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface)',
                  }}
                >
                  {productImageThumbSrc() ? (
                    <img
                      src={productImageThumbSrc()}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span className="muted-text" style={{ fontSize: 12 }}>Нет фото</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label
                    className="btn-ios-secondary"
                    style={{
                      cursor: formData.id && !imageUploading ? 'pointer' : 'not-allowed',
                      opacity: formData.id && !imageUploading ? 1 : 0.6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {imageUploading ? `Загрузка${imageUploadPct != null ? ` ${imageUploadPct}%` : '…'}` : formData.image_url ? 'Заменить фото' : 'Загрузить фото'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleUploadProductImage}
                      disabled={!formData.id || imageUploading}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {formData.image_url && (
                    <button
                      type="button"
                      className="btn-ios-secondary"
                      onClick={handleDeleteProductImage}
                      disabled={imageUploading}
                      style={{ marginLeft: 8, opacity: imageUploading ? 0.6 : 1 }}
                    >
                      Удалить фото
                    </button>
                  )}
                  {imageUploading && imageUploadPct != null && (
                    <div style={{ marginTop: 8, height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${imageUploadPct}%`,
                          background: 'linear-gradient(90deg, #6366f1, #7c3aed)',
                          transition: 'width 0.12s ease',
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        <form className="ios-form-stack" onSubmit={handleSubmit}>
          <div>
            <span style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Штрих-код</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
              <input
                className="ios-input"
                style={{ flex: 1, minWidth: 160, border: formData.id ? '1px solid var(--primary)' : '1px solid var(--border)' }}
                value={formData.barcode || ''}
                readOnly={barcodeLocked}
                onChange={(e) => !barcodeLocked && setFormData({ ...formData, barcode: sanitizeBarcodeFieldInput(e.target.value) })}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Авто: 13 цифр EAN-13; вручную/сканер: цифры, латиница, дефис"
              />
              <button type="button" className="topbar-theme-toggle" title={barcodeLocked ? 'Разблокировать' : 'Замкнуть'} onClick={() => setBarcodeLocked((v) => !v)} style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{barcodeLocked ? <FiUnlock size={17} /> : <FiLock size={17} />}<span style={{ fontSize: 12, fontWeight: 600 }}>{barcodeLocked ? 'Разблок.' : 'Замкнуть'}</span></button>
              <button type="button" className="topbar-theme-toggle" title="Новый EAN-13" disabled={barcodeLocked} onClick={() => setFormData({ ...formData, barcode: generateEAN13() })} style={{ padding: '0 10px', opacity: barcodeLocked ? 0.4 : 1 }}><FiRefreshCw size={17} /></button>
              <button type="button" className="topbar-theme-toggle" title="Показать QR" onClick={() => setShowQrPanel((s) => !s)} style={{ padding: '0 10px', background: showQrPanel ? 'var(--primary-light)' : undefined }}><FiMaximize2 size={17} /></button>
            </div>
            {formData.barcode && <div style={{ marginTop: 10, padding: 10, borderRadius: 'var(--radius-ios)', background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', overflow: 'auto' }}><canvas ref={barcodeCanvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} /></div>}
            {showQrPanel && formData.barcode && <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', padding: 14, borderRadius: 'var(--radius-ios)', background: '#fff', border: '1px solid var(--border)' }}><QRCodeSVG value={String(formData.barcode)} size={156} level="M" /></div>}
          </div>

          <div style={{ marginTop: 4 }}>
            <span style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Артикул (SKU)</span>
            <input
              className="ios-input"
              placeholder="Внутренний артикул, OEM — отдельно от штрих-кода"
              value={formData.sku || ''}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              autoCapitalize="characters"
              spellCheck={false}
              style={{ width: '100%', border: formData.id ? '1px solid var(--primary)' : '1px solid var(--border)' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Учётный код для поиска и витрины; штрих-код выше — для сканера и этикетки.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Название *" placeholder="Например: Мотор" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={formData.id ? { border: '1px solid var(--primary)' } : {}} />
            <Input
              label="Марка (запчасть, OEM…)"
              placeholder="Bosch, NGK…"
              value={formData.brand || ''}
              onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              style={formData.id ? { border: '1px solid var(--primary)' } : {}}
            />
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <TextArea
              label="Совместимость для витрины (свой текст)"
              placeholder="Любой текст для сайта/витрины: марки, кроссы, уточнения. Не зависит от чипов ниже."
              value={formData.model || ''}
              onChange={(e) => {
                compatibilityTextTouchedRef.current = true;
                setFormData({ ...formData, model: e.target.value });
              }}
              style={{ minHeight: 88, ...formData.id ? { border: '1px solid var(--primary)' } : {} }}
            />
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Коды из справочника</div>
            <div className="catalog-chips-scroll" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {compatEngineFamilies.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Справочник пуст — задайте в Настройки</span>
              )}
              {compatEngineFamilies.map((ef) => {
                const on = (formData.compatibility_engine_family_ids || []).includes(ef.id);
                return (
                  <button
                    key={ef.id}
                    type="button"
                    className={`catalog-chip ${on ? 'catalog-chip-active' : ''}`}
                    onClick={() => handleToggleEngineCode(ef.id)}
                    style={{ padding: '7px 14px', fontSize: 13 }}
                  >
                    {ef.code}
                    {ef.name ? ` — ${ef.name}` : ''}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Авто из справочника (чипы)</span>
              <input
                className="ios-input"
                type="search"
                placeholder="Поиск: марка или модель"
                value={compatVmFilter}
                onChange={(e) => setCompatVmFilter(e.target.value)}
                style={{ flex: 1, minWidth: 140, maxWidth: 280, fontSize: 13, padding: '6px 10px' }}
                aria-label="Поиск авто в чипах"
              />
            </div>
            <div
              className="catalog-chips-scroll"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 160, overflowY: 'auto' }}
            >
              {compatVehicleModels.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
              )}
              {compatVehicleModels.length > 0 && filteredCompatVehicles.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Нет совпадений по поиску</span>
              )}
              {filteredCompatVehicles.map((vm) => {
                const on = (formData.compatibility_vehicle_model_ids || []).includes(vm.id);
                const b = (vm.brand && vm.brand.name) || '—';
                return (
                  <button
                    key={vm.id}
                    type="button"
                    className={`catalog-chip ${on ? 'catalog-chip-active' : ''}`}
                    onClick={() => handleToggleVehicleModel(vm.id)}
                    style={{ padding: '6px 12px', fontSize: 12 }}
                  >
                    {b} · {vm.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Категория</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {safeCategories.slice(0, 8).map((cat) => (<button key={cat} type="button" className={`catalog-chip ${formData.category === cat ? 'catalog-chip-active' : ''}`} style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => setFormData({ ...formData, category: cat })}>{cat}</button>))}
            </div>
            <input className="ios-input" list={listId} placeholder="Введите или выберите" value={formData.category || ''} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={formData.id ? { border: '1px solid var(--primary)' } : {}} />
            <datalist id={listId}>{safeCategories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Закуп (¥ юань)"
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              value={formData.cny_price}
              onChange={(e) => {
                const v = e.target.value;
                setFormData((prev) => {
                  const next = { ...prev, cny_price: v };
                  const cny = optionalNum(v);
                  const del = optionalNum(prev.delivery_cost_kzt) || 0;
                  if (cny != null && cny > 0) {
                    next.purchase_price = Number(cny) * cnyRate + del;
                  }
                  return next;
                });
              }}
              style={formData.id ? { border: '1px solid var(--primary)' } : {}}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'end', paddingBottom: 10, lineHeight: 1.45 }}>
              Доставка: 1 кг = <strong style={{ color: 'var(--text)' }}>{deliveryKztPerKg.toLocaleString('ru-RU')} ₸</strong>
              <br />
              <span style={{ fontSize: 11 }}>Меняется в «Настройки»</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Доставка (₸)"
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              value={formData.delivery_cost_kzt}
              onChange={(e) => {
                const v = e.target.value;
                setFormData((prev) => {
                  const next = { ...prev, delivery_cost_kzt: v };
                  const d = optionalNum(v);
                  if (d != null && d > 0 && deliveryKztPerKg > 0) {
                    const kg = roundKgVal(d / deliveryKztPerKg);
                    next.delivery_weight_kg = kg != null ? String(kg) : '';
                  } else if (v === '' || v == null) {
                    next.delivery_weight_kg = '';
                  }
                  const cny = optionalNum(prev.cny_price);
                  const del = optionalNum(v) || 0;
                  if (cny != null && cny > 0) {
                    next.purchase_price = Number(cny) * cnyRate + del;
                  }
                  return next;
                });
              }}
              style={formData.id ? { border: '1px solid var(--primary)' } : {}}
            />
            <Input
              label="Вес под доставку (кг)"
              type="number"
              step="0.001"
              min="0"
              placeholder="0"
              value={formData.delivery_weight_kg}
              onChange={(e) => {
                const v = e.target.value;
                setFormData((prev) => {
                  const next = { ...prev, delivery_weight_kg: v };
                  const w = optionalNum(v);
                  if (w != null && w > 0 && deliveryKztPerKg > 0) {
                    const m = roundMoneyKzt(w * deliveryKztPerKg);
                    next.delivery_cost_kzt = m != null ? String(m) : '';
                  } else if (v === '' || v == null) {
                    next.delivery_cost_kzt = '';
                  }
                  const cny = optionalNum(prev.cny_price);
                  const del = optionalNum(next.delivery_cost_kzt) || 0;
                  if (cny != null && cny > 0) {
                    next.purchase_price = Number(cny) * cnyRate + del;
                  }
                  return next;
                });
              }}
              style={formData.id ? { border: '1px solid var(--primary)' } : {}}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Закуп (₸)"
              type="number"
              step="0.01"
              min="0"
              value={formData.purchase_price ?? 0}
              onChange={(e) => setFormData({ ...formData, purchase_price: parseFloat(e.target.value) || 0 })}
              style={formData.id ? { border: '1px solid var(--primary)' } : {}}
            />
            <Input label="Продажа (₸) *" type="number" step="0.01" min="0" value={formData.sale_price || 0} onChange={(e) => setFormData({ ...formData, sale_price: parseFloat(e.target.value) || 0 })} style={formData.id ? { border: '1px solid var(--primary)' } : {}} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Input label="Поставщик" placeholder="По желанию" value={formData.supplier || ''} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} style={formData.id ? { border: '1px solid var(--primary)' } : {}} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Количество" type="number" min="0" value={formData.quantity || 0} onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 0 })} style={formData.id ? { border: '1px solid var(--primary)' } : {}} />
            <Input label="Место на складе" placeholder="А25, B87…" value={formData.storage_location || ''} onChange={(e) => setFormData({ ...formData, storage_location: e.target.value.toUpperCase() })} style={formData.id ? { border: '1px solid var(--primary)' } : {}} />
          </div>

          <TextArea label="Доп. информация" placeholder="По желанию" value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />

          <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-ios)', background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Прибыль:{' '}
            <span
              style={{
                color: parseFloat(profitPreview) < 0 ? 'var(--danger)' : parseFloat(profitPreview) >= 50 ? 'var(--success)' : '#d97706',
                fontSize: 16,
              }}
            >
              {profitPreview}%
            </span>
            <span style={{ fontWeight: 500, fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>
              · закуп для расчёта: {Math.round(effPurchasePreview).toLocaleString('ru-RU')} ₸
              {(optionalNum(formData.cny_price) || 0) > 0 && num(formData.purchase_price) <= 0 && (
                <span> (из ¥ × курс {cnyRate})</span>
              )}
            </span>
          </div>
        </form>
      </Modal>

      {/* ── Label Print ── */}
      <LabelPrint
        isOpen={showPrint}
        onClose={() => { setShowPrint(false); setPrintProduct(null); }}
        product={printProduct}
        settings={settingsRow}
        initialLabelType={printType}
        labelSize={settingsRow?.label_size || 'small'}
      />
    </div>
  );
};

export default Products;
