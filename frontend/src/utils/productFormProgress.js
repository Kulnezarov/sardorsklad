const num = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Чек-лист заполнения формы товара для прогресс-бара.
 */
export function buildProductFormProgress({
  formData,
  schema,
  showCompatibility = false,
}) {
  const items = [];

  items.push({
    key: 'category',
    label: 'Категория',
    done: Boolean(formData?.category_id),
  });

  items.push({
    key: 'name',
    label: 'Название',
    done: Boolean(String(formData?.name || '').trim()),
  });

  if (showCompatibility) {
    items.push({
      key: 'compat',
      label: 'Марки авто',
      done: (formData?.compatibility_vehicle_model_ids || []).length > 0,
    });
  }

  (schema?.fields || []).forEach((f) => {
    if (!f?.required) return;
    const key = f.key?.trim();
    if (!key) return;
    items.push({
      key: `attr:${key}`,
      label: f.label || key,
      done: Boolean(String((formData?.attributes || {})[key] || '').trim()),
    });
  });

  items.push({
    key: 'sale_price',
    label: 'Цена продажи',
    done: num(formData?.sale_price) > 0,
  });

  const done = items.filter((i) => i.done).length;
  const total = items.length || 1;

  return {
    items,
    done,
    total,
    pct: Math.round((done / total) * 100),
    allDone: done === total,
  };
}
