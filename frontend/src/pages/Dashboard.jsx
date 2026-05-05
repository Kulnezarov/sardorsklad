import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FiTrendingUp,
  FiPackage,
  FiRefreshCw,
  FiAlertCircle,
  FiClock,
  FiArrowRight,
  FiShoppingBag,
  FiLayers,
} from 'react-icons/fi';
import { settingsApi } from '../api/settings';
import { fetchAllProducts, getResolvedApiBaseUrl } from '../api/client';
import { LoadingSpinner, Alert } from '../components/ui';

const formatNumber = (value) => Number(value || 0).toLocaleString('ru-RU');
const ALERT_PAGE_SIZE = 60;
const ADMIN_NAME = 'Сардор';
const WELCOME_VARIANTS = [
  `Добро пожаловать, ${ADMIN_NAME}`,
  `Хорошей смены, ${ADMIN_NAME}`,
  `Рады видеть вас, ${ADMIN_NAME}`,
  `${ADMIN_NAME}, склад под контролем`,
];

const weekdayLabel = () => {
  const d = new Date();
  const s = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const dateLabel = () => {
  const d = new Date();
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const shiftLabel = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
};

const KpiCard = ({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  label,
  hint,
  hintTone = 'muted',
  onPress,
  accent = 'default',
}) => (
  <button
    type="button"
    onClick={onPress}
    className={`dash-kpi-card dash-kpi-${accent}`}
  >
    <div className="dash-kpi-inner">
      <div className="dash-kpi-icon-wrap" style={{ background: iconBg, color: iconColor }}>
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="dash-kpi-text">
        <div className="dash-kpi-value">{value}</div>
        <div className="dash-kpi-label">{label}</div>
        {hint ? (
          <div className={`dash-kpi-hint dash-kpi-hint--${hintTone}`}>{hint}</div>
        ) : null}
      </div>
    </div>
  </button>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [welcomeText, setWelcomeText] = useState('');
  const [welcomeFullText, setWelcomeFullText] = useState(WELCOME_VARIANTS[0]);
  const [outOfStockLimit, setOutOfStockLimit] = useState(ALERT_PAGE_SIZE);
  const [lowStockLimit, setLowStockLimit] = useState(ALERT_PAGE_SIZE);

  const {
    data: dash,
    isLoading,
    isError: dashError,
    refetch: refetchDash,
    dataUpdatedAt,
    isFetching,
  } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await settingsApi.getDashboard();
      const data = response.data || {};
      return {
        ...data,
        alert_out_of_stock: Array.isArray(data.alert_out_of_stock) ? data.alert_out_of_stock : [],
        alert_low_stock: Array.isArray(data.alert_low_stock) ? data.alert_low_stock : [],
        alert_stale: Array.isArray(data.alert_stale) ? data.alert_stale : [],
        recent_sales: Array.isArray(data.recent_sales) ? data.recent_sales : [],
      };
    },
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const needsFullStockLists = useMemo(() => {
    const lowTotal = Number(dash?.low_stock_positions_lte5 ?? 0);
    const lowPreview = Array.isArray(dash?.alert_low_stock) ? dash.alert_low_stock.length : 0;
    return lowTotal > lowPreview;
  }, [dash?.low_stock_positions_lte5, dash?.alert_low_stock]);

  const { data: fullProducts = [] } = useQuery({
    queryKey: ['dashboard', 'full-products-for-stock'],
    queryFn: () => fetchAllProducts(),
    enabled: needsFullStockLists,
    staleTime: 60_000,
  });

  const lastRefresh = useMemo(() => {
    if (!dataUpdatedAt) return '—';
    return new Date(dataUpdatedAt).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [dataUpdatedAt]);

  const hasAlerts =
    dash &&
    (dash.alert_out_of_stock?.length > 0 ||
      dash.alert_low_stock?.length > 0 ||
      dash.alert_stale?.length > 0);

  const outOfStockItems = useMemo(() => {
    const src = Array.isArray(dash?.alert_out_of_stock) ? dash.alert_out_of_stock : [];
    const quick = src.filter((x) => Number(x?.quantity) <= 0);
    if (!needsFullStockLists || !fullProducts.length) return quick;
    return fullProducts.filter((x) => Number(x?.quantity) <= 0);
  }, [dash?.alert_out_of_stock, fullProducts, needsFullStockLists]);

  const lowStockItems = useMemo(() => {
    const src = Array.isArray(dash?.alert_low_stock) ? dash.alert_low_stock : [];
    const quick = src.filter((x) => {
      const q = Number(x?.quantity);
      return q > 0 && q < 5;
    });
    if (!needsFullStockLists || !fullProducts.length) return quick;
    return fullProducts.filter((x) => {
      const q = Number(x?.quantity);
      return q > 0 && q < 5;
    });
  }, [dash?.alert_low_stock, fullProducts, needsFullStockLists]);

  const visibleOutOfStock = useMemo(
    () => outOfStockItems.slice(0, outOfStockLimit),
    [outOfStockItems, outOfStockLimit],
  );
  const visibleLowStock = useMemo(
    () => lowStockItems.slice(0, lowStockLimit),
    [lowStockItems, lowStockLimit],
  );

  useEffect(() => {
    setOutOfStockLimit(ALERT_PAGE_SIZE);
    setLowStockLimit(ALERT_PAGE_SIZE);
  }, [dash?.alert_out_of_stock, dash?.alert_low_stock]);

  useEffect(() => {
    const seed = Date.now();
    const idx = Math.abs(Math.floor(seed / 60000)) % WELCOME_VARIANTS.length;
    const nextGreeting = WELCOME_VARIANTS[idx];
    setWelcomeFullText(nextGreeting);

    let i = 0;
    setWelcomeText('');
    const timer = setInterval(() => {
      i += 1;
      setWelcomeText(nextGreeting.slice(0, i));
      if (i >= nextGreeting.length) clearInterval(timer);
    }, 45);

    return () => clearInterval(timer);
  }, []);

  const goProduct = (kind, productId) => {
    const q = new URLSearchParams();
    q.set('stock', kind);
    if (productId) q.set('product', String(productId));
    navigate(`/products?${q.toString()}`);
  };

  /** Резерв → «Нужно заказать»: автосохранение позиции с названием и категорией из карточки */
  const goReserveOrder = (a) => {
    const q = new URLSearchParams();
    q.set('autoWish', '1');
    q.set('name', a.name || '');
    if (a.category) q.set('category', a.category);
    if (a.brand) q.set('brand', a.brand);
    navigate(`/reserve?${q.toString()}`);
  };

  if (isLoading) {
    return <LoadingSpinner message="Загрузка…" />;
  }

  return (
    <div className="dashboard-page">
      <div className="dash-max">
        <header className="dash-row dash-row--head">
          <div>
            <h1 className="dash-welcome">{welcomeText || welcomeFullText}</h1>
            <p className="dash-admin-badge">Администратор: {ADMIN_NAME}</p>
            <p className="dash-sub">
              {weekdayLabel()}, {dateLabel()}
            </p>
            <p className="dash-shift-note">
              {shiftLabel()}, {ADMIN_NAME}. Проверим ключевые показатели склада.
            </p>
          </div>
          <div className="dash-refresh-wrap">
            <button
              type="button"
              className="dash-refresh-btn"
              onClick={() => refetchDash()}
              disabled={isFetching}
            >
              <FiRefreshCw size={18} className={isFetching ? 'dash-spin' : ''} />
              Обновить
            </button>
            <div className="dash-refresh-meta">
              <FiClock size={14} />
              <span>Обновлено: {lastRefresh}</span>
              {isFetching ? <span className="dash-pulse">синхронизация…</span> : null}
            </div>
          </div>
        </header>

        {dashError && (
          <Alert
            type="danger"
            title="Нет связи с сервером"
            message={`Запросы к: ${getResolvedApiBaseUrl()}. Запустите API, проверьте порт и перезапустите Vite после смены .env.`}
            icon={FiAlertCircle}
          />
        )}

        {!dashError && dash && (
          <>
            <section className="dash-kpi-grid" aria-label="Ключевые показатели">
              <KpiCard
                icon={FiShoppingBag}
                iconBg="var(--dash-icon-bg-violet)"
                iconColor="var(--primary)"
                value={`${formatNumber(dash.warehouse_value_sale)} ₸`}
                label="Стоимость склада"
                hint="по продажным ценам"
                onPress={() => navigate('/products')}
                accent="default"
              />
              <KpiCard
                icon={FiPackage}
                iconBg="var(--dash-icon-bg-cyan)"
                iconColor="#0891b2"
                value={`${formatNumber(dash.total_units)} шт`}
                label="Товаров на складе"
                hint={`${formatNumber(dash.total_products)} позиций`}
                onPress={() => navigate('/products')}
                accent="default"
              />
              <KpiCard
                icon={FiTrendingUp}
                iconBg="var(--dash-icon-bg-green)"
                iconColor="#16a34a"
                value={`${formatNumber(dash.total_sales_mtd)} ₸`}
                label="Выручка за месяц"
                hint={`${formatNumber(dash.sales_count_mtd ?? 0)} продаж`}
                hintTone="success"
                onPress={() => navigate('/history')}
                accent="success"
              />
              <KpiCard
                icon={FiAlertCircle}
                iconBg="var(--dash-icon-bg-amber)"
                iconColor="#ca8a04"
                value={`${formatNumber(dash.low_stock_positions_lte5)}`}
                label="Мало на складе"
                hint="позиций с остатком ≤ 5 шт"
                hintTone="warning"
                onPress={() => navigate('/products?stock=low')}
                accent="warning"
              />
            </section>

            <div className="dash-panels-row">
              <section className="dash-panel" aria-label="Состояние склада">
                <div className="dash-panel-header">
                  <div className="dash-panel-header-icon" aria-hidden>
                    <FiLayers size={20} strokeWidth={2} />
                  </div>
                  <h2 className="dash-panel-title">Состояние склада</h2>
                </div>
                <div className="dash-panel-body dash-panel-body--alerts">
                  {!hasAlerts ? (
                    <div className="dash-all-ok">
                      <span>Всё в порядке</span>
                      <span className="dash-all-ok-emoji" aria-hidden>
                        ✅
                      </span>
                    </div>
                  ) : (
                    <div className="dash-alerts-stack">
                      <div className="dash-alert-windows">
                        <div className="dash-alert-window">
                          <div className="dash-alert-window-title">Товар закончился (0 шт)</div>
                          {outOfStockItems.length === 0 ? (
                            <div className="dash-alert-empty">Нет позиций</div>
                          ) : (
                            <div className="dash-alert-group dash-alert-group--danger">
                              <div className="dash-alert-group-title">Всего: {outOfStockItems.length}</div>
                              <ul className="dash-alert-list">
                                {visibleOutOfStock.map((a) => (
                                  <li key={`o-${a.id}`} className="dash-alert-row">
                                    <span className="dash-alert-name">{a.name}</span>
                                    <span className="dash-alert-qty">{a.quantity} шт</span>
                                    <button
                                      type="button"
                                      className="dash-alert-action"
                                      onClick={() => goReserveOrder(a)}
                                    >
                                      Заказать
                                    </button>
                                  </li>
                                ))}
                              </ul>
                              {outOfStockItems.length > visibleOutOfStock.length && (
                                <button
                                  type="button"
                                  className="dash-load-more"
                                  onClick={() => setOutOfStockLimit((p) => p + ALERT_PAGE_SIZE)}
                                >
                                  Загрузить еще 60
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="dash-alert-window">
                          <div className="dash-alert-window-title">Товар заканчивается (меньше 5 шт)</div>
                          {lowStockItems.length === 0 ? (
                            <div className="dash-alert-empty">Нет позиций</div>
                          ) : (
                            <div className="dash-alert-group dash-alert-group--warn">
                              <div className="dash-alert-group-title">
                                Всего: {Number(dash?.low_stock_positions_lte5 ?? lowStockItems.length)}
                              </div>
                              <ul className="dash-alert-list">
                                {visibleLowStock.map((a) => (
                                  <li key={`l-${a.id}`} className="dash-alert-row">
                                    <span className="dash-alert-name">{a.name}</span>
                                    <span className="dash-alert-qty">{a.quantity} шт</span>
                                    <button
                                      type="button"
                                      className="dash-alert-action"
                                      onClick={() => goReserveOrder(a)}
                                    >
                                      Заказать
                                    </button>
                                  </li>
                                ))}
                              </ul>
                              {lowStockItems.length > visibleLowStock.length && (
                                <button
                                  type="button"
                                  className="dash-load-more"
                                  onClick={() => setLowStockLimit((p) => p + ALERT_PAGE_SIZE)}
                                >
                                  Загрузить еще 60
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {Array.isArray(dash.alert_stale) && dash.alert_stale.length > 0 && (
                        <div className="dash-alert-group dash-alert-group--stale">
                          <div className="dash-alert-group-title">Залежалый товар (30+ дней без продаж)</div>
                          <ul className="dash-alert-list">
                            {dash.alert_stale?.map((a) => (
                              <li key={`s-${a.id}`} className="dash-alert-row">
                                <span className="dash-alert-name">{a.name}</span>
                                <span className="dash-alert-qty">{a.quantity} шт</span>
                                <button
                                  type="button"
                                  className="dash-alert-action"
                                  onClick={() => goProduct('stale', a.id)}
                                >
                                  Скидка
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="dash-panel" aria-label="Последние продажи">
                <div className="dash-panel-header dash-panel-header--split">
                  <div className="dash-panel-header-left">
                    <div className="dash-panel-header-icon dash-panel-header-icon--sales" aria-hidden>
                      <FiShoppingBag size={20} strokeWidth={2} />
                    </div>
                    <h2 className="dash-panel-title">Последние продажи</h2>
                  </div>
                  <button type="button" className="dash-panel-link" onClick={() => navigate('/history')}>
                    Все
                    <FiArrowRight size={15} />
                  </button>
                </div>
                <div className="dash-panel-body dash-panel-body--sales">
                  {Array.isArray(dash.recent_sales) && dash.recent_sales.length === 0 ? (
                    <div className="dash-empty-soft">Пока нет продаж</div>
                  ) : (
                    <ul className="dash-sales-list">
                      {dash.recent_sales?.map((s) => (
                        <li key={s.id} className="dash-sales-row">
                          <div className="dash-sales-left">
                            <div className="dash-sales-topline">
                              <span className="dash-sales-receipt">{s.receipt_number}</span>
                              <span className="dash-sales-time">
                                {new Date(s.created_at).toLocaleTimeString('ru-RU', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div className="dash-sales-products">{s.product_names}</div>
                          </div>
                          <div className="dash-sales-sum">{formatNumber(s.total_amount)} ₸</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
