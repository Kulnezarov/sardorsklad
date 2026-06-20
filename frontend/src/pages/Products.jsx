import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus, FiEdit2, FiTrash2, FiSearch, FiAlertTriangle,
  FiImage, FiGrid, FiList, FiShoppingCart, FiRefreshCw,
  FiTag, FiUpload, FiDownload, FiX, FiLoader, FiClock, FiPackage, FiGlobe,
} from 'react-icons/fi';
import { Button, Modal, Input, TextArea, LoadingSpinner, Alert } from '../components/ui';
import { productApi, resolveUploadedAssetUrl, compatibilityApi, categoryApi, getApiErrorMessage } from '../api/client';
import CategoryPicker, { findGroupIdForCategory, findCategoryInTree } from '../components/CategoryPicker';
import ProductFormByLayout from '../components/ProductFormByLayout';
import ProductStockFormSection from '../components/ProductStockFormSection';
import { priceLayoutRows, resolveCategorySchemaForProduct, categoryTreeQueryKey } from '../utils/formLayoutUtils';
import ProductFormSection, { ProductFormTemplateBadge } from '../components/ProductFormSection';
import FormAccordionSection from '../components/FormAccordionSection';
import VehicleCompatibilityPicker from '../components/VehicleCompatibilityPicker';
import EngineFamilyPicker from '../components/EngineFamilyPicker';
import ProductFormProgress from '../components/ProductFormProgress';
import ProductStorefrontPreview from '../components/ProductStorefrontPreview';
import { formatAttributePreview } from '../components/CategoryAttributeFields';
import { compatibilityLabelsFromProduct, syncPrimaryVehicleFromSelection } from '../utils/productDisplayUtils';
import { buildProductFormProgress } from '../utils/productFormProgress';
import { buildStorefrontPreview, formatCompatibilityTableCell } from '../utils/storefrontPreview';
import { readStoredLabelLayout } from '../utils/labelPrintUtils';
import { importExcelStream } from '../api/importExcelStream';
import { settingsApi } from '../api/settings';
import { generateEAN13 } from '../utils/barcodeGen';
import { productMatchesSearch } from '../utils/smartSearch';
import LabelPrint from '../components/LabelPrint';
import SkuConflictModal from '../components/SkuConflictModal';
import SkuMatchBanner from '../components/SkuMatchBanner';
import { applyCatalogProductTemplate, applyWarehouseFormTemplate } from '../utils/productTemplateCopy';
import BulkCategoryUpdateModal from '../components/BulkCategoryUpdateModal';
import ProductImageLightbox from '../components/ProductImageLightbox';
import JsBarcode from 'jsbarcode';

const MAX_PRODUCT_PHOTOS = 12;

function normalizeProductGallery(p) {
  const raw = Array.isArray(p?.image_urls) ? p.image_urls : [];
  const urls = [...new Set(raw.map((u) => String(u || '').split('?')[0].trim()).filter(Boolean))];
  const legacy = String(p?.image_url || '').split('?')[0].trim();
  if (!urls.length && legacy) return [legacy];
  return urls;
}

function basenameFromProductImageUrl(url) {
  const base = String(url || '').split('?')[0].trim();
  return base.split('/').pop() || '';
}

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

function normalizeVehicleField(raw) {
  const cleaned = String(raw || '')
    .replace(/[,+/;]+/g, ' ')
    .replace(/[^0-9A-Za-zА-Яа-яЁё\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9-]{2,}$/.test(part)) return part;
      if (/^[А-ЯЁ0-9-]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function pickPrimaryVehicleToken(raw) {
  const normalized = normalizeVehicleField(raw);
  if (!normalized) return '';
  return normalized.split(/[ ,]+/).filter(Boolean)[0] || '';
}

function splitVehicleModels(raw) {
  const normalized = normalizeVehicleField(raw);
  if (!normalized) return [];
  return normalized.split(/[ ,]+/).map((x) => x.trim()).filter(Boolean);
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

const EMPTY_COMPAT_IDS = Object.freeze([]);

const STOREFRONT_PREVIEW_HIDDEN_KEY = 'skladpro:hide_storefront_preview';

const emptyForm = () => ({
  id: null, name: '', sku: '', barcode: '', brand: '', model: '', category: '',
  category_id: null, category_group_id: null, attributes: {},
  purchase_price: 0, sale_price: 0, cny_price: '', delivery_cost_kzt: '', delivery_weight_kg: '',
  quantity: 0, min_quantity: 0, description: '', supplier: '', storage_location: '',
  image_url: '',
  show_on_storefront: true,
  engine_code_id: null,
  compatibility_vehicle_model_ids: [],
  compatibility_engine_family_ids: [],
  image_urls: [],
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
  const vms = formData.compatibility_vehicle_model_ids || [];
  const efs = formData.compatibility_engine_family_ids || [];
  return {
    id: formData.id ?? null,
    name: formData.name.trim(),
    sku: skuTrim || undefined,
    barcode: formData.barcode?.trim() || null,
    brand: normalizeVehicleField(formData.brand) || null,
    model: normalizeVehicleField(formData.model) || null,
    category: formData.category?.trim() || null,
    category_id: formData.category_id || null,
    attributes: Object.keys(formData.attributes || {}).length ? formData.attributes : null,
    description: formData.description?.trim() || null,
    supplier: formData.supplier?.trim() || null,
    engine_code_id: null,
    location_zone: formData.storage_location?.trim() || null,
    purchase_price: purchase,
    sale_price: num(formData.sale_price),
    cny_price: cny,
    delivery_cost_kzt: optionalNum(formData.delivery_cost_kzt),
    delivery_weight_kg: optionalNum(formData.delivery_weight_kg),
    quantity: parseInt(formData.quantity, 10) || 0,
    min_quantity: parseInt(formData.min_quantity, 10) || 0,
    show_on_storefront: formData.show_on_storefront !== false,
    ...(formData.id
      ? {
          compatibility_vehicle_model_ids: vms,
          compatibility_engine_family_ids: efs,
        }
      : {
          ...(vms.length ? { compatibility_vehicle_model_ids: vms } : {}),
          ...(efs.length ? { compatibility_engine_family_ids: efs } : {}),
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

function isLegacyProduct(p) {
  return Boolean(p?.is_legacy_category || p?.needs_category_refresh);
}

const PRODUCTS_VIEW_KEY = 'skladpro_products_view';

function readProductsViewMode() {
  try {
    const v = localStorage.getItem(PRODUCTS_VIEW_KEY);
    return v === 'grid' ? 'grid' : 'table';
  } catch {
    return 'table';
  }
}

function formatKztGrid(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
}

function formatSidePurchaseYuan(product) {
  const cny = optionalNum(product?.cny_price);
  return cny != null && cny > 0 ? `${cny} ¥` : '—';
}

function formatSidePurchaseKztHint(product) {
  const pp = Number(product?.purchase_price) || 0;
  return pp > 0 ? `≈ ${pp.toLocaleString('ru-RU')} ₸ с доставкой` : null;
}

function ProductsViewToggle({ viewMode, onChange }) {
  return (
    <div className="intake-view-toggle" role="group" aria-label="Вид каталога">
      <button
        type="button"
        className={`intake-view-btn${viewMode === 'table' ? ' intake-view-btn-active' : ''}`}
        onClick={() => onChange('table')}
        title="Таблица"
      >
        <FiList size={16} />
        <span>Таблица</span>
      </button>
      <button
        type="button"
        className={`intake-view-btn${viewMode === 'grid' ? ' intake-view-btn-active' : ''}`}
        onClick={() => onChange('grid')}
        title="Сетка"
      >
        <FiGrid size={16} />
        <span>Сетка</span>
      </button>
    </div>
  );
}

const ProductGridCard = React.memo(function ProductGridCard({
  product,
  onOpen,
  onEdit,
  onPrint,
  onToggleStorefront,
  onZoomPhoto,
  storefrontPending,
}) {
  const clickTimerRef = useRef(null);
  const thumb = normalizeProductGallery(product)[0];
  const thumbSrc = thumb ? resolveUploadedAssetUrl(thumb) : null;
  const qty = Number(product.quantity) || 0;
  const onSite = product.show_on_storefront !== false;
  const compatCell = formatCompatibilityTableCell(product);
  const catColor = getCatColor(product.category);

  const handleCardClick = useCallback(() => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onOpen();
    }, 220);
  }, [onOpen]);

  const handleCardDoubleClick = useCallback((e) => {
    e.preventDefault();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onEdit();
  }, [onEdit]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const handlePhotoClick = useCallback((e) => {
    e.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (thumbSrc) onZoomPhoto?.(product, 0);
  }, [thumbSrc, onZoomPhoto, product]);

  return (
    <div className="product-grid-card" title="Один клик — открыть · двойной — редактировать">
      <div
        className={`product-grid-card__media${thumbSrc ? ' product-grid-card__media--zoomable' : ''}`}
        onClick={handleCardClick}
        onDoubleClick={handleCardDoubleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt="" loading="lazy" onClick={handlePhotoClick} />
        ) : (
          <FiPackage size={28} />
        )}
        <button
          type="button"
          className={`product-grid-card__chparts${onSite ? ' product-grid-card__chparts--on' : ''}`}
          title={onSite ? 'На витрине — нажмите, чтобы скрыть' : 'Скрыто с сайта — нажмите, чтобы показать'}
          disabled={storefrontPending}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStorefront(product);
          }}
        >
          <FiGlobe size={12} />
          <span>{onSite ? 'CHPARTS' : 'Скрыто'}</span>
        </button>
      </div>
      <div
        className="product-grid-card__body"
        onClick={handleCardClick}
        onDoubleClick={handleCardDoubleClick}
        role="presentation"
      >
        <div className="product-grid-card__title-row">
          <div className="product-grid-card__name">{product.name || 'Без названия'}</div>
          <div className="product-grid-card__codes">
            {product.barcode ? <span title="Штрих-код">{product.barcode}</span> : null}
            {product.sku ? <span title="Артикул">{product.sku}</span> : null}
            {!product.barcode && !product.sku ? <span className="product-grid-card__muted">—</span> : null}
          </div>
        </div>
        <div className="product-grid-card__brand-row">
          {product.brand ? <span className="product-grid-card__brand">{product.brand}</span> : null}
          {compatCell ? (
            <span
              className="product-grid-card__compat"
              title={compatCell.extra > 0 ? `Ещё ${compatCell.extra} совместимостей` : compatCell.primary}
            >
              <span aria-hidden>🚗</span>
              <span>{compatCell.primary}</span>
              {compatCell.extra > 0 ? (
                <span className="product-grid-card__compat-extra">+{compatCell.extra}</span>
              ) : null}
            </span>
          ) : null}
          {!product.brand && !compatCell ? <span className="product-grid-card__muted">—</span> : null}
        </div>
        <div className="product-grid-card__category">
          {product.category ? (
            <span
              className="product-grid-card__cat-pill"
              style={{ background: catColor.bg, color: catColor.color }}
            >
              {product.category}
            </span>
          ) : (
            <span className="product-grid-card__muted">—</span>
          )}
        </div>
        <div className="product-grid-card__prices">
          <div className="product-grid-card__price-box">
            <span className="product-grid-card__price-label">Закуп</span>
            <span className="product-grid-card__price-val">{formatKztGrid(product.purchase_price)}</span>
          </div>
          <div className="product-grid-card__price-box product-grid-card__price-box--sale">
            <span className="product-grid-card__price-label">Продажа</span>
            <span className="product-grid-card__price-val">{formatKztGrid(product.sale_price)}</span>
          </div>
        </div>
        <div className="product-grid-card__stock">
          <div className="product-grid-card__stock-item">
            <span className="product-grid-card__price-label">Место</span>
            <span className="product-grid-card__stock-val">{product.location_zone || '—'}</span>
          </div>
          <div className="product-grid-card__stock-item">
            <span className="product-grid-card__price-label">Остаток</span>
            <span
              className={`product-grid-card__qty${
                qty === 0 ? ' product-grid-card__qty--zero' : qty <= 5 ? ' product-grid-card__qty--low' : ' product-grid-card__qty--ok'
              }`}
            >
              {qty} шт
            </span>
          </div>
        </div>
      </div>
      <div className="product-grid-card__foot">
        <button
          type="button"
          className="product-grid-card__label-btn"
          title="Этикетка"
          onClick={(e) => {
            e.stopPropagation();
            onPrint(product, e);
          }}
        >
          <FiTag size={14} />
        </button>
        <button
          type="button"
          className="product-grid-card__open-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          Открыть товар
        </button>
      </div>
    </div>
  );
});

/* ── component ── */
const Products = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [legacyOnlyFilter, setLegacyOnlyFilter] = useState(false);
  const [needsRefreshFilter, setNeedsRefreshFilter] = useState(false);
  const [showStale, setShowStale] = useState(false);
  /** '' = все, 'on' = на витрине, 'off' = скрыто с сайта */
  const [storefrontFilter, setStorefrontFilter] = useState('');
  const [viewMode, setViewMode] = useState(readProductsViewMode);

  const [showForm, setShowForm] = useState(false);
  const [forceCreateMode, setForceCreateMode] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [duplicateBarcodeProduct, setDuplicateBarcodeProduct] = useState(null);
  const [duplicateBarcodeValue, setDuplicateBarcodeValue] = useState('');
  const [skuConflictOpen, setSkuConflictOpen] = useState(false);
  const [skuConflictExisting, setSkuConflictExisting] = useState(null);
  const [skuConflictSku, setSkuConflictSku] = useState('');
  const [skuConflictPayload, setSkuConflictPayload] = useState(null);
  const skuOpenAfterSaveRef = useRef(null);
  const [skuTemplateProduct, setSkuTemplateProduct] = useState(null);
  const [skuTemplateLoading, setSkuTemplateLoading] = useState(false);
  const skuTemplateDismissedRef = useRef('');
  const templateGallerySourceIdRef = useRef(null);
  const [barcodeLocked, setBarcodeLocked] = useState(false);
  /** Редактирование: смена категории тем же экраном, что при создании */
  const [changeCategoryMode, setChangeCategoryMode] = useState(false);
  /** Диалог подтверждения сброса характеристик при смене категории */
  const [confirmCategoryChange, setConfirmCategoryChange] = useState(null); // { groupId, categoryId, applyChange }
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Ошибки конкретных полей формы (из клиентской валидации или 422) */
  const [fieldErrors, setFieldErrors] = useState({});

  const [sideProduct, setSideProduct] = useState(null);
  const [sideProductDetail, setSideProductDetail] = useState(null);
  const [sideProductLoading, setSideProductLoading] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);

  const [showPrint, setShowPrint] = useState(false);
  const [printProduct, setPrintProduct] = useState(null);
  const [deliveryMode, setDeliveryMode] = useState('normal');
  const [customDeliveryRate, setCustomDeliveryRate] = useState('800');
  const [showPrintSuggest, setShowPrintSuggest] = useState(false);
  const [savedProduct, setSavedProduct] = useState(null);
  /** Пикер совместимости: свой key + снимок ids при открытии (не синхронизируем обратно при каждом клике) */
  const [compatPickerKey, setCompatPickerKey] = useState(0);
  const [compatInitialIds, setCompatInitialIds] = useState(EMPTY_COMPAT_IDS);
  const resetCompatPicker = useCallback((ids = EMPTY_COMPAT_IDS) => {
    setCompatInitialIds(ids?.length ? [...ids] : EMPTY_COMPAT_IDS);
    setCompatPickerKey((k) => k + 1);
  }, []);
  const [enginePickerKey, setEnginePickerKey] = useState(0);
  const [engineInitialIds, setEngineInitialIds] = useState(EMPTY_COMPAT_IDS);
  const resetEnginePicker = useCallback((ids = EMPTY_COMPAT_IDS) => {
    setEngineInitialIds(ids?.length ? [...ids] : EMPTY_COMPAT_IDS);
    setEnginePickerKey((k) => k + 1);
  }, []);

  const [imageUploading, setImageUploading] = useState(false);
  /** 0–100 во время upload; null когда не качаем */
  const [imageUploadPct, setImageUploadPct] = useState(null);
  const [imagePreviewBust, setImagePreviewBust] = useState(0);
  /** Мгновенное превью выбранного файла до ответа сервера */
  const [imageBlobUrl, setImageBlobUrl] = useState('');
  const [galleryFocusIdx, setGalleryFocusIdx] = useState(0);
  const [storefrontPreviewHidden, setStorefrontPreviewHidden] = useState(() => {
    try {
      return localStorage.getItem(STOREFRONT_PREVIEW_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  const hideStorefrontPreview = useCallback(() => {
    setStorefrontPreviewHidden(true);
    try {
      localStorage.setItem(STOREFRONT_PREVIEW_HIDDEN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const showStorefrontPreview = useCallback(() => {
    setStorefrontPreviewHidden(false);
    try {
      localStorage.removeItem(STOREFRONT_PREVIEW_HIDDEN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const [importReport, setImportReport] = useState(null);
  const [importOverlay, setImportOverlay] = useState(null);
  const [importError, setImportError] = useState('');

  const [scanNotFound, setScanNotFound] = useState(null); // scanned barcode string when not found
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    name: '',
    brand: '',
    model: '',
    purchase_price: '',
    sale_price: '',
    quantity: '',
  });

  const importAbortRef = useRef(null);
  const searchWrapRef = useRef(null);
  const importFileRef = useRef(null);
  const barcodeCanvasRef = useRef(null);
  const formRef = useRef(formData);
  const undoSnapshotRef = useRef(null);
  const productsRef = useRef([]);
  const scanBufRef = useRef('');
  const scanLastRef = useRef(0);
  const tableScrollRef = useRef(null);
  const chromeRef = useRef(null);
  const gridLoadSentinelRef = useRef(null);
  const lastGridScrollTopRef = useRef(0);
  const queryClient = useQueryClient();

  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportH, setTableViewportH] = useState(480);
  const [gridChromeHidden, setGridChromeHidden] = useState(false);
  const [chromeHeight, setChromeHeight] = useState(0);
  const [lightboxState, setLightboxState] = useState(null);
  const [sidePhotoIdx, setSidePhotoIdx] = useState(0);

  useEffect(() => { formRef.current = formData; }, [formData]);

  useEffect(() => {
    try {
      localStorage.setItem(PRODUCTS_VIEW_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  // ── Черновик в sessionStorage ──
  const DRAFT_KEY = 'skladpro:product-draft:new';
  const saveDraft = useCallback((data) => {
    try {
      if (!data || data.id) return; // только для нового товара
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, _savedAt: Date.now() }));
    } catch { /* ignore quota errors */ }
  }, []);
  const loadDraft = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // TTL 24ч
      if (Date.now() - (parsed._savedAt || 0) > 86400000) {
        sessionStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return parsed;
    } catch { return null; }
  }, []);
  const clearDraft = useCallback(() => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  // Автосохранение черновика при изменении формы нового товара
  useEffect(() => {
    if (!showForm || formData.id) return;
    const t = setTimeout(() => saveDraft(formData), 500);
    return () => clearTimeout(t);
  }, [formData, showForm, saveDraft]);

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
  const settingsDeliveryRate = Number(settingsRow?.delivery_kzt_per_kg) || 800;
  const deliveryKztPerKg = useMemo(() => {
    if (deliveryMode === 'express') return 2000;
    if (deliveryMode === 'custom') return Math.max(0.01, Number(customDeliveryRate) || 0.01);
    return settingsDeliveryRate;
  }, [deliveryMode, customDeliveryRate, settingsDeliveryRate]);

  const { data: categoryTree = [] } = useQuery({
    queryKey: categoryTreeQueryKey(true),
    queryFn: () => categoryApi.getTree({ active_only: true }).then((r) => r.data),
    staleTime: 120000,
  });

  const selectedSubcategorySchema = useMemo(
    () => resolveCategorySchemaForProduct(findCategoryInTree(categoryTree, formData.category_id)),
    [categoryTree, formData.category_id],
  );

  const layoutPriceRows = useMemo(
    () => priceLayoutRows(selectedSubcategorySchema || {}),
    [selectedSubcategorySchema],
  );

  const selectedCategoryPath = useMemo(() => {
    if (!formData.category_id) return '';
    const sub = findCategoryInTree(categoryTree, formData.category_id);
    const group = categoryTree.find((g) => g.id === formData.category_group_id);
    if (group && sub) return `${group.name} → ${sub.name}`;
    return sub?.name || '';
  }, [categoryTree, formData.category_id, formData.category_group_id]);

  const selectedCategoryGroup = useMemo(() => {
    if (formData.category_group_id) {
      return categoryTree.find((g) => g.id === formData.category_group_id) || null;
    }
    if (formData.category_id) {
      return categoryTree.find((g) => (g.children || []).some((c) => c.id === formData.category_id)) || null;
    }
    return null;
  }, [categoryTree, formData.category_group_id, formData.category_id]);

  const selectedSubcategory = useMemo(
    () => findCategoryInTree(categoryTree, formData.category_id),
    [categoryTree, formData.category_id],
  );

  const isEditingProduct = Boolean(formData.id);
  const categoryChosen = Boolean(formData.category_id);
  const showCategoryStep =
    (!isEditingProduct && !categoryChosen) ||
    changeCategoryMode ||
    (isEditingProduct && !categoryChosen);
  const showFillStep = categoryChosen && !changeCategoryMode;

  const handleCategoryChange = ({ groupId, categoryId }) => {
    const sub = findCategoryInTree(categoryTree, categoryId);
    const catChanged = categoryId && categoryId !== formData.category_id;
    const hasAttrs = catChanged && formData.category_id && Object.keys(formData.attributes || {}).length > 0;

    const applyChange = () => {
      setFormData((prev) => ({
        ...prev,
        category_group_id: groupId,
        category_id: categoryId || null,
        category: sub?.name || prev.category,
        attributes: catChanged && prev.category_id ? {} : (prev.attributes || {}),
        compatibility_vehicle_model_ids: catChanged && prev.category_id ? [] : prev.compatibility_vehicle_model_ids,
        compatibility_engine_family_ids: catChanged && prev.category_id ? [] : prev.compatibility_engine_family_ids,
        brand: catChanged && prev.category_id ? '' : prev.brand,
        model: catChanged && prev.category_id ? '' : prev.model,
      }));
      if (catChanged) {
        resetCompatPicker([]);
        resetEnginePicker([]);
      }
      if (categoryId) setChangeCategoryMode(false);
    };

    if (hasAttrs && isEditingProduct) {
      // Показать диалог подтверждения
      setConfirmCategoryChange({ groupId, categoryId, applyChange });
    } else {
      applyChange();
    }
  };

  const handleResetCategory = () => {
    setFormData((prev) => ({
      ...prev,
      category_id: null,
      category_group_id: null,
      attributes: {},
    }));
    setChangeCategoryMode(false);
  };

  const handleRequestCategoryChange = () => {
    if (isEditingProduct) setChangeCategoryMode(true);
    else handleResetCategory();
  };

  const { data: vehicleBrands = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-brands'],
    queryFn: () => compatibilityApi.vehicleBrands().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: vehicleModels = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-models'],
    queryFn: () => compatibilityApi.vehicleModels().then((r) => r.data),
    staleTime: 60000,
  });

  useEffect(() => {
    if (!formData.category_id || formData.category_group_id || !categoryTree.length) return;
    const gid = findGroupIdForCategory(categoryTree, formData.category_id);
    if (gid) setFormData((prev) => ({ ...prev, category_group_id: gid }));
  }, [categoryTree, formData.category_id, formData.category_group_id]);

  const handleCompatibilityChange = useCallback((ids) => {
    const idList = Array.isArray(ids) ? ids : [];
    setFormData((fd) => {
      const selected = (vehicleModels || []).filter((m) => idList.includes(m.id));
      return syncPrimaryVehicleFromSelection(
        { ...fd, compatibility_vehicle_model_ids: idList },
        selected,
      );
    });
  }, [vehicleModels]);

  const showCompatibilityPicker = useMemo(() => {
    const vm = selectedSubcategorySchema?.vehicle_mode;
    const liquidsGroup = /жидкост/i.test(selectedCategoryGroup?.name || '');
    return !liquidsGroup || vm !== 'none';
  }, [selectedCategoryGroup?.name, selectedSubcategorySchema?.vehicle_mode]);

  const showEngineFamilyPicker = useMemo(
    () => selectedSubcategorySchema?.engine_code_mode === 'required',
    [selectedSubcategorySchema?.engine_code_mode],
  );

  const formProgress = useMemo(() => buildProductFormProgress({
    formData,
    schema: selectedSubcategorySchema,
    showCompatibility: showCompatibilityPicker,
    showEngineFamilies: showEngineFamilyPicker,
  }), [formData, selectedSubcategorySchema, showCompatibilityPicker, showEngineFamilyPicker]);

  const storefrontPreview = useMemo(() => buildStorefrontPreview({
    formData,
    schema: selectedSubcategorySchema,
    categoryName: selectedSubcategory?.name || formData.category || '',
    vehicleModels,
    compatibilityIds: formData.compatibility_vehicle_model_ids,
  }), [formData, selectedSubcategorySchema, selectedSubcategory?.name, vehicleModels]);

  const handleEngineFamilyChange = useCallback((ids) => {
    const idList = Array.isArray(ids) ? ids : [];
    setFormData((fd) => ({ ...fd, compatibility_engine_family_ids: idList }));
  }, []);

  const compatibilityPickerSlot = useMemo(() => {
    if (!showCompatibilityPicker) return null;
    return (
      <VehicleCompatibilityPicker
        key={`compat-${compatPickerKey}`}
        initialSelectedIds={compatInitialIds}
        brands={vehicleBrands}
        models={vehicleModels}
        onChange={handleCompatibilityChange}
      />
    );
  }, [
    showCompatibilityPicker,
    compatPickerKey,
    compatInitialIds,
    vehicleBrands,
    vehicleModels,
    handleCompatibilityChange,
  ]);

  const engineCompatibilitySlot = useMemo(() => {
    if (!showEngineFamilyPicker) return null;
    return (
      <EngineFamilyPicker
        key={`engine-${enginePickerKey}`}
        initialSelectedIds={engineInitialIds}
        vehicleModelIds={formData.compatibility_vehicle_model_ids || []}
        onChange={handleEngineFamilyChange}
      />
    );
  }, [
    showEngineFamilyPicker,
    enginePickerKey,
    engineInitialIds,
    formData.compatibility_vehicle_model_ids,
    handleEngineFamilyChange,
  ]);

  // openVoiceAdd: открыть форму нового товара (как «Добавить»)
  // openAdd + barcode: со страницы продаж
  useEffect(() => {
    if (location.state?.openVoiceAdd) {
      setImageBlobUrl((p) => {
        if (p) URL.revokeObjectURL(p);
        return '';
      });
      setFormData({ ...emptyForm(), barcode: generateEAN13() });
      setFormError(''); setBarcodeLocked(false); setShowForm(true);
      setForceCreateMode(true);
      navigate(location.pathname, { replace: true, state: {} });
    } else if (location.state?.openAdd) {
      setImageBlobUrl((p) => {
        if (p) URL.revokeObjectURL(p);
        return '';
      });
      const bc = location.state.barcode || '';
      setFormData({ ...emptyForm(), barcode: bc });
      setFormError(''); setBarcodeLocked(Boolean(bc)); setShowForm(true);
      setForceCreateMode(true);
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
    queryKey: ['products', search, selectedCategory, selectedCategoryId, legacyOnlyFilter, storefrontFilter],
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const r = await productApi.getAll({
          search: search || undefined,
          category: selectedCategoryId ? undefined : (selectedCategory || undefined),
          category_id: selectedCategoryId || undefined,
          legacy_only: legacyOnlyFilter ? true : undefined,
          show_on_storefront:
            storefrontFilter === 'on' ? true : storefrontFilter === 'off' ? false : undefined,
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
    const q = searchInput.trim();
    if (!q) return [];
    const seen = new Set();
    const results = [];
    const allProducts = productsRef.current.length ? productsRef.current : products;
    for (const p of allProducts) {
      if (results.length >= 6) break;
      if (!productMatchesSearch(p, q)) continue;
      const label = p.name || p.brand || p.model;
      if (!label) continue;
      const key = String(label).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ label, type: 'Товар' });
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
    if (!pid) return;
    const found = products.find((x) => String(x.id) === pid);
    if (found) {
      setSideProduct(found);
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev);
        n.delete('product');
        return n;
      }, { replace: true });
      return;
    }
    if (!products.length) return;
    let cancelled = false;
    productApi.getById(pid)
      .then(({ data }) => {
        if (!cancelled && data) {
          setSideProduct(data);
          setSearchParams((prev) => {
            const n = new URLSearchParams(prev);
            n.delete('product');
            return n;
          }, { replace: true });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [products, searchParams, setSearchParams]);

  useEffect(() => {
    if (!sideProduct?.id) {
      setSideProductDetail(null);
      setSideProductLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSideProductLoading(true);
    productApi.getById(sideProduct.id)
      .then(({ data }) => {
        if (!cancelled) setSideProductDetail({ ...sideProduct, ...data });
      })
      .catch(() => {
        if (!cancelled) setSideProductDetail(sideProduct);
      })
      .finally(() => {
        if (!cancelled) setSideProductLoading(false);
      });
    return () => { cancelled = true; };
  }, [sideProduct?.id]);

  const sidePanelProduct = sideProductDetail || sideProduct;

  const openProductLightbox = useCallback((product, index = 0) => {
    const urls = normalizeProductGallery(product);
    if (!urls.length) return;
    setLightboxState({
      urls,
      index: Math.min(Math.max(0, index), urls.length - 1),
      title: product?.name || '',
    });
  }, []);

  useEffect(() => {
    setSidePhotoIdx(0);
  }, [sideProduct?.id]);

  const displayProducts = useMemo(() => {
    let list = showStale ? products.filter(isStale) : products;
    if (needsRefreshFilter) {
      list = list.filter((p) => p.needs_category_refresh || p.is_legacy_category);
    }
    return list;
  }, [products, showStale, needsRefreshFilter]);

  const needsRefreshCount = useMemo(
    () => products.filter((p) => p.needs_category_refresh || p.is_legacy_category).length,
    [products],
  );

  const storefrontOnCount = useMemo(
    () => products.filter((p) => p.show_on_storefront !== false).length,
    [products],
  );

  const toggleStorefrontMutation = useMutation({
    mutationFn: ({ id, value }) => productApi.update(id, { show_on_storefront: value }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(vars.value ? 'Товар на витрине' : 'Скрыто с сайта');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Не удалось обновить витрину')),
  });

  const bulkStorefrontMutation = useMutation({
    mutationFn: ({ ids, value }) => productApi.setStorefrontBulk(ids, value),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedIds([]);
      toast.success(vars.value ? 'Выбранные на витрине' : 'Выбранные скрыты с сайта');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Массовое обновление не удалось')),
  });

  const publishAllStorefrontMutation = useMutation({
    mutationFn: () => productApi.publishAllToStorefront(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const n = res?.data?.updated ?? 0;
      toast.success(`На сайте: все активные (${n})`);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Не удалось включить все товары')),
  });

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

  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return undefined;
    const measure = () => setChromeHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const resetCatalogScroll = useCallback(() => {
    const el = tableScrollRef.current;
    if (el) el.scrollTop = 0;
    setTableScrollTop(0);
    setGridChromeHidden(false);
    lastGridScrollTopRef.current = 0;
  }, []);

  const handleCatalogScroll = useCallback((e) => {
    const st = e.currentTarget.scrollTop;
    if (viewMode === 'table') {
      setTableScrollTop(st);
      return;
    }
    const delta = st - lastGridScrollTopRef.current;
    if (st < 24) {
      setGridChromeHidden(false);
    } else if (delta > 8) {
      setGridChromeHidden(true);
    } else if (delta < -8) {
      setGridChromeHidden(false);
    }
    lastGridScrollTopRef.current = st;
  }, [viewMode]);

  useEffect(() => {
    resetCatalogScroll();
  }, [
    showStale,
    selectedCategory,
    selectedCategoryId,
    legacyOnlyFilter,
    needsRefreshFilter,
    search,
    storefrontFilter,
    viewMode,
    resetCatalogScroll,
  ]);

  useEffect(() => {
    if (viewMode !== 'grid' || !hasNextPage) return undefined;
    const root = tableScrollRef.current;
    const sentinel = gridLoadSentinelRef.current;
    if (!root || !sentinel) return undefined;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root, rootMargin: '600px 0px', threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [viewMode, hasNextPage, isFetchingNextPage, fetchNextPage, displayProducts.length]);

  /* mutations */
  const saveMutation = useMutation({
    mutationFn: (payload) => {
      if (payload?._forceCreate) {
        const body = { ...payload };
        delete body.id;
        delete body._forceCreate;
        return productApi.create(body);
      }
      // payload.id can be intentionally null for "create new from scanned barcode".
      // Do not fallback to formRef.current.id in that case.
      const hasOwnId = Object.prototype.hasOwnProperty.call(payload || {}, 'id');
      const id = hasOwnId ? payload.id : formRef.current?.id;
      const body = { ...payload };
      delete body.id;
      delete body._forceCreate;
      return id ? productApi.update(id, body) : productApi.create(body);
    },
    onSuccess: (res, vars) => {
      const wasEdit = Boolean(vars?.id) && !vars?._forceCreate;
      const undoPayload = undoSnapshotRef.current;
      undoSnapshotRef.current = null;

      const showUndoToast = () => {
        if (!wasEdit || !undoPayload || !vars?.id) {
          toast.success(wasEdit ? '✓ Товар обновлён' : '✓ Товар создан');
          return;
        }
        toast(
          (t) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              ✓ Товар обновлён
              <button
                type="button"
                onClick={async () => {
                  toast.dismiss(t.id);
                  try {
                    const body = { ...undoPayload };
                    delete body.id;
                    await productApi.update(vars.id, body);
                    queryClient.invalidateQueries({ queryKey: ['products'] });
                    toast.success('Изменение отменено');
                  } catch (err) {
                    toast.error(getApiErrorMessage(err, 'Не удалось отменить'));
                  }
                }}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Отменить
              </button>
            </span>
          ),
          { duration: 8000 },
        );
      };

      showUndoToast();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      const openAfter = skuOpenAfterSaveRef.current;
      skuOpenAfterSaveRef.current = null;
      setDuplicateBarcodeProduct(null);
      setDuplicateBarcodeValue('');
      templateGallerySourceIdRef.current = null;
      if (openAfter?.id) {
        resetForm();
        handleEdit(openAfter);
        return;
      }
      clearDraft();
      if (!wasEdit && res.data) { setSavedProduct(res.data); setShowPrintSuggest(true); }
      if (saveAndAddMore && !wasEdit) {
        // Оставить категорию и цены, сбросить sku/barcode/qty/название
        setSaveAndAddMore(false);
        setFormData((prev) => ({
          ...prev,
          id: null,
          name: '',
          sku: '',
          barcode: generateEAN13(),
          quantity: 0,
          min_quantity: 0,
          image_url: '',
          image_urls: [],
          description: '',
        }));
        setBarcodeLocked(false);
        setForceCreateMode(true);
        setFormError('');
        setFieldErrors({});
        toast.success('Товар сохранён — добавьте следующий');
        return;
      }
      if (saveAndStay && wasEdit) {
        setSaveAndStay(false);
        if (res?.data) {
          setFormData((prev) => ({
            ...prev,
            ...res.data,
            cny_price: res.data.cny_price != null ? String(res.data.cny_price) : prev.cny_price,
            delivery_cost_kzt: res.data.delivery_cost_kzt != null ? String(res.data.delivery_cost_kzt) : prev.delivery_cost_kzt,
            delivery_weight_kg: res.data.delivery_weight_kg != null ? String(res.data.delivery_weight_kg) : prev.delivery_weight_kg,
          }));
        }
        return;
      }
      setSaveAndAddMore(false);
      setSaveAndStay(false);
      resetForm();
    },
    onError: async (err, vars) => {
      const detail = err.response?.data?.detail;
      const detailMessage =
        detail && typeof detail === 'object' && !Array.isArray(detail)
          ? (detail.message || detail.msg || '')
          : '';
      const message = typeof detail === 'string'
        ? detail
        : detailMessage
          ? String(detailMessage)
        : Array.isArray(detail)
          ? detail.map((x) => `${x?.loc?.join?.('.') || 'field'}: ${x?.msg || 'invalid'}`).join('; ')
          : 'Ошибка при сохранении товара';
      const duplicateId =
        detail && typeof detail === 'object' && !Array.isArray(detail)
          ? Number(detail.product_id)
          : NaN;
      const isBarcodeDuplicate =
        (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.code === 'BARCODE_EXISTS')
        || /barcode.*already exists/i.test(message)
        || /уже существует/i.test(message);
      if (isBarcodeDuplicate) {
        if (Number.isInteger(duplicateId) && duplicateId > 0) {
          try {
            const byId = await productApi.getById(duplicateId);
            setDuplicateBarcodeProduct(byId?.data || null);
            setDuplicateBarcodeValue(String(byId?.data?.barcode || vars?.barcode || formRef.current?.barcode || '').trim());
          } catch {
            setDuplicateBarcodeProduct(null);
            setDuplicateBarcodeValue(String(vars?.barcode || formRef.current?.barcode || '').trim());
          }
        } else {
          const candidateBarcode = String(vars?.barcode || formRef.current?.barcode || '').trim();
          if (!candidateBarcode) {
            setDuplicateBarcodeProduct(null);
            setDuplicateBarcodeValue('');
          } else {
            setDuplicateBarcodeValue(candidateBarcode);
            try {
              const r = await productApi.getByBarcode(candidateBarcode, {
                allow404: true,
                includeInactive: true,
              });
              setDuplicateBarcodeProduct(r?.status === 200 && r?.data ? r.data : null);
            } catch {
              setDuplicateBarcodeProduct(null);
            }
          }
        }
      } else {
        setDuplicateBarcodeProduct(null);
        setDuplicateBarcodeValue('');
      }
      const isSkuDuplicate =
        (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.code === 'SKU_EXISTS')
        || /sku.*already exists/i.test(message)
        || /артикул.*уже/i.test(message);
      if (isSkuDuplicate && detail && typeof detail === 'object' && !Array.isArray(detail)) {
        const skuVal = String(detail.sku || vars?.sku || formRef.current?.sku || '').trim();
        setSkuConflictSku(skuVal);
        setSkuConflictExisting({
          id: detail.product_id,
          name: detail.name,
          brand: detail.brand,
          sale_price: detail.sale_price,
          sku: detail.sku,
          barcode: detail.barcode,
        });
        setSkuConflictPayload(vars || null);
        setSkuConflictOpen(true);
        setFormError('');
        return;
      }
      toast.error(`✕ ${message}`);
      setFormError(message);
    },
  });

  const openDuplicateBarcodeProduct = async () => {
    if (duplicateBarcodeProduct) {
      setDuplicateBarcodeProduct(null);
      setDuplicateBarcodeValue('');
      setFormError('');
      handleEdit(duplicateBarcodeProduct);
      return;
    }
    const code = String(duplicateBarcodeValue || formData.barcode || '').trim();
    if (!code) return;
    try {
      const r = await productApi.getByBarcode(code, { allow404: true, includeInactive: true });
      if (r?.status === 200 && r?.data) {
        setDuplicateBarcodeProduct(null);
        setDuplicateBarcodeValue('');
        setFormError('');
        handleEdit(r.data);
      } else {
        toast.error('Товар с этим штрих-кодом не найден даже в архиве');
      }
    } catch {
      toast.error('Не удалось открыть товар по штрих-коду');
    }
  };

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
    setGalleryFocusIdx(0);
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setFormData(emptyForm());
    setShowForm(false);
    setFormError('');
    setDuplicateBarcodeProduct(null);
    setDuplicateBarcodeValue('');
    setBarcodeLocked(false);
    setForceCreateMode(false);
    setChangeCategoryMode(false);
    setSkuTemplateProduct(null);
    setSkuTemplateLoading(false);
    skuTemplateDismissedRef.current = '';
    templateGallerySourceIdRef.current = null;
    clearDraft();
  };

  /** Открыть форму нового товара — с проверкой черновика */
  const openNewProductForm = useCallback((opts = {}) => {
    const draft = loadDraft();
    const base = { ...emptyForm(), barcode: generateEAN13(), ...opts };
    if (draft && !opts.skipDraft) {
      // Предложить восстановить черновик через toast с action
      setFormData({ ...base });
      setBarcodeLocked(false);
      setShowForm(true);
      toast(
        (t) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Восстановить незаконченный товар?
            <button
              type="button"
              onClick={() => {
                const { _savedAt: _x, ...restDraft } = draft;
                setFormData({ ...base, ...restDraft });
                toast.dismiss(t.id);
              }}
              style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              Восстановить
            </button>
            <button
              type="button"
              onClick={() => { clearDraft(); toast.dismiss(t.id); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}
            >
              Начать заново
            </button>
          </span>
        ),
        { duration: 8000, icon: '📋' },
      );
    } else {
      setFormData(base);
      setBarcodeLocked(Boolean(opts.barcode));
      setShowForm(true);
    }
  }, [loadDraft, clearDraft]);

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
              const r = await productApi.getByBarcode(buf, { allow404: true });
              if (r?.status === 200 && r?.data) found = r.data;
            } catch {
              /* other errors */
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
    const galleryUrls = normalizeProductGallery(p);
    const editForm = {
      ...emptyForm(),
      ...p,
      sku: p.sku || '',
      purchase_price: p.purchase_price != null ? Number(p.purchase_price) : 0,
      cny_price: p.cny_price != null ? String(p.cny_price) : '',
      delivery_cost_kzt: p.delivery_cost_kzt != null ? String(p.delivery_cost_kzt) : '',
      delivery_weight_kg: wKg,
      supplier: p.supplier || '',
      storage_location: p.location_zone || '',
      image_urls: galleryUrls,
      image_url: galleryUrls[0] || '',
      compatibility_engine_family_ids: (p.compatibility?.engine_families || []).map((x) => x.id),
      compatibility_vehicle_model_ids: (p.compatibility?.vehicle_models || []).map((x) => x.id),
      engine_code_id: p.engine_code?.id || null,
      show_on_storefront: p.show_on_storefront !== false,
      category_id: p.category_id || null,
      category_group_id: findGroupIdForCategory(categoryTree, p.category_id),
      attributes: p.attributes && typeof p.attributes === 'object' ? { ...p.attributes } : {},
    };
    setFormData(editForm);
    undoSnapshotRef.current = buildPayload(editForm, cnyRate);
    setGalleryFocusIdx(0);
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    resetCompatPicker((p.compatibility?.vehicle_models || []).map((x) => x.id));
    resetEnginePicker((p.compatibility?.engine_families || []).map((x) => x.id));
    setShowForm(true); setBarcodeLocked(true); setFormError('');
    setForceCreateMode(false);
    setChangeCategoryMode(false);
    setDeliveryMode('normal');
    setCustomDeliveryRate(String(settingsDeliveryRate || 800));
    setSideProduct(null);
  };

  const submitProductPayload = (payload, opts = {}) => {
    const body = { ...payload };
    if (opts.allowDuplicateSku) body.allow_duplicate_sku = true;
    if (!body.id && templateGallerySourceIdRef.current) {
      body.copy_gallery_from_product_id = templateGallerySourceIdRef.current;
    }
    saveMutation.mutate(forceCreateMode ? { ...body, id: null, _forceCreate: true } : body);
  };

  const handleCreateCopy = () => {
    setFormData((prev) => ({
      ...prev,
      id: null,
      sku: '',
      barcode: generateEAN13(),
      image_url: '',
      image_urls: [],
      quantity: 0,
    }));
    setBarcodeLocked(false);
    setForceCreateMode(true);
    toast.success('Копия: артикул пустой, новый штрих-код');
  };

  /** Дублировать товар из строки каталога */
  const handleDuplicateProduct = useCallback((product) => {
    const galleryUrls = normalizeProductGallery(product);
    setFormData({
      ...emptyForm(),
      id: null,
      sku: '',
      barcode: generateEAN13(),
      name: '',
      category_id: product.category_id || null,
      category_group_id: findGroupIdForCategory(categoryTree, product.category_id),
      category: product.category || '',
      brand: product.brand || '',
      model: product.model || '',
      attributes: product.attributes && typeof product.attributes === 'object' ? { ...product.attributes } : {},
      sale_price: product.sale_price || 0,
      purchase_price: product.purchase_price || 0,
      cny_price: product.cny_price != null ? String(product.cny_price) : '',
      delivery_cost_kzt: product.delivery_cost_kzt != null ? String(product.delivery_cost_kzt) : '',
      delivery_weight_kg: product.delivery_weight_kg != null ? String(product.delivery_weight_kg) : '',
      supplier: product.supplier || '',
      description: product.description || '',
      show_on_storefront: product.show_on_storefront !== false,
      compatibility_vehicle_model_ids: (product.compatibility?.vehicle_models || []).map((x) => x.id),
      compatibility_engine_family_ids: (product.compatibility?.engine_families || []).map((x) => x.id),
      quantity: 0,
      min_quantity: 0,
      image_url: galleryUrls[0] || '',
      image_urls: galleryUrls,
      storage_location: '',
    });
    setBarcodeLocked(false);
    setForceCreateMode(true);
    setChangeCategoryMode(false);
    setFormError('');
    setFieldErrors({});
    resetCompatPicker((product.compatibility?.vehicle_models || []).map((x) => x.id));
    resetEnginePicker((product.compatibility?.engine_families || []).map((x) => x.id));
    setShowForm(true);
    toast('Дублирование: измените нужные поля и сохраните', { icon: '📋', duration: 4000 });
  }, [categoryTree, resetCompatPicker, resetEnginePicker]);

  const handleMigrateProduct = (product) => {
    handleEdit(product);
    toast('Данные перенесены — выберите категорию и заполните характеристики', { icon: 'ℹ️' });
  };

  /** «Сохранить и ещё» — сохраняем, затем открываем форму с теми же категорией/ценами */
  const [saveAndAddMore, setSaveAndAddMore] = useState(false);
  const [saveAndStay, setSaveAndStay] = useState(false);

  const handleSubmitAndMore = () => {
    setSaveAndAddMore(true);
    setSaveAndStay(false);
    handleSubmit();
  };

  const handleSubmitAndStay = () => {
    setSaveAndStay(true);
    setSaveAndAddMore(false);
    handleSubmit();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (isSubmitting) return; // защита от двойного клика
    setFormError('');
    setFieldErrors({});

    // Клиентская валидация
    const errors = {};
    if (!formData.name?.trim()) errors.name = 'Название обязательно';
    if (!formData.category_id && !formData.id) errors._form = 'Выберите категорию';
    if (num(formData.sale_price) <= 0) errors.sale_price = 'Цена продажи должна быть > 0';

    // Обязательные атрибуты из схемы
    if (selectedSubcategorySchema?.fields) {
      selectedSubcategorySchema.fields.forEach((f) => {
        if (f.required && !String((formData.attributes || {})[f.key] || '').trim()) {
          errors[`attr:${f.key}`] = `${f.label} обязательно`;
        }
      });
    }

    if (showEngineFamilyPicker && !(formData.compatibility_engine_family_ids || []).length) {
      errors.engine_families = 'Выберите хотя бы один код мотора';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(errors._form || Object.values(errors)[0] || 'Заполните обязательные поля');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = buildPayload(formData, cnyRate);
      // #region agent log
      fetch('http://127.0.0.1:7415/ingest/64fc1600-807a-4c4b-afeb-2d3cf2e15696',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'91a77d'},body:JSON.stringify({sessionId:'91a77d',runId:'post-fix',hypothesisId:'H2',location:'Products.jsx:handleSubmit',message:'submit product',data:{isNew:!formData.id,sku:payload.sku,imageUrlsInForm:(formData.image_urls||[]).length,galleryCopyFrom:templateGallerySourceIdRef.current},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const sku = String(formData.sku || '').trim();
      if (sku) {
        try {
          const r = await productApi.getBySku(sku, {
            allow404: true,
            excludeId: formData.id || undefined,
          });
          if (r?.status === 200 && r?.data) {
            setSkuConflictSku(sku);
            setSkuConflictExisting(r.data);
            setSkuConflictPayload(payload);
            skuOpenAfterSaveRef.current = null;
            setSkuConflictOpen(true);
            return;
          }
        } catch {
          /* сеть — сохраним и обработаем ответ API */
        }
      }
      submitProductPayload(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeSkuConflict = () => {
    setSkuConflictOpen(false);
    setSkuConflictExisting(null);
    setSkuConflictSku('');
    setSkuConflictPayload(null);
    skuOpenAfterSaveRef.current = null;
  };

  const handleSkuConflictCopyTemplate = () => {
    const existing = skuConflictExisting;
    if (!existing) {
      closeSkuConflict();
      return;
    }
    const sku = skuConflictSku || String(formData.sku || '').trim();
    setFormData((prev) => applyCatalogProductTemplate(prev, existing, categoryTree, { keepSku: sku }));
    templateGallerySourceIdRef.current = existing?.id ?? null;
    closeSkuConflict();
    setSkuTemplateProduct(null);
    skuTemplateDismissedRef.current = sku;
    toast.success('Данные скопированы — штрих-код новый');
  };

  const handleSkuTemplateCopy = useCallback(() => {
    if (!skuTemplateProduct) return;
    const sku = String(formData.sku || '').trim();
    setFormData((prev) => applyCatalogProductTemplate(prev, skuTemplateProduct, categoryTree, { keepSku: sku }));
    templateGallerySourceIdRef.current = skuTemplateProduct?.id ?? null;
    setSkuTemplateProduct(null);
    skuTemplateDismissedRef.current = sku;
    toast.success('Данные скопированы — штрих-код новый');
  }, [skuTemplateProduct, categoryTree, formData.sku]);

  const handleSkuTemplateOpen = useCallback(() => {
    if (!skuTemplateProduct?.id) return;
    setShowForm(false);
    setSideProduct(skuTemplateProduct.id);
  }, [skuTemplateProduct]);

  const handleSkuTemplateDismiss = useCallback(() => {
    skuTemplateDismissedRef.current = String(formData.sku || '').trim();
    setSkuTemplateProduct(null);
  }, [formData.sku]);

  useEffect(() => {
    const sku = String(formData.sku || '').trim();
    if (skuTemplateDismissedRef.current && skuTemplateDismissedRef.current !== sku) {
      skuTemplateDismissedRef.current = '';
    }
  }, [formData.sku]);

  useEffect(() => {
    if (!showForm || formData.id) {
      setSkuTemplateProduct(null);
      setSkuTemplateLoading(false);
      return undefined;
    }
    const sku = String(formData.sku || '').trim();
    if (sku.length < 2) {
      setSkuTemplateProduct(null);
      setSkuTemplateLoading(false);
      return undefined;
    }
    if (skuTemplateDismissedRef.current === sku) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSkuTemplateLoading(true);
      try {
        const r = await productApi.getBySku(sku, { allow404: true });
        if (cancelled) return;
        if (r?.status === 200 && r?.data) {
          setSkuTemplateProduct(r.data);
        } else {
          setSkuTemplateProduct(null);
        }
      } catch {
        if (!cancelled) setSkuTemplateProduct(null);
      } finally {
        if (!cancelled) setSkuTemplateLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showForm, formData.id, formData.sku]);

  const handleSkuConflictSaveAnyway = () => {
    if (!skuConflictPayload) {
      closeSkuConflict();
      return;
    }
    submitProductPayload(skuConflictPayload, { allowDuplicateSku: true });
    closeSkuConflict();
  };

  const handleSkuConflictShowExisting = async () => {
    const existing = skuConflictExisting;
    closeSkuConflict();
    if (existing?.id) {
      setShowForm(false);
      setSideProduct(existing.id);
    }
  };

  const selectedProducts = useMemo(
    () => displayProducts.filter((p) => selectedIds.includes(p.id)),
    [displayProducts, selectedIds],
  );
  const selectedLegacyProducts = useMemo(
    () => selectedProducts.filter(isLegacyProduct),
    [selectedProducts],
  );
  const canBulkCategoryUpdate = selectedLegacyProducts.length > 0;
  const canBulkPricesEdit = useMemo(() => {
    if (selectedProducts.length < 2) return false;
    if (selectedProducts.some(isLegacyProduct)) return false;
    const catId = selectedProducts[0]?.category_id;
    if (catId) return selectedProducts.every((p) => p.category_id === catId);
    const cat = selectedProducts[0]?.category || '';
    return selectedProducts.every((p) => (p.category || '') === cat);
  }, [selectedProducts]);

  const legacyGroups = useMemo(() => {
    const map = new Map();
    for (const p of displayProducts) {
      if (!isLegacyProduct(p)) continue;
      const key = (p.category || '').trim() || 'Без категории';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p.id);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [displayProducts]);

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const updates = selectedProducts.map((p) => {
        const payload = {
          name: bulkForm.name.trim() || p.name,
          brand: bulkForm.brand.trim() || p.brand,
          model: bulkForm.model.trim() || p.model,
          purchase_price: bulkForm.purchase_price === '' ? Number(p.purchase_price || 0) : Number(bulkForm.purchase_price),
          sale_price: bulkForm.sale_price === '' ? Number(p.sale_price || 0) : Number(bulkForm.sale_price),
          quantity: bulkForm.quantity === '' ? Number(p.quantity || 0) : Number(bulkForm.quantity),
        };
        return productApi.update(p.id, payload);
      });
      await Promise.all(updates);
    },
    onSuccess: () => {
      toast.success('Массовое обновление выполнено');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setBulkEditOpen(false);
      setSelectedIds([]);
      setBulkForm({ name: '', brand: '', model: '', purchase_price: '', sale_price: '', quantity: '' });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Не удалось выполнить массовое обновление')),
  });

  const openNew = () => {
    setGalleryFocusIdx(0);
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setFormError('');
    setDeliveryMode('normal');
    setCustomDeliveryRate(String(settingsDeliveryRate || 800));
    setForceCreateMode(true);
    setChangeCategoryMode(false);
    setFieldErrors({});
    openNewProductForm();
  };

  const productImageDisplaySrc = (url) => {
    const base = (url || '').split('?')[0].trim();
    if (!base) return '';
    return `${resolveUploadedAssetUrl(base)}?v=${imagePreviewBust}`;
  };

  const productImageThumbSrc = () => {
    if (imageBlobUrl) return imageBlobUrl;
    const urls = formData.image_urls || [];
    const u = urls[galleryFocusIdx] ?? urls[0];
    if (u) return productImageDisplaySrc(u);
    return '';
  };

  const handleUploadProductImage = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    if (!formData.id) {
      toast.error('Сначала сохраните товар, затем загрузите фото');
      return;
    }
    const bad = files.find((f) => !f.type.startsWith('image/'));
    if (bad) {
      toast.error('Допускаются только изображения (JPG, PNG, WEBP и др.)');
      return;
    }
    let slots = MAX_PRODUCT_PHOTOS - (formData.image_urls || []).length;
    if (slots <= 0) {
      toast.error(`Не больше ${MAX_PRODUCT_PHOTOS} фото на товар`);
      return;
    }
    const queue = files.slice(0, slots);
    if (files.length > queue.length) {
      toast.error(`Лишние файлы не загружены: максимум ${MAX_PRODUCT_PHOTOS} фото`);
    }
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return queue[0] ? URL.createObjectURL(queue[0]) : '';
    });
    setImageUploading(true);
    setImageUploadPct(0);
    try {
      let lastResponse = null;
      for (let i = 0; i < queue.length; i += 1) {
        const file = queue[i];
        const response = await productApi.uploadProductImage(formData.id, file, {
          onUploadProgress: (ev) => {
            const slice = 100 / queue.length;
            const base = (i / queue.length) * 100;
            if (ev.total) {
              const local = Math.min(100, Math.round((ev.loaded * 100) / ev.total));
              setImageUploadPct(Math.min(100, Math.round(base + (local / 100) * slice)));
            } else {
              setImageUploadPct((p) => (p == null ? Math.round(base + slice * 0.1) : Math.min(99, (p || 0) + 2)));
            }
          },
        });
        lastResponse = response;
        const urls = response?.data?.image_urls;
        if (!Array.isArray(urls) || !urls.length) {
          toast.error('Сервер не вернул список фото');
          return;
        }
        setFormData((prev) => ({
          ...prev,
          image_urls: urls,
          image_url: urls[0] || '',
        }));
        setGalleryFocusIdx(urls.length - 1);
      }
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      const w = lastResponse?.data?.width;
      const h = lastResponse?.data?.height;
      const b = lastResponse?.data?.size_bytes;
      const dim = w && h ? ` ${w}×${h} px` : '';
      const sz = b != null ? `, ${(b / 1024).toFixed(1)} КБ` : '';
      const n = queue.length;
      toast.success(n > 1 ? `Загружено фото: ${n}${dim}${sz}` : `Фото сохранено${dim}${sz}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Не удалось загрузить фото'));
    } finally {
      setImageUploading(false);
      setImageUploadPct(null);
    }
  };

  const handleDeleteProductGalleryOne = async (url) => {
    if (!formData.id) {
      toast.error('Сначала сохраните товар');
      return;
    }
    const base = basenameFromProductImageUrl(url);
    if (!base) return;
    try {
      const { data } = await productApi.deleteProductGalleryImage(formData.id, base);
      const urls = Array.isArray(data?.image_urls) ? data.image_urls : [];
      setFormData((prev) => ({
        ...prev,
        image_urls: urls,
        image_url: urls[0] || '',
      }));
      setGalleryFocusIdx((idx) => {
        if (!urls.length) return 0;
        return Math.min(idx, urls.length - 1);
      });
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

  const handleDeleteProductImage = async () => {
    if (!formData.id) {
      toast.error('Сначала сохраните товар');
      return;
    }
    if (!(formData.image_urls || []).length) return;
    try {
      await productApi.deleteProductImage(formData.id);
      setFormData((prev) => ({ ...prev, image_url: '', image_urls: [] }));
      setGalleryFocusIdx(0);
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Все фото удалены');
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
    setPrintProduct(product); setShowPrint(true);
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
  const migrationStats = useMemo(() => {
    const legacy = Number(productsStats?.needs_refresh_count ?? needsRefreshCount) || 0;
    const total = totalCatalog ?? (legacy + (products.length - needsRefreshCount));
    const updated = Math.max(0, total - legacy);
    const pct = total > 0 ? Math.round((updated / total) * 100) : 100;
    return { legacy, total, updated, pct };
  }, [productsStats, totalCatalog, needsRefreshCount, products.length]);

  const handleRefreshCatalog = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['products-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
    ]);
    toast.success('Список обновлён');
  }, [queryClient]);


  /* Только первый холодный старт: иначе при смене search весь экран → Spinner и инпут размонтируется (потеря фокуса). */
  if (isPending && !productsPages) {
    return (
      <div className="products-page-shell" style={{ padding: '10px 14px' }}>
        <div className="ui-skeleton-card" style={{ marginBottom: 12 }}>
          <div className="ui-skeleton-line" style={{ width: '30%', height: 26, marginBottom: 10 }} />
          <div className="ui-skeleton-line" style={{ width: '46%', height: 14 }} />
        </div>
        <div className="ui-skeleton-card">
          <div className="ui-skeleton-line" style={{ width: '100%', height: 42, marginBottom: 10 }} />
          <div className="ui-skeleton-line" style={{ width: '100%', height: 260 }} />
        </div>
      </div>
    );
  }

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

      <div
        className={`products-catalog-chrome-slot${viewMode === 'grid' && gridChromeHidden ? ' products-catalog-chrome-slot--collapsed' : ''}`}
        style={
          viewMode === 'grid'
            ? {
                height: gridChromeHidden
                  ? 0
                  : chromeHeight > 0
                    ? chromeHeight
                    : undefined,
              }
            : undefined
        }
      >
        <div ref={chromeRef} className="products-catalog-chrome">
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 className="ios-mega-title">Каталог</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            {products.length} из {totalCatalog != null ? totalCatalog : '…'} в каталоге
            {storefrontFilter ? ` · фильтр витрины` : ` · на сайте ${storefrontOnCount}`}
            {migrationStats.legacy > 0 && (
              <> · обновлено {migrationStats.updated} из {migrationStats.total} ({migrationStats.pct}%)</>
            )}
            {showStale && displayProducts.length !== products.length ? ` · показано ${displayProducts.length}` : ''}
            {' · '}
            {Math.round(totalPurchaseValue).toLocaleString('ru-RU')} ₸
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {selectedIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => bulkStorefrontMutation.mutate({ ids: selectedIds, value: true })}
                disabled={bulkStorefrontMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid rgba(16, 185, 129, 0.35)', background: 'rgba(16, 185, 129, 0.08)', fontWeight: 600, fontSize: 13, color: 'var(--success)' }}
              >
                <FiGlobe size={14} /> На сайт ({selectedIds.length})
              </button>
              <button
                type="button"
                onClick={() => bulkStorefrontMutation.mutate({ ids: selectedIds, value: false })}
                disabled={bulkStorefrontMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 13 }}
              >
                Скрыть с сайта
              </button>
              <button
                type="button"
                onClick={() => setBulkCategoryOpen(true)}
                disabled={!canBulkCategoryUpdate}
                title={canBulkCategoryUpdate ? 'Перевести выбранные на новую категорию' : 'Выберите товары со старой категорией'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.1)', fontWeight: 600, fontSize: 13, color: '#b45309', opacity: canBulkCategoryUpdate ? 1 : 0.45, cursor: canBulkCategoryUpdate ? 'pointer' : 'not-allowed' }}
              >
                Обновить категорию ({selectedLegacyProducts.length})
              </button>
              {canBulkPricesEdit && (
                <button
                  type="button"
                  onClick={() => setBulkEditOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 13 }}
                >
                  Цены и остаток ({selectedIds.length})
                </button>
              )}
            </>
          )}
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
          <button
            type="button"
            title="Все активные товары снова на витрине CHPARTS"
            disabled={publishAllStorefrontMutation.isPending}
            onClick={() => publishAllStorefrontMutation.mutate()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, border: '1px solid rgba(16, 185, 129, 0.35)', background: 'rgba(16, 185, 129, 0.08)', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: 'var(--success)' }}
          >
            <FiGlobe size={15} /> Все на сайт
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
      <div className="ios-glass-panel" style={{ padding: '14px 16px', marginBottom: 12, position: 'relative', zIndex: 60 }}>
        <div ref={searchWrapRef} style={{ position: 'relative', marginBottom: 10, zIndex: 60 }}>
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
          <button type="button" className={`catalog-chip ${selectedCategory === '' && !selectedCategoryId && !legacyOnlyFilter && !showStale && !storefrontFilter ? 'catalog-chip-active' : ''}`} onClick={() => { setSelectedCategory(''); setSelectedCategoryId(null); setLegacyOnlyFilter(false); setShowStale(false); setStorefrontFilter(''); }}>Все</button>
          <button type="button" className={`catalog-chip ${legacyOnlyFilter ? 'catalog-chip-active' : ''}`} onClick={() => { setLegacyOnlyFilter((v) => !v); setNeedsRefreshFilter(false); setSelectedCategory(''); setSelectedCategoryId(null); setShowStale(false); setStorefrontFilter(''); }}>
            Не обновлённые
          </button>
          {needsRefreshCount > 0 && (
            <button
              type="button"
              className={`catalog-chip${needsRefreshFilter ? ' catalog-chip-active' : ''}`}
              onClick={() => {
                setNeedsRefreshFilter((v) => !v);
                setLegacyOnlyFilter(false);
                setSelectedCategory('');
                setSelectedCategoryId(null);
                setShowStale(false);
                setStorefrontFilter('');
              }}
            >
              Ждут категорию ({needsRefreshCount})
            </button>
          )}
          {(categoryTree || []).flatMap((g) => (g.children || []).map((c) => (
            <button key={c.id} type="button" className={`catalog-chip ${selectedCategoryId === c.id && !legacyOnlyFilter ? 'catalog-chip-active' : ''}`} onClick={() => { setSelectedCategoryId(c.id); setSelectedCategory(''); setLegacyOnlyFilter(false); setShowStale(false); setStorefrontFilter(''); }}>
              {c.icon ? `${c.icon} ` : ''}{c.name}
            </button>
          )))}
          <button type="button" className={`catalog-chip ${storefrontFilter === 'on' ? 'catalog-chip-active' : ''}`} onClick={() => { setStorefrontFilter('on'); setShowStale(false); }}>
            <FiGlobe size={13} style={{ marginRight: 5 }} />На сайте
          </button>
          <button type="button" className={`catalog-chip ${storefrontFilter === 'off' ? 'catalog-chip-active' : ''}`} onClick={() => { setStorefrontFilter('off'); setShowStale(false); }}>Скрыто с сайта</button>
          {safeCategories.map((cat) => (
            <button key={cat} type="button" className={`catalog-chip ${selectedCategory === cat && !showStale && !storefrontFilter ? 'catalog-chip-active' : ''}`} onClick={() => { setSelectedCategory(cat); setShowStale(false); setStorefrontFilter(''); }}>{cat}</button>
          ))}
          <button type="button" className={`catalog-chip ${showStale ? 'catalog-chip-stale' : 'catalog-chip-stale-off'}`} onClick={() => { setShowStale((s) => !s); setSelectedCategory(''); }}>
            <FiClock size={13} style={{ marginRight: 5 }} />Залежалось {staleCount > 0 && <span style={{ marginLeft: 4, background: showStale ? '#fbbf24' : '#fde047', border: '1px solid', borderColor: showStale ? '#d97706' : '#f59e0b', borderRadius: 8, padding: '1px 6px', fontSize: 11 }}>{staleCount}</span>}
          </button>
        </div>
        <div className="products-catalog-toolbar-row">
          <ProductsViewToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
        {(legacyOnlyFilter || needsRefreshFilter) && legacyGroups.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Группы:</span>
            {legacyGroups.slice(0, 8).map(([name, ids]) => (
              <button
                key={name}
                type="button"
                className="catalog-chip"
                onClick={() => setSelectedIds(ids)}
                title={`Выбрать все «${name}» (${ids.length})`}
              >
                {name} ({ids.length})
              </button>
            ))}
          </div>
        )}
      </div>
        </div>
      </div>

      {/* ── Table / Grid ── */}
      <div
        ref={tableScrollRef}
        className={`products-table-scroll${viewMode === 'grid' ? ' products-table-scroll--grid' : ''}`}
        style={{ marginBottom: 0 }}
        onScroll={handleCatalogScroll}
      >
        {displayProducts.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <FiPackage size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>{search || selectedCategory || showStale ? 'Ничего не найдено по фильтрам' : 'Добавьте первый товар'}</div>
            {(search || selectedCategory || showStale) && (
              <button
                type="button"
                className="btn-ios-secondary"
                style={{ marginTop: 12 }}
                onClick={() => { setSearchInput(''); setSelectedCategory(''); setShowStale(false); setStorefrontFilter(''); }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <>
            <div className="products-catalog-grid">
              {displayProducts.map((row) => (
                <ProductGridCard
                  key={row.id}
                  product={row}
                  onOpen={() => setSideProduct(row)}
                  onEdit={() => handleEdit(row)}
                  onPrint={openPrintForRow}
                onToggleStorefront={(p) => {
                  toggleStorefrontMutation.mutate({
                    id: p.id,
                    value: p.show_on_storefront === false,
                  });
                }}
                onZoomPhoto={openProductLightbox}
                storefrontPending={toggleStorefrontMutation.isPending}
                />
              ))}
            </div>
            {hasNextPage ? <div ref={gridLoadSentinelRef} className="products-grid-sentinel" aria-hidden /> : null}
            {isFetchingNextPage ? (
              <div className="products-grid-loading">
                <FiLoader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Загрузка…</span>
              </div>
            ) : null}
          </>
        ) : (
          <table className="products-catalog-table">
            <thead className="products-catalog-thead">
              <tr>
                {['✓', 'Штрих-код', 'Название', 'Марка', 'Совместимость', 'Категория', 'Закуп', 'Продажа', 'Прибыль', 'Место', 'Остаток', 'Сайт', ''].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalogVirtual.padTop > 0 && (
                <tr aria-hidden="true" style={{ height: catalogVirtual.padTop, pointerEvents: 'none' }}>
                  <td colSpan={13} style={{ padding: 0, border: 'none', height: catalogVirtual.padTop, lineHeight: 0 }} />
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
                    <td style={{ padding: '12px 10px' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedIds((prev) => (prev.includes(row.id) ? prev.filter((x) => x !== row.id) : [...prev, row.id]));
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace,monospace', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.barcode || row.sku || '—'}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text)', minWidth: 140, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.brand || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {(() => {
                        const cell = formatCompatibilityTableCell(row);
                        if (!cell) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                        return (
                          <span className="products-compat-cell" title={cell.extra > 0 ? `Ещё ${cell.extra} совместимостей` : cell.primary}>
                            <span aria-hidden>🚗</span>
                            <span className="products-compat-cell__text">{cell.primary}</span>
                            {cell.extra > 0 && (
                              <span style={{
                                flexShrink: 0,
                                borderRadius: 999,
                                padding: '1px 7px',
                                fontSize: 10,
                                fontWeight: 700,
                                background: 'var(--primary-light)',
                                color: 'var(--primary)',
                              }}
                              >
                                +{cell.extra}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        {(row.is_legacy_category || row.needs_category_refresh) && (
                          <span style={{ display: 'inline-flex', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>Обновить</span>
                        )}
                        {row.category
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, background: catColor.bg, color: catColor.color, whiteSpace: 'nowrap', border: '1px solid var(--border-light)' }}>{row.category}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </div>
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
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <button
                        type="button"
                        title={row.show_on_storefront !== false ? 'На витрине — нажмите, чтобы скрыть' : 'Скрыто с сайта — нажмите, чтобы показать'}
                        disabled={toggleStorefrontMutation.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStorefrontMutation.mutate({
                            id: row.id,
                            value: row.show_on_storefront === false,
                          });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 10px',
                          borderRadius: 999,
                          border: row.show_on_storefront !== false ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid var(--border)',
                          background: row.show_on_storefront !== false ? 'rgba(16, 185, 129, 0.1)' : 'var(--ios-grouped-bg)',
                          color: row.show_on_storefront !== false ? 'var(--success)' : 'var(--text-muted)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <FiGlobe size={12} />
                        {row.show_on_storefront !== false ? 'Да' : 'Нет'}
                      </button>
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                      <div className="products-catalog-row-actions">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleEdit(row); }} title="Редактировать" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FiEdit2 size={14} /></button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleDuplicateProduct(row); }} title="Дублировать" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>⧉</button>
                        <button type="button" onClick={(e) => openPrintForRow(row, e)} title="Этикетка" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FiTag size={14} /></button>
                        <button type="button" onClick={(e) => openDeleteConfirm(row, e)} title="Удалить" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #fecaca', background: '#fee2e2', color: 'var(--danger)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FiTrash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {catalogVirtual.padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: catalogVirtual.padBottom, pointerEvents: 'none' }}>
                  <td colSpan={13} style={{ padding: 0, border: 'none', height: catalogVirtual.padBottom, lineHeight: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {hasNextPage && viewMode === 'table' && (
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
                  setForceCreateMode(true);
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
      {sideProduct && sidePanelProduct && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: '#9ca3af', zIndex: 300 }} onClick={() => { setSideProduct(null); setSideProductDetail(null); }} />
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(420px, 100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'none', zIndex: 301, overflow: 'auto', display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.25s ease-out', willChange: 'transform' }}>
            {/* Header */}
            <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.2, wordBreak: 'break-word' }}>{sidePanelProduct.name}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {sidePanelProduct.brand && <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>{sidePanelProduct.brand}</span>}
                  {sidePanelProduct.model && <span style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700 }}>Модель: {sidePanelProduct.model}</span>}
                  {(sidePanelProduct.is_legacy_category || sidePanelProduct.needs_category_refresh) && (
                    <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>Обновить</span>
                  )}
                  {sidePanelProduct.category && (() => { const cc = getCatColor(sidePanelProduct.category); return <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: cc.bg, color: cc.color }}>{sidePanelProduct.category}</span>; })()}
                </div>
              </div>
              <button type="button" onClick={() => { setSideProduct(null); setSideProductDetail(null); }} style={{ width: 36, height: 36, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}><FiX size={18} /></button>
            </div>
            {/* Specs grid */}
            <div style={{ padding: '18px 22px', flex: 1 }}>
              {sideProductLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                  <FiLoader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Загрузка деталей…
                </div>
              )}
              {(() => {
                const gallery = normalizeProductGallery(sidePanelProduct);
                const focusUrl = gallery[sidePhotoIdx] ?? gallery[0];
                const focusSrc = focusUrl ? resolveUploadedAssetUrl(focusUrl) : null;
                return (
                  <div className="product-side-photo">
                    <button
                      type="button"
                      className="product-side-photo__main"
                      disabled={!focusSrc}
                      onClick={() => focusSrc && openProductLightbox(sidePanelProduct, sidePhotoIdx)}
                    >
                      {focusSrc ? (
                        <img src={focusSrc} alt="" />
                      ) : (
                        <FiPackage size={36} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </button>
                    {focusSrc ? (
                      <div className="product-side-photo__hint">Нажмите для увеличения</div>
                    ) : null}
                    {gallery.length > 1 ? (
                      <div className="product-side-photo__thumbs">
                        {gallery.map((url, idx) => (
                          <button
                            key={`${url}-${idx}`}
                            type="button"
                            className={`product-side-photo__thumb${idx === sidePhotoIdx ? ' product-side-photo__thumb--active' : ''}`}
                            onClick={() => setSidePhotoIdx(idx)}
                          >
                            <img src={resolveUploadedAssetUrl(url)} alt="" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                {[
                  ['Штрих-код', sidePanelProduct.barcode || sidePanelProduct.sku || '—', true],
                  ['Марка', sidePanelProduct.brand || '—'],
                  ['Модель', sidePanelProduct.model || '—'],
                  ['Производитель', sidePanelProduct.supplier || '—'],
                ].map(([label, val, mono]) => (
                  <div key={label} style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: mono ? 'ui-monospace,monospace' : undefined, wordBreak: 'break-word' }}>{val}</div>
                  </div>
                ))}
                <div style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Закуп (¥)</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{formatSidePurchaseYuan(sidePanelProduct)}</div>
                  {formatSidePurchaseKztHint(sidePanelProduct) ? (
                    <div className="product-side-spec-purchase__hint">{formatSidePurchaseKztHint(sidePanelProduct)}</div>
                  ) : null}
                </div>
                {[
                  ['Доставка', sidePanelProduct.delivery_cost_kzt ? `${Number(sidePanelProduct.delivery_cost_kzt).toLocaleString('ru-RU')} ₸` : '—'],
                  ['Вес (доставка)', formatSideDeliveryKg(sidePanelProduct, deliveryKztPerKg)],
                  ['Продажа (₸)', `${Number(sidePanelProduct.sale_price || 0).toLocaleString('ru-RU')} ₸`],
                  ['Прибыль', profitPct(sidePanelProduct) ? `${profitPct(sidePanelProduct)}%` : '—'],
                  ['Место', sidePanelProduct.location_zone || '—', true],
                  ['Мин. остаток', String(sidePanelProduct.min_quantity ?? 0)],
                ].map(([label, val, mono]) => (
                  <div key={label} style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: mono ? 'ui-monospace,monospace' : undefined, wordBreak: 'break-word' }}>{val}</div>
                  </div>
                ))}
              </div>
              {(() => {
                const compatLabels = compatibilityLabelsFromProduct(sidePanelProduct);
                if (!compatLabels.length) return null;
                return (
                  <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Совместимость с авто</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {compatLabels.map((label) => (
                        <span
                          key={label}
                          style={{
                            display: 'inline-flex',
                            borderRadius: 999,
                            padding: '4px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            background: 'var(--primary-light)',
                            color: 'var(--primary)',
                            border: '1px solid color-mix(in srgb, var(--primary) 20%, var(--border))',
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Stock big number */}
              <div style={{ padding: '16px 18px', borderRadius: 18, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', textAlign: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Остаток</div>
                <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em', color: Number(sidePanelProduct.quantity) === 0 ? 'var(--danger)' : Number(sidePanelProduct.quantity) <= 5 ? '#d97706' : 'var(--success)', lineHeight: 1 }}>{sidePanelProduct.quantity ?? 0}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>штук</div>
              </div>
              {formatAttributePreview(findCategoryInTree(categoryTree, sidePanelProduct.category_id)?.attribute_schema, sidePanelProduct.attributes || {}).length > 0 && (
                <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Характеристики</div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>
                    {formatAttributePreview(findCategoryInTree(categoryTree, sidePanelProduct.category_id)?.attribute_schema, sidePanelProduct.attributes || {}).join(' · ')}
                  </div>
                </div>
              )}
              {sidePanelProduct.description && <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: 18 }}>{sidePanelProduct.description}</div>}
            </div>
            {/* Actions */}
            <div style={{ padding: '14px 22px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, background: 'var(--surface)', position: 'sticky', bottom: 0, flexWrap: 'wrap' }}>
              {(sidePanelProduct.is_legacy_category || sidePanelProduct.needs_category_refresh) && (
                <button type="button" onClick={() => handleMigrateProduct(sidePanelProduct)} style={{ flex: '1 1 100%', padding: '12px', borderRadius: 14, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.1)', color: '#b45309', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Обновить категорию</button>
              )}
              <button type="button" onClick={() => handleEdit(sidePanelProduct)} style={{ flex: 1, padding: '13px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><FiEdit2 size={16} />Редактировать</button>
              <button
                type="button"
                title={sidePanelProduct.show_on_storefront !== false ? 'Скрыть с витрины' : 'Показать на витрине'}
                disabled={toggleStorefrontMutation.isPending}
                onClick={() => toggleStorefrontMutation.mutate({
                  id: sidePanelProduct.id,
                  value: sidePanelProduct.show_on_storefront === false,
                })}
                style={{ flex: 1, minWidth: 120, padding: '13px', borderRadius: 14, border: sidePanelProduct.show_on_storefront !== false ? '1px solid rgba(16,185,129,0.35)' : '1px solid var(--border)', background: sidePanelProduct.show_on_storefront !== false ? 'rgba(16,185,129,0.1)' : 'var(--surface)', color: sidePanelProduct.show_on_storefront !== false ? 'var(--success)' : 'var(--text-secondary)', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <FiGlobe size={16} />
                {sidePanelProduct.show_on_storefront !== false ? 'На сайте' : 'На сайт'}
              </button>
              <button type="button" onClick={() => openPrintForRow(sidePanelProduct)} title="Печать этикетки" style={{ padding: '13px 16px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><FiTag size={16} />Этикетка</button>
              <button type="button" onClick={(e) => openDeleteConfirm(sidePanelProduct, e)} style={{ padding: '13px 16px', borderRadius: 14, border: '1px solid #fecaca', background: '#fee2e2', color: 'var(--danger)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><FiTrash2 size={16} /></button>
            </div>
          </div>
        </>
      )}

      {lightboxState ? (
        <ProductImageLightbox
          urls={lightboxState.urls}
          index={lightboxState.index}
          title={lightboxState.title}
          onClose={() => setLightboxState(null)}
          onIndexChange={(next) => {
            setLightboxState((prev) => {
              if (!prev) return prev;
              const idx = typeof next === 'function' ? next(prev.index) : next;
              return { ...prev, index: idx };
            });
          }}
        />
      ) : null}

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

      <SkuConflictModal
        isOpen={skuConflictOpen}
        sku={skuConflictSku}
        existing={skuConflictExisting}
        saving={saveMutation.isPending}
        onCancel={closeSkuConflict}
        onSaveAnyway={handleSkuConflictSaveAnyway}
        onShowExisting={handleSkuConflictShowExisting}
        onCopyTemplate={handleSkuConflictCopyTemplate}
      />

      {/* ── Print suggest after create ── */}
      {showPrintSuggest && savedProduct && (
        <div style={{ position: 'fixed', inset: 0, background: '#6b7280', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 340, background: 'var(--surface)', borderRadius: 24, border: '1px solid var(--border)', boxShadow: 'none', overflow: 'hidden', animation: 'sheetUp 0.22s ease-out' }}>
            <div style={{ padding: '24px 22px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🏷️</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Распечатать этикетку?</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>Товар «{savedProduct.name}» создан. Этикетка 6×4 см.</div>
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
      <Modal
        isOpen={showForm}
        title={
          formData.id
            ? (changeCategoryMode ? 'Изменить категорию' : 'Редактировать товар')
            : (categoryChosen ? 'Новый товар' : 'Выберите категорию')
        }
        onClose={resetForm}
        size={showFillStep ? 'product' : 'xl'}
        icon={formData.id ? FiEdit2 : FiPlus}
        actions={(
          <>
            <Button variant="secondary" onClick={resetForm}>Отмена</Button>
            {showFillStep && (formData.id || formData.name || formData.barcode) && (
              <Button variant="secondary" onClick={handleCreateCopy}>Копия</Button>
            )}
            {showFillStep && formData.id && (
              <Button
                variant="secondary"
                onClick={handleSubmitAndStay}
                loading={saveAndStay && (saveMutation.isPending || isSubmitting)}
                disabled={isSubmitting}
                title="Сохранить и остаться в форме"
              >
                Сохранить и остаться
              </Button>
            )}
            {showFillStep && !formData.id && (
              <Button
                variant="secondary"
                onClick={handleSubmitAndMore}
                loading={saveAndAddMore && (saveMutation.isPending || isSubmitting)}
                disabled={isSubmitting}
                title="Сохранить товар и сразу добавить следующий с той же категорией и ценами"
              >
                + Ещё
              </Button>
            )}
            {showFillStep && (
              <Button
                variant="primary"
                icon={formData.id ? FiEdit2 : FiPlus}
                onClick={handleSubmit}
                loading={!saveAndAddMore && (saveMutation.isPending || isSubmitting)}
                disabled={isSubmitting}
              >
                {formData.id ? 'Сохранить изменения' : 'Сохранить товар'}
              </Button>
            )}
          </>
        )}
      >
        {formError && (
          <div style={{ marginBottom: 16, display: 'grid', gap: 10 }}>
            <Alert type="danger" message={formError} onClose={() => setFormError('')} />
            {(duplicateBarcodeProduct || duplicateBarcodeValue) && (
              <Button
                variant="secondary"
                onClick={openDuplicateBarcodeProduct}
              >
                Открыть товар с таким штрих-кодом
              </Button>
            )}
          </div>
        )}

        {showCategoryStep && (
          <div className="product-wizard product-form-modal">
            <div className="product-wizard-steps" aria-label="Шаги">
              <div className="product-wizard-step product-wizard-step--active">
                <span className="product-wizard-step__num">1</span>
                <span className="product-wizard-step__label">Категория</span>
              </div>
              <div className="product-wizard-step__line" aria-hidden />
              <div className="product-wizard-step product-wizard-step--pending">
                <span className="product-wizard-step__num">2</span>
                <span className="product-wizard-step__label">Заполнение</span>
              </div>
            </div>
            <div className="product-wizard-panel">
              <CategoryPicker
                key={isEditingProduct ? `edit-cat-${formData.id}` : 'new-product-category'}
                tree={categoryTree}
                groupId={formData.category_group_id}
                categoryId={formData.category_id}
                legacyCategoryText={isEditingProduct ? (formData.category || '') : ''}
                onChange={handleCategoryChange}
                stepCaption={isEditingProduct ? 'Товар' : 'Новый товар'}
                stepTitle="Выберите группу"
              />
              <p className="product-wizard-hint">
                {isEditingProduct && !categoryChosen
                  ? 'Выберите группу и подкатегорию — шаблон полей подстроится под категорию.'
                  : 'Сначала группа (Двигатель, Кузов…), затем подкатегория. Поля товара откроются после выбора.'}
              </p>
              {isEditingProduct && !categoryChosen && (
                <div className="product-form-legacy-banner">
                  Товар по старой схеме. Выберите категорию — цены и остаток сохранятся.
                </div>
              )}
              {changeCategoryMode && (
                <button
                  type="button"
                  className="product-wizard-cancel-change"
                  onClick={() => setChangeCategoryMode(false)}
                >
                  Отмена — оставить текущую категорию
                </button>
              )}
            </div>
          </div>
          )}

          {showFillStep && (
          <div className={`product-form-shell${storefrontPreviewHidden ? ' product-form-shell--no-preview' : ''}`}>
          <div className="product-form-shell__workspace">
          {showFillStep && <ProductFormProgress progress={formProgress} />}
          {storefrontPreviewHidden && (
            <div className="product-form-shell__preview-toggle">
              <button type="button" className="product-form-preview-show-btn" onClick={showStorefrontPreview}>
                <FiGlobe size={15} />
                Показать превью CHPARTS
              </button>
            </div>
          )}
          <div className="product-form-shell__card">
        <form className="ios-form-stack product-form-flow product-form-modal" onSubmit={handleSubmit}>
          {!isEditingProduct && (
            <div className="product-wizard-steps product-wizard-steps--compact" aria-label="Шаги">
              <div className="product-wizard-step product-wizard-step--done">
                <span className="product-wizard-step__num">✓</span>
                <span className="product-wizard-step__label">Категория</span>
              </div>
              <div className="product-wizard-step__line product-wizard-step__line--done" aria-hidden />
              <div className="product-wizard-step product-wizard-step--active">
                <span className="product-wizard-step__num">2</span>
                <span className="product-wizard-step__label">Заполнение</span>
              </div>
            </div>
          )}

          {selectedCategoryGroup && selectedSubcategory && (
            <div className="product-category-summary">
              <span className="product-category-summary__emoji">{selectedCategoryGroup.icon || '📦'}</span>
              <div className="product-category-summary__text">
                <span className="product-category-summary__caption">Категория</span>
                <strong>{selectedCategoryGroup.name} → {selectedSubcategory.name}</strong>
              </div>
              <button type="button" className="product-category-summary__change" onClick={handleRequestCategoryChange}>
                Изменить
              </button>
            </div>
          )}

          <FormAccordionSection
            title="Фото товара"
            subtitle="До 12 фото. Сначала сохраните товар, затем загружайте снимки."
            icon={<FiImage size={17} />}
            iconColor="var(--primary)"
            initiallyExpanded
            className="product-form-photo-section"
          >
          <div className="product-form-photo-section__inner">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface)',
                    flexShrink: 0,
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
                <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                      <FiPlus size={16} />
                      {imageUploading ? `Загрузка${imageUploadPct != null ? ` ${imageUploadPct}%` : '…'}` : 'Добавить фото'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleUploadProductImage}
                        disabled={!formData.id || imageUploading || (formData.image_urls || []).length >= MAX_PRODUCT_PHOTOS}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {(formData.image_urls || []).length > 0 && (
                      <button
                        type="button"
                        className="btn-ios-secondary"
                        onClick={handleDeleteProductImage}
                        disabled={imageUploading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: imageUploading ? 0.6 : 1 }}
                        title="Удалить все фотографии"
                      >
                        <FiTrash2 size={16} />
                        Удалить все
                      </button>
                    )}
                  </div>
                  {imageUploading && imageUploadPct != null && (
                    <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
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
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {(formData.image_urls || []).length}/{MAX_PRODUCT_PHOTOS} в галерее · нажмите миниатюру для крупного просмотра
                  </div>
                </div>
              </div>
              {(formData.image_urls || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                  {(formData.image_urls || []).map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      style={{
                        position: 'relative',
                        width: 64,
                        height: 64,
                        borderRadius: 10,
                        border: galleryFocusIdx === idx ? '2px solid var(--primary)' : '1px solid var(--border)',
                        overflow: 'hidden',
                        background: 'var(--surface)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setGalleryFocusIdx(idx)}
                        style={{
                          width: '100%',
                          height: '100%',
                          padding: 0,
                          border: 'none',
                          cursor: 'pointer',
                          display: 'block',
                        }}
                        title="Показать крупно"
                      >
                        <img src={productImageDisplaySrc(url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </button>
                      <button
                        type="button"
                        className="topbar-theme-toggle"
                        onClick={(e) => { e.stopPropagation(); handleDeleteProductGalleryOne(url); }}
                        disabled={imageUploading || !formData.id}
                        title="Удалить это фото"
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          border: 'none',
                          cursor: imageUploading ? 'not-allowed' : 'pointer',
                          opacity: imageUploading ? 0.5 : 1,
                        }}
                      >
                        <FiX size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </div>
          </FormAccordionSection>

          <FormAccordionSection
            title="Характеристики"
            subtitle="Заполните по шаблону категории"
            icon={<FiPackage size={17} />}
            iconColor="var(--primary)"
            initiallyExpanded
          >
            <ProductFormByLayout
              schema={selectedSubcategorySchema || {}}
              formData={formData}
              onFormDataChange={(updater) => {
                setFormData((prev) => (typeof updater === 'function' ? updater(prev) : updater));
                setFieldErrors((e) => { const n = { ...e }; delete n.name; return n; });
              }}
              disabled={false}
              fieldErrors={fieldErrors}
              categoryName={selectedSubcategory?.name || formData.category || ''}
              categoryGroupName={selectedCategoryGroup?.name || ''}
              compatibilitySlot={compatibilityPickerSlot}
              engineCompatibilitySlot={engineCompatibilitySlot}
              showEngineFamilies={showEngineFamilyPicker}
            />
          </FormAccordionSection>

          <ProductStockFormSection
            formData={formData}
            setFormData={setFormData}
            barcodeLocked={barcodeLocked}
            setBarcodeLocked={setBarcodeLocked}
            barcodeCanvasRef={barcodeCanvasRef}
            sanitizeBarcodeInput={sanitizeBarcodeFieldInput}
            generateEAN13={generateEAN13}
            layoutPriceRows={layoutPriceRows}
            selectedSubcategorySchema={selectedSubcategorySchema}
            cnyRate={cnyRate}
            deliveryKztPerKg={deliveryKztPerKg}
            deliveryMode={deliveryMode}
            setDeliveryMode={setDeliveryMode}
            customDeliveryRate={customDeliveryRate}
            setCustomDeliveryRate={setCustomDeliveryRate}
            settingsDeliveryRate={settingsDeliveryRate}
            highlightStyle={{}}
            profitPreview={profitPreview}
            effPurchasePreview={effPurchasePreview}
            optionalNum={optionalNum}
            num={num}
            skuMatchBanner={!formData.id && (skuTemplateProduct || skuTemplateLoading) ? (
              <SkuMatchBanner
                product={skuTemplateProduct}
                sku={String(formData.sku || '').trim()}
                mode="catalog"
                loading={skuTemplateLoading}
                onCopy={handleSkuTemplateCopy}
                onOpen={handleSkuTemplateOpen}
                onDismiss={handleSkuTemplateDismiss}
              />
            ) : null}
          />
        </form>
          </div>
          </div>
          {!storefrontPreviewHidden && (
            <aside className="product-form-shell__preview">
              <ProductStorefrontPreview preview={storefrontPreview} onHide={hideStorefrontPreview} />
            </aside>
          )}
          </div>
        )}
      </Modal>

      {/* ── Label Print ── */}
      <LabelPrint
        isOpen={showPrint}
        onClose={() => { setShowPrint(false); setPrintProduct(null); }}
        product={printProduct}
        initialLabelLayout={readStoredLabelLayout()}
        labelSize="medium"
      />
      <Modal
        isOpen={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        title="Массово: цены и остаток"
        size="md"
        actions={(
          <>
            <Button variant="secondary" onClick={() => setBulkEditOpen(false)}>Отмена</Button>
            <Button variant="primary" onClick={() => bulkMutation.mutate()} loading={bulkMutation.isPending}>Сохранить</Button>
          </>
        )}
      >
        <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Только для товаров с новой категорией, одной подкатегории. Пустое поле не изменяет текущее значение.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <Input label="Название" value={bulkForm.name} onChange={(e) => setBulkForm((p) => ({ ...p, name: e.target.value }))} />
          <Input label="Марка" value={bulkForm.brand} onChange={(e) => setBulkForm((p) => ({ ...p, brand: e.target.value }))} />
          <Input label="Модель" value={bulkForm.model} onChange={(e) => setBulkForm((p) => ({ ...p, model: e.target.value }))} />
          <Input label="Закуп (₸)" type="number" value={bulkForm.purchase_price} onChange={(e) => setBulkForm((p) => ({ ...p, purchase_price: e.target.value }))} />
          <Input label="Продажа (₸)" type="number" value={bulkForm.sale_price} onChange={(e) => setBulkForm((p) => ({ ...p, sale_price: e.target.value }))} />
          <Input label="Количество" type="number" value={bulkForm.quantity} onChange={(e) => setBulkForm((p) => ({ ...p, quantity: e.target.value }))} />
        </div>
      </Modal>

      <BulkCategoryUpdateModal
        isOpen={bulkCategoryOpen}
        onClose={() => setBulkCategoryOpen(false)}
        products={selectedLegacyProducts}
        categoryTree={categoryTree}
        vehicleBrands={vehicleBrands}
        vehicleModels={vehicleModels}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['products'] });
          queryClient.invalidateQueries({ queryKey: ['products-stats'] });
          setSelectedIds([]);
        }}
      />

      {/* ── Диалог подтверждения смены категории ── */}
      {confirmCategoryChange && (
        <Modal
          isOpen
          title="Сменить категорию?"
          onClose={() => setConfirmCategoryChange(null)}
          size="sm"
          actions={(
            <>
              <Button variant="secondary" onClick={() => setConfirmCategoryChange(null)}>Отмена</Button>
              <Button
                variant="danger"
                onClick={() => {
                  confirmCategoryChange.applyChange();
                  setConfirmCategoryChange(null);
                }}
              >
                Сбросить и сменить
              </Button>
            </>
          )}
        >
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Заполненные характеристики, совместимость и марка/модель будут сброшены.
            Цены и количество останутся. Продолжить?
          </p>
        </Modal>
      )}
    </div>
  );
};

export default Products;
