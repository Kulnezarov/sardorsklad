import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FiTag, FiPrinter } from 'react-icons/fi';
import { Button, Input, Modal, TextArea } from './ui';
import LabelPrint from './LabelPrint';
import { productApi } from '../api/client';
import { generateEAN13 } from '../utils/barcodeGen';
import {
  addCnyHistory,
  computeLinePurchase,
  fetchCnyHistory,
  lineToProductForPrint,
  num,
  roundKg3,
  roundMoney2,
  roundWeight2,
} from '../utils/intakeHelpers';

const DELIVERY_MODES = [
  { key: 'normal', label: 'Обычная', sub: (rate) => `${rate.toLocaleString('ru-RU')} ₸/кг` },
  { key: 'express', label: 'Экспресс', sub: () => '2 000 ₸/кг' },
  { key: 'custom', label: 'Своя цена', sub: () => '₸/кг' },
];

function emptyForm() {
  return {
    barcode: generateEAN13(),
    sku: '',
    name: '',
    brand: '',
    model: '',
    category: '',
    manufacturer: '',
    extra_info: '',
    cny_price: '',
    delivery_kg: '',
    delivery_kzt: '',
    sale_price: '',
    quantity: '',
  };
}

function lineToForm(line) {
  if (!line) return emptyForm();
  return {
    barcode: line.barcode || '',
    sku: line.sku || '',
    name: line.name || '',
    brand: line.brand || '',
    model: line.model || '',
    category: line.category || '',
    manufacturer: line.manufacturer || '',
    extra_info: line.extra_info || '',
    cny_price: num(line.cny_price) > 0 ? String(line.cny_price) : '',
    delivery_kg: num(line.delivery_kg) > 0 ? String(line.delivery_kg) : '',
    delivery_kzt: num(line.delivery_kzt) > 0 ? String(line.delivery_kzt) : '',
    sale_price: num(line.sale_price) > 0 ? String(line.sale_price) : '',
    quantity: line.quantity != null && parseInt(line.quantity, 10) > 0 ? String(line.quantity) : '',
  };
}

export default function IntakeLineModal({
  isOpen,
  onClose,
  line,
  onSave,
  readonly = false,
  cnyRate = 65,
  deliveryPerKg = 800,
  labelSize = 'small',
}) {
  const [form, setForm] = useState(emptyForm);
  const [deliveryMode, setDeliveryMode] = useState('normal');
  const [customRate, setCustomRate] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [knownOnWarehouse, setKnownOnWarehouse] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [printType, setPrintType] = useState('barcode');
  const [cnyHistory, setCnyHistory] = useState([]);

  const deliveryRate = useMemo(() => {
    if (deliveryMode === 'express') return 2000;
    if (deliveryMode === 'custom') {
      const c = num(customRate);
      if (c > 0) return c;
      const del = num(form.delivery_kzt);
      const kg = num(form.delivery_kg);
      if (del > 0 && kg > 0) return del / kg;
      return 0;
    }
    return num(deliveryPerKg) || 800;
  }, [deliveryMode, customRate, form.delivery_kzt, form.delivery_kg, deliveryPerKg]);

  const purchasePreview = useMemo(
    () => computeLinePurchase(form.cny_price, form.delivery_kzt, cnyRate),
    [form.cny_price, form.delivery_kzt, cnyRate],
  );

  useEffect(() => {
    if (!isOpen) return;
    setForm(lineToForm(line));
    setDeliveryMode('normal');
    setCustomRate('');
    setKnownOnWarehouse(false);
    setShowPrint(false);
    if (line?.barcode) {
      fetchCnyHistory(line.barcode).then(setCnyHistory);
    } else {
      setCnyHistory([]);
    }
  }, [isOpen, line]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const formatDeliveryKzt = (v) => {
    const r = roundMoney2(v);
    return r === Math.round(r) ? String(Math.round(r)) : String(r);
  };

  const onKgChanged = useCallback(
    (kgText, rate = deliveryRate) => {
      const kg = num(kgText);
      setForm((f) => {
        const next = { ...f };
        if (kg > 0 && rate > 0) {
          next.delivery_kzt = formatDeliveryKzt(kg * rate);
        } else if (!String(kgText).trim()) {
          next.delivery_kzt = '';
        }
        return next;
      });
    },
    [deliveryRate],
  );

  const onKztChanged = useCallback(
    (kztText, rate = deliveryRate) => {
      const v = num(kztText);
      setForm((f) => {
        const next = { ...f };
        if (v > 0 && rate > 0) {
          const kg = roundKg3(v / rate);
          next.delivery_kg =
            kg === Math.round(kg)
              ? String(Math.round(kg))
              : String(kg)
                  .replace(/0+$/, '')
                  .replace(/\.$/, '');
        } else if (!String(kztText).trim()) {
          next.delivery_kg = '';
        }
        return next;
      });
    },
    [deliveryRate],
  );

  const applyWarehouseProduct = useCallback(
    async (p, { updateBarcode = false } = {}) => {
      const bc = updateBarcode && p.barcode ? p.barcode : form.barcode;
      if (updateBarcode && p.barcode) setField('barcode', p.barcode);
      const history = await fetchCnyHistory(bc);
      setCnyHistory(history);
      setKnownOnWarehouse(true);
      setForm((f) => {
        const next = { ...f };
        if (!next.sku.trim()) next.sku = p.sku || '';
        if (!next.name.trim()) next.name = p.name || '';
        if (!next.brand.trim()) next.brand = p.brand || '';
        if (!next.model.trim()) next.model = p.model || '';
        if (!next.category.trim()) next.category = p.category || '';
        if (!next.manufacturer.trim()) next.manufacturer = p.supplier || '';
        if (!next.extra_info.trim()) next.extra_info = p.description || '';
        if (!next.cny_price.trim()) {
          const latest = history[0];
          if (latest?.cny > 0) {
            next.cny_price = String(latest.cny);
            if (latest.delivery_kzt > 0) next.delivery_kzt = String(Math.round(latest.delivery_kzt));
          } else if (num(p.cny_price) > 0) {
            next.cny_price = String(p.cny_price);
          }
        }
        if (!next.delivery_kzt.trim() && num(p.delivery_cost_kzt) > 0) {
          next.delivery_kzt = String(Math.round(p.delivery_cost_kzt));
        }
        if (!next.sale_price.trim() && num(p.sale_price) > 0) {
          next.sale_price = String(p.sale_price);
        }
        return next;
      });
    },
    [form.barcode],
  );

  const lookupBarcode = useCallback(async () => {
    const code = String(form.barcode || '').trim();
    if (code.length < 4) {
      setKnownOnWarehouse(false);
      return;
    }
    setLookingUp(true);
    try {
      const res = await productApi.getByBarcode(code, { allow404: true });
      if (res.status === 200 && res.data) {
        await applyWarehouseProduct(res.data);
      } else {
        setKnownOnWarehouse(false);
      }
    } catch {
      setKnownOnWarehouse(false);
    } finally {
      setLookingUp(false);
    }
  }, [form.barcode, applyWarehouseProduct]);

  const lookupSku = useCallback(async () => {
    const sku = String(form.sku || '').trim();
    if (sku.length < 2) {
      setKnownOnWarehouse(false);
      return;
    }
    setLookingUp(true);
    try {
      const res = await productApi.getBySku(sku, { allow404: true });
      if (res.status === 200 && res.data) {
        await applyWarehouseProduct(res.data, { updateBarcode: true });
      } else {
        setKnownOnWarehouse(false);
      }
    } catch {
      setKnownOnWarehouse(false);
    } finally {
      setLookingUp(false);
    }
  }, [form.sku, applyWarehouseProduct]);

  useEffect(() => {
    if (!isOpen || readonly) return undefined;
    const t = setTimeout(() => {
      if (form.barcode.trim().length >= 4) lookupBarcode();
    }, 450);
    return () => clearTimeout(t);
  }, [form.barcode, isOpen, readonly, lookupBarcode]);

  useEffect(() => {
    if (!isOpen || readonly) return undefined;
    const t = setTimeout(() => {
      if (form.sku.trim().length >= 2) lookupSku();
    }, 450);
    return () => clearTimeout(t);
  }, [form.sku, isOpen, readonly, lookupSku]);

  const handleSave = async () => {
    if (readonly) {
      onClose();
      return;
    }
    const name = form.name.trim();
    if (!name) {
      toast.error('Укажите название');
      return;
    }
    const barcode = form.barcode.trim() || generateEAN13();
    const cnyV = roundMoney2(num(form.cny_price));
    const prevCny = line ? num(line.cny_price) : 0;
    const prevDel = line ? num(line.delivery_kzt) : 0;

    if (barcode && prevCny > 0 && Math.abs(prevCny - cnyV) > 0.01) {
      await addCnyHistory({ barcode, cny: prevCny, deliveryKzt: prevDel > 0 ? prevDel : null });
    }
    if (barcode && cnyV > 0) {
      await addCnyHistory({ barcode, cny: cnyV, deliveryKzt: num(form.delivery_kzt) > 0 ? form.delivery_kzt : null });
    }

    const saved = {
      local_id: line?.local_id || `line_${Date.now()}`,
      barcode,
      sku: form.sku.trim() || null,
      name,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      category: form.category.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      extra_info: form.extra_info.trim() || null,
      cny_price: cnyV > 0 ? cnyV : null,
      delivery_kg: roundWeight2(num(form.delivery_kg)) > 0 ? roundWeight2(num(form.delivery_kg)) : null,
      delivery_kzt: roundMoney2(num(form.delivery_kzt)) > 0 ? roundMoney2(num(form.delivery_kzt)) : null,
      purchase_kzt: roundMoney2(purchasePreview),
      sale_price: roundMoney2(num(form.sale_price)) > 0 ? roundMoney2(num(form.sale_price)) : null,
      quantity: form.quantity.trim() ? parseInt(form.quantity, 10) || null : null,
    };
    onSave(saved);
    onClose();
  };

  const printProduct = lineToProductForPrint({
    name: form.name,
    barcode: form.barcode,
    sku: form.sku,
    brand: form.brand,
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={readonly ? 'Просмотр позиции' : line ? 'Редактировать позицию' : 'Новая позиция'}
        size="xl"
        actions={
          readonly ? (
            <>
              <Button variant="secondary" icon={FiTag} onClick={() => setShowPrint(true)}>
                Печать этикетки
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Закрыть
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                icon={FiPrinter}
                onClick={() => setShowPrint(true)}
                disabled={!form.barcode.trim()}
              >
                Печать
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Отмена
              </Button>
              <Button variant="primary" onClick={handleSave}>
                Сохранить
              </Button>
            </>
          )
        }
      >
        {readonly && (
          <div
            style={{
              marginBottom: 14,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.25)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--success)',
            }}
          >
            Накладная на складе — только просмотр
          </div>
        )}

        {knownOnWarehouse && !readonly && (
          <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>
            Товар найден на складе — поля заполнены
          </div>
        )}
        {lookingUp && (
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>Поиск на складе…</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input
            label="Штрих-код"
            value={form.barcode}
            onChange={(e) => setField('barcode', e.target.value)}
            readOnly={readonly}
          />
          <Input
            label="Артикул"
            value={form.sku}
            onChange={(e) => setField('sku', e.target.value)}
            placeholder="Подставит данные со склада"
            readOnly={readonly}
          />
          <div style={{ gridColumn: '1 / -1' }}>
            <Input
              label="Название *"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              readOnly={readonly}
            />
          </div>
          <Input label="Марка" value={form.brand} onChange={(e) => setField('brand', e.target.value)} readOnly={readonly} />
          <Input label="Модель" value={form.model} onChange={(e) => setField('model', e.target.value)} readOnly={readonly} />
          <Input label="Категория" value={form.category} onChange={(e) => setField('category', e.target.value)} readOnly={readonly} />
          <Input
            label="Закуп (¥)"
            type="number"
            value={form.cny_price}
            onChange={(e) => setField('cny_price', e.target.value)}
            readOnly={readonly}
          />
        </div>

        {cnyHistory.length > 0 && !readonly && (
          <div style={{ marginTop: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Последний закуп: ¥{cnyHistory[0].cny} ·{' '}
            {cnyHistory[0].added_at ? new Date(cnyHistory[0].added_at).toLocaleString('ru-RU') : ''}
          </div>
        )}

        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>Доставка</div>
          {!readonly && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {DELIVERY_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setDeliveryMode(m.key);
                    if (num(form.delivery_kg) > 0) onKgChanged(form.delivery_kg);
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 12,
                    border: `2px solid ${deliveryMode === m.key ? 'var(--primary)' : 'var(--border)'}`,
                    background: deliveryMode === m.key ? 'var(--primary-light)' : 'var(--surface)',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                  <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.85 }}>
                    {m.sub(deliveryPerKg)}
                  </div>
                </button>
              ))}
              {deliveryMode === 'custom' && (
                <input
                  className="ios-input"
                  style={{ width: 120 }}
                  placeholder="₸/кг"
                  value={customRate}
                  onChange={(e) => {
                    setCustomRate(e.target.value);
                    if (num(form.delivery_kg) > 0) onKgChanged(form.delivery_kg);
                  }}
                />
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Доставка (кг)"
              type="number"
              value={form.delivery_kg}
              onChange={(e) => {
                setField('delivery_kg', e.target.value);
                if (!readonly) onKgChanged(e.target.value);
              }}
              readOnly={readonly}
            />
            <Input
              label="Доставка (₸)"
              type="number"
              value={form.delivery_kzt}
              onChange={(e) => {
                setField('delivery_kzt', e.target.value);
                if (!readonly) onKztChanged(e.target.value);
              }}
              readOnly={readonly}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input
            label="Продажа (₸)"
            type="number"
            value={form.sale_price}
            onChange={(e) => setField('sale_price', e.target.value)}
            readOnly={readonly}
          />
          <Input
            label="Количество"
            type="number"
            value={form.quantity}
            onChange={(e) => setField('quantity', e.target.value)}
            readOnly={readonly}
          />
          <div style={{ gridColumn: '1 / -1' }}>
            <TextArea
              label="Производитель / доп. инфо"
              value={`${form.manufacturer}${form.extra_info ? `\n${form.extra_info}` : ''}`}
              onChange={(e) => {
                const parts = e.target.value.split('\n');
                setField('manufacturer', parts[0] || '');
                setField('extra_info', parts.slice(1).join('\n'));
              }}
              readOnly={readonly}
            />
          </div>
        </div>

        {purchasePreview > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
            Закуп итого: {purchasePreview.toLocaleString('ru-RU')} ₸
          </div>
        )}

        {!readonly && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Формат печати:</span>
            {['barcode', 'qrcode'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPrintType(t)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 10,
                  border: `2px solid ${printType === t ? 'var(--primary)' : 'var(--border)'}`,
                  background: printType === t ? 'var(--primary-light)' : 'var(--surface)',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t === 'barcode' ? 'Штрих-код' : 'QR-код'}
              </button>
            ))}
          </div>
        )}
      </Modal>

      <LabelPrint
        isOpen={showPrint}
        onClose={() => setShowPrint(false)}
        product={printProduct}
        initialLabelType={printType}
        labelSize={labelSize}
      />
    </>
  );
}
