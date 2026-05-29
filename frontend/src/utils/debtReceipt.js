const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

export function formatDebtDateTime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildDebtReceiptText(sale) {
  const when = formatDebtDateTime(sale.created_at);
  const receipt = sale.receipt_number || '';
  const name = sale.customer_name || '';
  const phone = sale.customer_phone || '';
  const total = num(sale.total_amount);
  const paid = num(sale.paid_amount);
  const balance = num(sale.balance);
  const lines = (sale.items || []).map((it) => {
    const title = it.product_name || it.name || 'Товар';
    const q = it.quantity ?? 0;
    const sub = num(it.subtotal);
    return `• ${title} × ${q} = ${formatMoney(sub)} ₸`;
  });

  const parts = [
    'SkladPro — чек в долг',
    `Дата: ${when}`,
    `Чек: ${receipt}`,
    `Клиент: ${name}`,
    `Телефон: ${phone}`,
    lines.length ? `\nТовары:\n${lines.join('\n')}` : '',
    `\nИтого: ${formatMoney(total)} ₸`,
    `Оплачено: ${formatMoney(paid)} ₸`,
    `Остаток: ${formatMoney(balance)} ₸`,
  ];
  return parts.filter(Boolean).join('\n');
}
