import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus,
  FiTrash2,
  FiUpload,
  FiChevronLeft,
  FiChevronRight,
  FiTag,
  FiCopy,
  FiSearch,
  FiFileText,
  FiList,
  FiGrid,
  FiPackage,
  FiCheckCircle,
  FiClock,
  FiAlertCircle,
  FiRotateCcw,
  FiRefreshCw,
} from 'react-icons/fi';
import { Button, LoadingSpinner, Modal } from '../components/ui';
import IntakeAddFab from '../components/IntakeAddFab';
import IntakeLineModal from '../components/IntakeLineModal';
import SmartSearchField from '../components/SmartSearchField';
import { intakeApi } from '../api/intake';
import { settingsApi } from '../api/settings';
import { getApiErrorMessage, productApi } from '../api/client';
import { generateEAN13 } from '../utils/barcodeGen';
import { mergeInvoiceLinesWithServer } from '../utils/intakeLineMerge';
import {
  computeInvoiceSummary,
  copyIntakeLine,
  canRevertInvoiceWarehouse,
  canUploadInvoiceToWarehouse,
  fetchLinePhotoUrlsByBarcode,
  getLineThumbSrc,
  intakeLineQty,
  invoiceDateLabel,
  isLineWarehouseReady,
  isLineWarehouseSynced,
  lineMoneyTotals,
  newClientId,
  intakeLineMatchesSearch,
  matchesSmartSearch,
  newIntakeLineId,
  num,
  uploadInvoiceLinesToWarehouse,
  warehouseProductToIntakeLine,
} from '../utils/intakeHelpers';

const INTAKE_VIEW_KEY = 'skladpro_intake_view';

function readViewMode() {
  try {
    const v = localStorage.getItem(INTAKE_VIEW_KEY);
    return v === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function formatKzt(value) {
  return `${num(value).toLocaleString('ru-RU')} ₸`;
}

function IntakeLineMoneyValue({ line, kind }) {
  const t = lineMoneyTotals(line);
  const unit = kind === 'purchase' ? t.unitPurchase : t.unitSale;
  return (
    <span className="intake-line-money">
      <span className="intake-col-value">{unit > 0 ? formatKzt(unit) : '—'}</span>
      {unit > 0 ? <span className="intake-col-hint">за 1 шт</span> : null}
    </span>
  );
}

function linePhotoKey(line) {
  return line?.local_id || line?.barcode || '';
}

function IntakeEmpty({ icon: Icon, title, hint }) {
  return (
    <div className="intake-empty">
      <div className="intake-empty-icon">
        <Icon size={28} />
      </div>
      <div className="intake-empty-title">{title}</div>
      {hint ? <div className="intake-empty-hint">{hint}</div> : null}
    </div>
  );
}

function IntakeLineThumb({ line, photoUrls }) {
  const src = getLineThumbSrc(line, photoUrls);
  return (
    <div className="intake-line-thumb">
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <FiPackage size={22} />
      )}
    </div>
  );
}

function IntakeLineChips({ line }) {
  const chips = [];
  if (isLineWarehouseSynced(line)) {
    chips.push({ key: 'sync', label: 'На складе', className: 'intake-chip intake-chip--synced' });
  }
  if (line.barcode) chips.push({ key: 'bc', label: line.barcode });
  if (line.sku) chips.push({ key: 'sku', label: `SKU ${line.sku}` });
  const brandModel = [line.brand, line.model].filter(Boolean).join(' ');
  if (brandModel) chips.push({ key: 'bm', label: brandModel });
  if (!chips.length) return <span className="intake-line-meta-muted">Нет штрих-кода</span>;
  return (
    <div className="intake-line-chips">
      {chips.map((c) => (
        <span key={c.key} className={c.className || 'intake-chip'}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function IntakeLineActions({ isUploaded, onPrint, onCopy, onDelete }) {
  return (
    <div className="intake-line-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="intake-icon-btn" title="Печать этикетки" onClick={onPrint}>
        <FiTag size={14} />
      </button>
      {!isUploaded && (
        <>
          <button type="button" className="intake-icon-btn" title="Копия" onClick={onCopy}>
            <FiCopy size={14} />
          </button>
          <button
            type="button"
            className="intake-icon-btn intake-icon-btn-danger"
            title="Удалить"
            onClick={onDelete}
          >
            <FiTrash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

function IntakeLineRow({ line, photoUrls, isUploaded, showWarn, onOpen, onPrint, onCopy, onDelete }) {
  const qty = parseInt(line.quantity, 10) || 0;
  const money = lineMoneyTotals(line);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`intake-line-row${showWarn ? ' intake-line-row-warn' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <IntakeLineThumb line={line} photoUrls={photoUrls} />
      <div className="intake-line-row-main">
        <div className="intake-line-title-row">
          <div className="intake-line-title">{line.name || 'Без названия'}</div>
          {showWarn && (
            <span className="intake-line-badge">
              <FiAlertCircle size={12} />
              Не готово
            </span>
          )}
        </div>
        <IntakeLineChips line={line} />
        <div className="intake-line-prices intake-line-prices--mobile">
          <span className="intake-price-pill intake-price-pill--muted">
            Закуп {formatKzt(money.unitPurchase > 0 ? money.unitPurchase : line.purchase_kzt)}
          </span>
          <span className="intake-price-pill intake-price-pill--sale">
            Продажа {formatKzt(money.unitSale > 0 ? money.unitSale : line.sale_price)}
          </span>
        </div>
      </div>
      <div className="intake-line-col intake-line-col-qty">
        <span className="intake-col-label">Кол-во</span>
        <span className="intake-col-value">{qty > 0 ? `${qty} шт` : '—'}</span>
      </div>
      <div className="intake-line-col intake-line-col-purchase">
        <span className="intake-col-label">Закуп</span>
        <IntakeLineMoneyValue line={line} kind="purchase" />
      </div>
      <div className="intake-line-col intake-line-col-sale">
        <span className="intake-col-label">Продажа</span>
        <span className="intake-col-value--primary">
          <IntakeLineMoneyValue line={line} kind="sale" />
        </span>
      </div>
      <IntakeLineActions isUploaded={isUploaded} onPrint={onPrint} onCopy={onCopy} onDelete={onDelete} />
    </div>
  );
}

function IntakeLineGridCard({ line, photoUrls, isUploaded, showWarn, onOpen, onPrint, onCopy, onDelete }) {
  const qty = parseInt(line.quantity, 10) || 0;
  const money = lineMoneyTotals(line);
  const thumb = getLineThumbSrc(line, photoUrls);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`intake-line-card${showWarn ? ' intake-line-card-warn' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="intake-line-card-media">
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <FiPackage size={32} />}
        {qty > 0 && <span className="intake-line-card-qty">{qty} шт</span>}
        {showWarn && (
          <span className="intake-line-card-warn-flag">
            <FiAlertCircle size={12} />
          </span>
        )}
      </div>
      <div className="intake-line-card-body">
        <div className="intake-line-title">{line.name || 'Без названия'}</div>
        <IntakeLineChips line={line} />
      </div>
      <div className="intake-line-card-foot">
        <div className="intake-line-card-price-box">
          <span className="intake-line-card-price-label">Закуп</span>
          <span className="intake-line-card-price-val">
            {formatKzt(money.unitPurchase > 0 ? money.unitPurchase : line.purchase_kzt)}
          </span>
        </div>
        <div className="intake-line-card-price-box intake-line-card-price-box--sale">
          <span className="intake-line-card-price-label">Продажа</span>
          <span className="intake-line-card-price-val">
            {formatKzt(money.unitSale > 0 ? money.unitSale : line.sale_price)}
          </span>
        </div>
        <IntakeLineActions isUploaded={isUploaded} onPrint={onPrint} onCopy={onCopy} onDelete={onDelete} />
      </div>
    </div>
  );
}

function IntakeInvoiceCard({ inv, uploaded, lines, summary, onOpen, onDelete }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="intake-invoice-card"
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className={`intake-invoice-badge${uploaded ? ' intake-invoice-badge-done' : ''}`}>
        {uploaded ? <FiCheckCircle size={22} /> : `#${inv.number}`}
      </div>
      <div className="intake-invoice-body">
        <div className="intake-invoice-top">
          <div className="intake-invoice-title">Накладная №{inv.number}</div>
          <span className={`intake-status-pill${uploaded ? ' intake-status-pill--done' : ''}`}>
            {uploaded ? 'На складе' : 'В работе'}
          </span>
        </div>
        <div className="intake-invoice-meta">
          <span>{inv.date}</span>
          <span className="intake-invoice-dot">·</span>
          <span>{lines.length} поз.</span>
          {lines.length > 0 && (
            <>
              <span className="intake-invoice-dot">·</span>
              <span>Продажа {formatKzt(summary.saleKzt)}</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        className="intake-icon-btn intake-icon-btn-danger"
        onClick={onDelete}
        title="Удалить"
      >
        <FiTrash2 size={16} />
      </button>
      <FiChevronRight className="intake-invoice-chevron" size={20} />
    </div>
  );
}

function IntakeViewToggle({ viewMode, onChange }) {
  return (
    <div className="intake-view-toggle" role="group" aria-label="Вид карточек">
      <button
        type="button"
        className={`intake-view-btn${viewMode === 'list' ? ' intake-view-btn-active' : ''}`}
        onClick={() => onChange('list')}
        title="Строки"
      >
        <FiList size={16} />
        <span>Строки</span>
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

function IntakeList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['intake-invoices'],
    queryFn: async () => {
      const r = await intakeApi.list();
      return Array.isArray(r.data) ? r.data : [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const stats = useMemo(() => {
    let onWarehouse = 0;
    for (const inv of invoices) {
      if (inv.uploaded === true) onWarehouse += 1;
    }
    return { total: invoices.length, onWarehouse, draft: invoices.length - onWarehouse };
  }, [invoices]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const numRes = await intakeApi.nextNumber();
      const number = numRes.data?.next ?? 1;
      const inv = {
        id: newClientId(),
        number,
        date: invoiceDateLabel(),
        lines: [],
        uploaded: false,
        pending_warehouse_upload: false,
        uploaded_at: null,
      };
      await intakeApi.upsert(inv);
      return inv;
    },
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
      navigate(`/intake/${inv.id}`);
      toast.success(`Накладная №${inv.number} создана`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => intakeApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
      toast.success('Накладная удалена');
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const n = String(inv.number ?? '');
      const d = String(inv.date ?? '');
      if (matchesSmartSearch(`${n} ${d}`, q)) return true;
      const lines = Array.isArray(inv.lines) ? inv.lines : [];
      return lines.some((l) => intakeLineMatchesSearch(l, q));
    });
  }, [invoices, search]);

  return (
    <div className="page-stack intake-page">
      <div className="intake-hero">
        <div className="intake-hero-content">
          <div className="intake-hero-icon-wrap">
            <FiFileText size={26} />
          </div>
          <div>
            <h1 className="intake-hero-title">Накладные</h1>
            <p className="intake-hero-sub">
              Поступление товара, печать этикеток на принтере и загрузка позиций на склад.
            </p>
          </div>
        </div>
        <Button icon={FiPlus} onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
          Новая накладная
        </Button>
      </div>

      {invoices.length > 0 && (
        <div className="intake-stats">
          <span className="intake-stat-pill">
            <FiFileText size={14} />
            <strong>{stats.total}</strong> всего
          </span>
          <span className="intake-stat-pill intake-stat-pill--draft">
            <FiClock size={14} />
            <strong>{stats.draft}</strong> в работе
          </span>
          <span className="intake-stat-pill intake-stat-pill--done">
            <FiCheckCircle size={14} />
            <strong>{stats.onWarehouse}</strong> на складе
          </span>
        </div>
      )}

      <div className="intake-toolbar intake-toolbar--stacked">
        <SmartSearchField
          className="intake-toolbar-search"
          value={search}
          onChange={setSearch}
          placeholder="Накладные, штрих-код, название…"
          enableVoice
        />
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <IntakeEmpty
          icon={FiFileText}
          title={invoices.length === 0 ? 'Пока нет накладных' : 'Ничего не найдено'}
          hint={invoices.length === 0 ? 'Создайте накладную и добавьте товары для печати этикеток' : 'Попробуйте другой запрос'}
        />
      ) : (
        <div className="intake-invoices-list">
          {filtered.map((inv) => {
            const lines = Array.isArray(inv.lines) ? inv.lines : [];
            const uploaded = inv.uploaded === true;
            const summary = computeInvoiceSummary(lines);
            return (
              <IntakeInvoiceCard
                key={inv.id}
                inv={inv}
                uploaded={uploaded}
                lines={lines}
                summary={summary}
                onOpen={() => navigate(`/intake/${inv.id}`)}
                onDelete={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Удалить накладную №${inv.number}?`)) {
                    deleteMutation.mutate(inv.id);
                  }
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function IntakeDetail() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [onlyNotReady, setOnlyNotReady] = useState(false);
  const [lineModal, setLineModal] = useState(null);
  const [seedLine, setSeedLine] = useState(null);
  const [duplicateIndex, setDuplicateIndex] = useState(null);
  const [lineReadonly, setLineReadonly] = useState(false);
  const [viewMode, setViewMode] = useState(readViewMode);
  const [linePhotoUrls, setLinePhotoUrls] = useState({});

  useEffect(() => {
    try {
      localStorage.setItem(INTAKE_VIEW_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const { data: settingsRow } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await settingsApi.getSettings();
      return r.data;
    },
  });

  const cnyRate = num(settingsRow?.cny_rate) || 65;
  const deliveryPerKg = num(settingsRow?.delivery_kzt_per_kg) || 800;
  const labelSize = 'medium';

  const { data: invoices = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['intake-invoices'],
    queryFn: async () => {
      const r = await intakeApi.list();
      return Array.isArray(r.data) ? r.data : [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const invoice = useMemo(
    () => invoices.find((x) => String(x.id) === String(clientId)),
    [invoices, clientId],
  );

  const isUploaded = invoice?.uploaded === true;
  const lines = useMemo(
    () => (Array.isArray(invoice?.lines) ? invoice.lines : []),
    [invoice],
  );

  useEffect(() => {
    let cancelled = false;
    fetchLinePhotoUrlsByBarcode(lines).then((map) => {
      if (!cancelled) setLinePhotoUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const summary = useMemo(() => computeInvoiceSummary(lines), [lines]);
  const canRevert = useMemo(
    () => canRevertInvoiceWarehouse(invoice, lines),
    [invoice, lines],
  );
  const uploadCheck = useMemo(
    () => canUploadInvoiceToWarehouse(lines, { uploaded: isUploaded }),
    [lines, isUploaded],
  );

  const saveInvoice = async (nextLines) => {
    if (!invoice) return;
    let serverInvoice = invoice;
    try {
      const r = await intakeApi.list();
      const list = Array.isArray(r.data) ? r.data : [];
      const fresh = list.find((x) => String(x.id) === String(invoice.id));
      if (fresh) serverInvoice = fresh;
    } catch {
      /* use cached invoice */
    }
    const mergedLines = mergeInvoiceLinesWithServer(serverInvoice, nextLines);
    await intakeApi.upsert({
      id: invoice.id,
      number: invoice.number,
      date: invoice.date,
      lines: mergedLines,
      uploaded: invoice.uploaded,
      pending_warehouse_upload: invoice.pending_warehouse_upload,
      uploaded_at: invoice.uploaded_at,
    });
    queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!invoice || lines.length === 0) throw new Error('Накладная пуста');
      const check = canUploadInvoiceToWarehouse(lines, { uploaded: isUploaded });
      if (!check.ok) throw new Error(check.message);
      const { lines: nextLines, ...report } = await uploadInvoiceLinesToWarehouse(lines, cnyRate);
      if (report.errors.length && report.created === 0 && report.updated === 0) {
        throw new Error(report.errors[0]);
      }
      const now = new Date();
      const uploadedAt = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await intakeApi.upsert({
        id: invoice.id,
        number: invoice.number,
        date: invoice.date,
        lines: nextLines,
        uploaded: true,
        pending_warehouse_upload: false,
        uploaded_at: uploadedAt,
      });
      return report;
    },
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const photoMsg = report.photosUploaded > 0 ? `, фото ${report.photosUploaded}` : '';
      toast.success(`На склад: создано ${report.created}, обновлено ${report.updated}${photoMsg}`);
      if (report.errors.length) toast.error(report.errors.slice(0, 3).join('; '));
    },
    onError: (e) => toast.error(getApiErrorMessage(e, String(e.message || e))),
  });

  const revertMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('Накладная не найдена');
      const r = await intakeApi.revertWarehouse(invoice.id);
      return r.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const msg = `Отменено: снято ${data.removed}, уменьшено ${data.updated}`;
      toast.success(msg);
      if (data.warnings?.length) toast.error(data.warnings.slice(0, 2).join('; '));
    },
    onError: (e) => toast.error(getApiErrorMessage(e, String(e.message || e))),
  });

  const visibleLines = useMemo(() => {
    const q = search.trim();
    let items = lines.map((l, i) => ({ line: l, index: i }));
    if (onlyNotReady && !isUploaded) {
      items = items.filter(({ line: l }) => !isLineWarehouseReady(l));
    }
    if (q) {
      items = items.filter(({ line: l }) => intakeLineMatchesSearch(l, q));
    }
    if (!isUploaded) {
      items = [...items].sort((a, b) => {
        const ar = isLineWarehouseReady(a.line) ? 1 : 0;
        const br = isLineWarehouseReady(b.line) ? 1 : 0;
        return ar - br;
      });
    }
    return items;
  }, [lines, search, onlyNotReady, isUploaded]);

  const closeLineModal = () => {
    setLineModal(null);
    setSeedLine(null);
  };

  const openNewLine = (seed = null) => {
    setSeedLine(seed);
    setLineReadonly(false);
    setLineModal(-1);
  };

  const openLine = (index, readonly = false) => {
    setSeedLine(null);
    setLineReadonly(readonly || isUploaded);
    setLineModal(index);
  };

  const findLineIndexByBarcode = (code) => {
    const c = String(code || '').trim();
    if (c.length < 4) return null;
    for (let i = 0; i < lines.length; i++) {
      if (String(lines[i]?.barcode || '').trim() === c) return i;
    }
    return null;
  };

  const appendLineFromWarehouse = async (product) => {
    const line = warehouseProductToIntakeLine(product);
    const next = [...lines, line];
    await saveInvoice(next);
    toast.success(`«${line.name || 'Товар'}» добавлен из склада — укажите количество`);
  };

  const incrementLineQty = async (index) => {
    const next = lines.map((l, i) => {
      if (i !== index) return l;
      const qty = intakeLineQty(l) + 1;
      return { ...l, quantity: qty };
    });
    await saveInvoice(next);
    toast.success(`«${next[index]?.name}»: ${intakeLineQty(next[index])} шт`);
  };

  const processBarcodeForAdd = async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (code.length < 4) {
      toast.error('Штрих-код слишком короткий');
      return;
    }
    const existing = findLineIndexByBarcode(code);
    if (existing != null) {
      setDuplicateIndex(existing);
      return;
    }
    try {
      const res = await productApi.getByBarcode(code, { allow404: true });
      if (res.status === 200 && res.data) {
        await appendLineFromWarehouse(res.data);
        return;
      }
    } catch {
      /* откроем форму */
    }
    openNewLine({ barcode: code, local_id: newIntakeLineId() });
  };

  const handleEnterBarcode = () => {
    const code = window.prompt('Штрих-код товара');
    if (code == null || !String(code).trim()) return;
    processBarcodeForAdd(code.trim());
  };

  const handleAutoBarcode = () => {
    openNewLine({ barcode: generateEAN13(), local_id: newIntakeLineId() });
  };

  const handleLineSave = async (saved) => {
    const next = [...lines];
    if (lineModal != null && lineModal >= 0 && lineModal < next.length) {
      next[lineModal] = saved;
    } else {
      next.push(saved);
    }
    await saveInvoice(next);
    toast.success('Позиция сохранена');
    closeLineModal();
  };

  const handleCopyLine = async (index) => {
    if (isUploaded) {
      toast.error('Накладная на складе — только просмотр');
      return;
    }
    const next = [...lines];
    next.splice(index + 1, 0, copyIntakeLine(lines[index]));
    await saveInvoice(next);
    toast.success('Копия создана');
  };

  const handleDeleteLine = async (index) => {
    if (isUploaded) return;
    if (!window.confirm(`Удалить «${lines[index]?.name}»?`)) return;
    const next = lines.filter((_, i) => i !== index);
    await saveInvoice(next);
    toast.success('Позиция удалена');
  };

  const handleUploadClick = () => {
    if (!uploadCheck.ok) {
      toast.error(uploadCheck.message);
      return;
    }
    uploadMutation.mutate();
  };

  const handleRevertClick = () => {
    if (
      !window.confirm(
        'Отменить загрузку на склад?\n\nТовары будут сняты со склада (количество уменьшится), но останутся в накладной для редактирования.',
      )
    ) {
      return;
    }
    revertMutation.mutate();
  };

  const handleRefresh = async () => {
    try {
      await refetch();
      toast.success('Накладная обновлена');
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Не удалось обновить накладную'));
    }
  };

  const renderLine = ({ line: l, index }) => {
    const showWarn = !isUploaded && !isLineWarehouseSynced(l) && !isLineWarehouseReady(l);
    const handlers = {
      onOpen: () => openLine(index, isUploaded),
      onPrint: (e) => {
        e?.stopPropagation?.();
        setLineReadonly(isUploaded);
        setLineModal(index);
      },
      onCopy: (e) => {
        e?.stopPropagation?.();
        handleCopyLine(index);
      },
      onDelete: (e) => {
        e?.stopPropagation?.();
        handleDeleteLine(index);
      },
    };

    const props = {
      line: l,
      photoUrls: linePhotoUrls[linePhotoKey(l)],
      isUploaded,
      showWarn,
      onOpen: handlers.onOpen,
      onPrint: () => handlers.onPrint(),
      onCopy: () => handlers.onCopy(),
      onDelete: () => handlers.onDelete(),
    };

    if (viewMode === 'grid') {
      return <IntakeLineGridCard key={l.local_id || index} {...props} />;
    }
    return <IntakeLineRow key={l.local_id || index} {...props} />;
  };

  if (isLoading) return <LoadingSpinner />;
  if (!invoice) {
    return (
      <div className="page-stack intake-page">
        <Button variant="secondary" icon={FiChevronLeft} onClick={() => navigate('/intake')}>
          К списку
        </Button>
        <div className="empty-grid-state">Накладная не найдена</div>
      </div>
    );
  }

  return (
    <div className="page-stack intake-page intake-page--detail">
      <div className="intake-detail-hero">
        <div className="intake-detail-hero-left">
          <button type="button" className="intake-back-btn" onClick={() => navigate('/intake')} aria-label="Назад">
            <FiChevronLeft size={20} />
          </button>
          <div>
            <div className="intake-detail-hero-kicker">Накладная</div>
            <h1 className="intake-detail-hero-title">№{invoice.number}</h1>
            <p className="intake-detail-hero-sub">
              {invoice.date}
              {invoice.uploaded_at && isUploaded ? ` · загружена ${invoice.uploaded_at}` : ''}
            </p>
          </div>
        </div>
        <div className="intake-detail-hero-right">
          <Button
            variant="secondary"
            icon={FiRefreshCw}
            onClick={handleRefresh}
            loading={isFetching}
            title="Обновить с сервера"
          >
            Обновить
          </Button>
          <span className={`intake-status-pill intake-status-pill--lg${isUploaded ? ' intake-status-pill--done' : ''}`}>
            {isUploaded ? (
              <>
                <FiCheckCircle size={14} />
                На складе
              </>
            ) : (
              <>
                <FiClock size={14} />
                В работе
              </>
            )}
          </span>
          {canRevert && (
            <Button
              variant="secondary"
              icon={FiRotateCcw}
              onClick={handleRevertClick}
              loading={revertMutation.isPending}
            >
              Отменить загрузку
            </Button>
          )}
          {!isUploaded && lines.length > 0 && (
            <Button
              icon={FiUpload}
              onClick={handleUploadClick}
              loading={uploadMutation.isPending}
              disabled={!uploadCheck.ok || uploadMutation.isPending}
              title={uploadCheck.ok ? undefined : uploadCheck.message}
            >
              {uploadMutation.isPending ? 'Загрузка…' : 'В склад'}
            </Button>
          )}
        </div>
      </div>

      {isUploaded && (
        <div className="intake-alert intake-alert-success">
          <FiCheckCircle size={18} className="intake-alert-icon" />
          <span>
            Накладная на складе. Чтобы снова редактировать позиции — нажмите «Отменить загрузку»:
            товары снимутся со склада, но останутся в накладной.
          </span>
        </div>
      )}

      {!isUploaded && summary.notReadyCount > 0 && lines.length > 0 && (
        <div className="intake-alert intake-alert-warn">
          <FiAlertCircle size={18} className="intake-alert-icon" />
          <span>
            Не все позиции готовы к складу ({summary.notReadyCount} из {summary.positions}).
            Загрузка будет доступна только когда все строки заполнены и категории обновлены.
          </span>
        </div>
      )}

      {lines.length > 0 && (
        <div className="intake-summary-bar">
          <div className="intake-summary-item intake-summary-item--accent">
            <div className="intake-summary-label">Позиций</div>
            <div className="intake-summary-value">{summary.positions}</div>
          </div>
          <div className="intake-summary-item">
            <div className="intake-summary-label">Сумма закупа</div>
            <div className="intake-summary-value">{formatKzt(summary.purchaseKzt)}</div>
          </div>
          <div className="intake-summary-item intake-summary-item--primary">
            <div className="intake-summary-label">Сумма продажи</div>
            <div className="intake-summary-value intake-summary-value-primary">
              {formatKzt(summary.saleKzt)}
            </div>
          </div>
          {summary.syncedCount > 0 && !isUploaded && (
            <div className="intake-summary-item intake-summary-item--done">
              <div className="intake-summary-label">На складе</div>
              <div className="intake-summary-value intake-summary-value-done">{summary.syncedCount}</div>
            </div>
          )}
          {summary.notReadyCount > 0 && !isUploaded && (
            <div className="intake-summary-item intake-summary-item--warn">
              <div className="intake-summary-label">Не готово к складу</div>
              <div className="intake-summary-value intake-summary-value-warn">{summary.notReadyCount}</div>
            </div>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <div className="intake-toolbar-panel">
          <div className="intake-toolbar intake-toolbar--stacked">
            <SmartSearchField
              className="intake-toolbar-search"
              value={search}
              onChange={setSearch}
              placeholder="Поиск по позициям: название, штрих-код, артикул…"
              enableVoice
            />
            <div className="intake-toolbar-row">
              {!isUploaded && summary.notReadyCount > 0 && (
                <button
                  type="button"
                  className={`intake-filter-chip${onlyNotReady ? ' intake-filter-chip--active' : ''}`}
                  onClick={() => setOnlyNotReady((v) => !v)}
                >
                  <FiAlertCircle size={14} />
                  Не готовые · {summary.notReadyCount}
                </button>
              )}
              <IntakeViewToggle viewMode={viewMode} onChange={setViewMode} />
            </div>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <IntakeEmpty
          icon={FiPackage}
          title="Позиций пока нет"
          hint="Добавьте товар, заполните цены и количество — затем загрузите на склад"
        />
      ) : visibleLines.length === 0 ? (
        <IntakeEmpty
          icon={onlyNotReady ? FiAlertCircle : FiSearch}
          title="Ничего не найдено"
          hint={
            onlyNotReady
              ? 'Все позиции готовы к складу — снимите фильтр'
              : 'Измените запрос в поиске'
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="intake-lines-grid">{visibleLines.map(renderLine)}</div>
      ) : (
        <div className="intake-lines-list">{visibleLines.map(renderLine)}</div>
      )}

      <IntakeAddFab
        disabled={isUploaded}
        showScan={false}
        onAutoBarcode={handleAutoBarcode}
        onEnterBarcode={handleEnterBarcode}
      />

      <Modal
        isOpen={duplicateIndex != null}
        onClose={() => setDuplicateIndex(null)}
        title="Уже в накладной"
      >
        {duplicateIndex != null && (
          <div className="intake-duplicate-modal">
            <p className="intake-duplicate-modal-text">
              «{lines[duplicateIndex]?.name || 'Товар'}»
              {intakeLineQty(lines[duplicateIndex]) > 0
                ? ` · ${intakeLineQty(lines[duplicateIndex])} шт`
                : ''}
            </p>
            <div className="intake-duplicate-modal-actions">
              <Button
                onClick={async () => {
                  await incrementLineQty(duplicateIndex);
                  setDuplicateIndex(null);
                }}
              >
                +1 к количеству
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  openLine(duplicateIndex);
                  setDuplicateIndex(null);
                }}
              >
                Открыть позицию
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <IntakeLineModal
        isOpen={lineModal !== null}
        onClose={closeLineModal}
        line={lineModal != null && lineModal >= 0 ? lines[lineModal] : null}
        seedLine={lineModal === -1 ? seedLine : null}
        onSave={handleLineSave}
        readonly={lineReadonly}
        cnyRate={cnyRate}
        deliveryPerKg={deliveryPerKg}
        labelSize={labelSize}
      />
    </div>
  );
}

export default function Intake() {
  const { clientId } = useParams();
  if (clientId) return <IntakeDetail />;
  return <IntakeList />;
}
