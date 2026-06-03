import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus,
  FiTrash2,
  FiUpload,
  FiChevronLeft,
  FiTag,
  FiCopy,
  FiSearch,
  FiFileText,
} from 'react-icons/fi';
import { Button, LoadingSpinner } from '../components/ui';
import IntakeLineModal from '../components/IntakeLineModal';
import { intakeApi } from '../api/intake';
import { settingsApi } from '../api/settings';
import { getApiErrorMessage } from '../api/client';
import {
  computeInvoiceSummary,
  copyIntakeLine,
  invoiceDateLabel,
  newClientId,
  num,
  uploadInvoiceLinesToWarehouse,
} from '../utils/intakeHelpers';

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
  });

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
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const n = String(inv.number ?? '');
      const d = String(inv.date ?? '').toLowerCase();
      if (n.includes(q) || d.includes(q)) return true;
      const lines = Array.isArray(inv.lines) ? inv.lines : [];
      return lines.some((l) => {
        const name = (l.name || '').toLowerCase();
        const bc = (l.barcode || '').toLowerCase();
        const sku = (l.sku || '').toLowerCase();
        return name.includes(q) || bc.includes(q) || sku.includes(q);
      });
    });
  }, [invoices, search]);

  return (
    <div className="page-stack">
      <div className="section-header">
        <div>
          <h1 className="page-title">Накладные</h1>
          <p className="page-subtitle">Поступление товара · печать этикеток · загрузка на склад</p>
        </div>
        <Button icon={FiPlus} onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
          Новая накладная
        </Button>
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <div style={{ position: 'relative' }}>
          <FiSearch size={18} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
          <input
            className="ios-input"
            style={{ paddingLeft: 40 }}
            placeholder="Поиск: №, дата, штрих-код, артикул, название"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <div className="empty-grid-state">
          {invoices.length === 0 ? 'Создайте первую накладную' : 'Ничего не найдено'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map((inv) => {
            const lines = Array.isArray(inv.lines) ? inv.lines : [];
            const uploaded = inv.uploaded === true;
            return (
              <div
                key={inv.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/intake/${inv.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/intake/${inv.id}`)}
                style={{
                  textAlign: 'left',
                  padding: '16px 18px',
                  borderRadius: 16,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: 'var(--primary-light)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  #{inv.number}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Накладная №{inv.number}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {inv.date} · {lines.length} поз.
                    {uploaded ? ' · на складе' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Удалить накладную №${inv.number}?`)) {
                      deleteMutation.mutate(inv.id);
                    }
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Удалить"
                >
                  <FiTrash2 size={16} />
                </button>
              </div>
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
  const [lineModal, setLineModal] = useState(null);
  const [lineReadonly, setLineReadonly] = useState(false);

  const { data: settingsRow } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await settingsApi.getSettings();
      return r.data;
    },
  });

  const cnyRate = num(settingsRow?.cny_rate) || 65;
  const deliveryPerKg = num(settingsRow?.delivery_kzt_per_kg) || 800;
  const labelSize = settingsRow?.label_size || 'small';

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['intake-invoices'],
    queryFn: async () => {
      const r = await intakeApi.list();
      return Array.isArray(r.data) ? r.data : [];
    },
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

  const summary = useMemo(() => computeInvoiceSummary(lines), [lines]);

  const saveInvoice = async (nextLines) => {
    if (!invoice) return;
    await intakeApi.upsert({
      id: invoice.id,
      number: invoice.number,
      date: invoice.date,
      lines: nextLines,
      uploaded: invoice.uploaded,
      pending_warehouse_upload: invoice.pending_warehouse_upload,
      uploaded_at: invoice.uploaded_at,
    });
    queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!invoice || lines.length === 0) throw new Error('Накладная пуста');
      const report = await uploadInvoiceLinesToWarehouse(lines, cnyRate);
      if (report.errors.length && report.created === 0 && report.updated === 0) {
        throw new Error(report.errors[0]);
      }
      const now = new Date();
      const uploadedAt = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await intakeApi.upsert({
        id: invoice.id,
        number: invoice.number,
        date: invoice.date,
        lines,
        uploaded: true,
        pending_warehouse_upload: false,
        uploaded_at: uploadedAt,
      });
      return report;
    },
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['intake-invoices'] });
      toast.success(`На склад: создано ${report.created}, обновлено ${report.updated}`);
      if (report.errors.length) toast.error(report.errors.join('; '));
    },
    onError: (e) => toast.error(getApiErrorMessage(e, String(e.message || e))),
  });

  const visibleLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines.map((l, i) => ({ line: l, index: i }));
    return lines
      .map((l, i) => ({ line: l, index: i }))
      .filter(({ line: l }) => {
        const name = (l.name || '').toLowerCase();
        const bc = (l.barcode || '').toLowerCase();
        const sku = (l.sku || '').toLowerCase();
        return name.includes(q) || bc.includes(q) || sku.includes(q);
      });
  }, [lines, search]);

  const openLine = (index, readonly = false) => {
    setLineReadonly(readonly || isUploaded);
    setLineModal(index);
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

  if (isLoading) return <LoadingSpinner />;
  if (!invoice) {
    return (
      <div className="page-stack">
        <Button variant="secondary" icon={FiChevronLeft} onClick={() => navigate('/intake')}>
          К списку
        </Button>
        <div className="empty-grid-state">Накладная не найдена</div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="section-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button
            type="button"
            onClick={() => navigate('/intake')}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FiChevronLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Накладная №{invoice.number}</h1>
            <p className="page-subtitle">
              {invoice.date}
              {isUploaded ? ' · на складе (только просмотр)' : ' · редактирование'}
            </p>
          </div>
        </div>
        {!isUploaded && lines.length > 0 && (
          <Button
            icon={FiUpload}
            onClick={() => uploadMutation.mutate()}
            loading={uploadMutation.isPending}
          >
            В склад
          </Button>
        )}
      </div>

      {isUploaded && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 14,
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.25)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--success)',
          }}
        >
          Накладная загружена на склад. Изменения и добавление отключены. Позиции можно открыть для просмотра и печати этикеток.
        </div>
      )}

      {lines.length > 0 && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 14,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>{summary.positions} поз.</span>
          <span>Закуп: {summary.purchaseKzt.toLocaleString('ru-RU')} ₸</span>
          <span style={{ color: 'var(--primary)' }}>
            Продажа: {summary.saleKzt.toLocaleString('ru-RU')} ₸
          </span>
          {summary.notReadyCount > 0 && !isUploaded && (
            <span style={{ color: 'var(--warning)' }}>
              Не готово к складу: {summary.notReadyCount}
            </span>
          )}
        </div>
      )}

      {!isUploaded && (
        <div style={{ display: 'flex', gap: 10 }}>
          <Button icon={FiPlus} onClick={() => { setLineReadonly(false); setLineModal(-1); }}>
            Добавить товар
          </Button>
        </div>
      )}

      {lines.length > 0 && (
        <div style={{ maxWidth: 480, marginBottom: 8 }}>
          <input
            className="ios-input"
            placeholder="Поиск по названию, штрих-коду, артикулу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {lines.length === 0 ? (
        <div className="empty-grid-state">
          <FiFileText size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>Добавьте первую позицию</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {visibleLines.map(({ line: l, index }) => (
            <div
              key={l.local_id || index}
              role="button"
              tabIndex={0}
              onClick={() => openLine(index, isUploaded)}
              onKeyDown={(e) => e.key === 'Enter' && openLine(index, isUploaded)}
              style={{
                padding: '14px 16px',
                borderRadius: 16,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{l.name}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    title="Печать этикетки"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLineReadonly(isUploaded);
                      setLineModal(index);
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FiTag size={14} />
                  </button>
                  {!isUploaded && (
                    <>
                      <button
                        type="button"
                        title="Копия"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyLine(index);
                        }}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <FiCopy size={14} />
                      </button>
                      <button
                        type="button"
                        title="Удалить"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteLine(index);
                        }}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <FiTrash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {l.barcode || '—'} · {l.brand || ''} {l.model || ''}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Закуп: {num(l.purchase_kzt).toLocaleString('ru-RU')} ₸ · Прод:{' '}
                {num(l.sale_price).toLocaleString('ru-RU')} ₸
                {l.quantity ? ` · ${l.quantity} шт` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <IntakeLineModal
        isOpen={lineModal !== null}
        onClose={() => setLineModal(null)}
        line={lineModal != null && lineModal >= 0 ? lines[lineModal] : null}
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
