import axios from 'axios'

/**
 * Resolve API base URL.
 * - Set VITE_API_URL to a full base (e.g. http://192.168.1.10:8000/api/v1) for a fixed backend.
 * - Set VITE_API_URL=auto (or leave empty): dev servers (5173/3000/…) → same host + VITE_API_PORT (8000);
 *   production on :80 / :443 → same origin + /api/v1 (Caddy/nginx проксируют /api на backend).
 */
/** Размер одной страницы при запросе списка товаров. Небольшой размер снижает нагрузку на телефоны. */
export const PRODUCTS_PAGE_SIZE = 30

/**
 * Загружает все товары по частям (skip/limit), чтобы не слать один огромный SELECT
 * (иначе один огромный SELECT может дать таймаут на сервере).
 */
export async function fetchAllProducts(filters = {}) {
  const { limit: _l, skip: _s, ...rest } = filters
  const acc = []
  let skip = 0
  for (;;) {
    const response = await apiClient.get('/api/v1/products', {
      params: {
        ...rest,
        limit: PRODUCTS_PAGE_SIZE,
        skip,
      },
    })
    const batch = response.data || []
    acc.push(...batch)
    if (batch.length < PRODUCTS_PAGE_SIZE) break
    skip += PRODUCTS_PAGE_SIZE
    if (skip > 2_000_000) break
  }
  return acc
}

const DEV_PORTS_NEED_SEPARATE_API = new Set(['5173', '3000', '4173', '8080'])

export function getResolvedApiBaseUrl() {
  const raw = (import.meta.env.VITE_API_URL || '').trim()
  if (raw && raw !== 'auto') {
    return raw.replace(/\/$/, '')
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const pagePort = (window.location.port || '').trim()
    const apiPort = String(import.meta.env.VITE_API_PORT || '8000').trim()
    const { hostname, protocol } = window.location
    if (DEV_PORTS_NEED_SEPARATE_API.has(pagePort)) {
      return `${protocol}//${hostname}:${apiPort}/api/v1`
    }
    return `${window.location.origin}/api/v1`
  }
  return 'http://localhost:8000/api/v1'
}

/**
 * URL для /uploads/... или /api/v1/media/product-images/... в <img>.
 * - **Прод** (без 5173): `window.location.origin` + path — Caddy `handle /api* → backend` и при необходимости /uploads.
 * - **dev** (5173 и т.д.): хост/порт API, иначе картинка на :8000 не отдаётся с фронта.
 */
export function resolveUploadedAssetUrl(relativeOrAbsolute) {
  const s = String(relativeOrAbsolute || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  const path = s.startsWith('/') ? s : `/${s}`
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const pagePort = (window.location.port || '').trim()
    if (!DEV_PORTS_NEED_SEPARATE_API.has(pagePort)) {
      return `${window.location.origin}${path}`
    }
  }
  const api = getResolvedApiBaseUrl()
  const root = api.replace(/\/api\/v1\/?$/, '')
  return `${root}${path}`
}

/**
 * Текст ошибки из ответа API (body.detail) или сети — для toast и форм.
 * @param {unknown} error — обычно AxiosError
 * @param {string} [fallback]
 * @returns {string}
 */
export function getApiErrorMessage(error, fallback = 'Произошла ошибка') {
  if (error == null) return fallback
  const d = error.response?.data
  if (typeof d?.detail === 'string' && d.detail.trim()) return d.detail
  if (Array.isArray(d?.detail) && d.detail.length) {
    const x = d.detail[0]
    if (typeof x === 'string') return x
    if (x && typeof x === 'object' && x.msg) return String(x.msg)
  }
  if (d?.detail && typeof d.detail === 'object') {
    const s = d.detail.message
    if (typeof s === 'string' && s.trim()) return s
  }
  if (typeof d?.error === 'string' && d.error.trim()) return d.error
  const msg = error.message && String(error.message).trim() ? String(error.message) : ''
  if (msg) {
    if (error.code === 'ERR_NETWORK' || msg === 'Network Error') {
      return 'Нет сети или сервер недоступен'
    }
    return msg
  }
  return fallback
}

const apiClient = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
  // 204 No Content and empty bodies must not go through JSON.parse (throws).
  transformResponse: [
    (data, _headers, status) => {
      if (status === 204 || data === '' || data == null) return null
      if (typeof data === 'string') {
        try {
          return JSON.parse(data)
        } catch {
          return data
        }
      }
      return data
    },
  ],
})

// Request interceptor for auth token
apiClient.interceptors.request.use(
  (config) => {
    const base = getResolvedApiBaseUrl()
    config.baseURL = base
    if (config.url && base.endsWith('/api/v1') && config.url.startsWith('/api/v1/')) {
      config.url = config.url.replace('/api/v1', '')
    }

    const token = localStorage.getItem('authToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = String(error.config?.url || '')
    const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/register')
    if (error.response?.status === 401 && !isAuthAttempt) {
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      window.dispatchEvent(new CustomEvent('auth:logout'))
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

// ============================================================================
// AUTH API
// ============================================================================
export const authApi = {
  login: (body) => apiClient.post('/api/v1/auth/login', body),
  me: () => apiClient.get('/api/v1/auth/me'),
}

// ============================================================================
// PRODUCTS API
// ============================================================================
export const productApi = {
  getAll: (filters = {}) => {
    const { limit, ...rest } = filters
    return apiClient.get('/api/v1/products', {
      params: { limit: limit ?? PRODUCTS_PAGE_SIZE, ...rest },
    })
  },
  getById: (id) => apiClient.get(`/api/v1/products/${id}`),
  getByBarcode: (barcode, options = {}) => {
    const allow404 = Boolean(options?.allow404)
    const includeInactive = Boolean(options?.includeInactive)
    return apiClient.get(`/api/v1/products/barcode/${encodeURIComponent(String(barcode))}`, {
      params: includeInactive ? { include_inactive: true } : undefined,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || (allow404 && status === 404),
    })
  },
  create: (data) => apiClient.post('/api/v1/products', data),
  update: (id, data) => apiClient.put(`/api/v1/products/${id}`, data),
  delete: (id) => apiClient.delete(`/api/v1/products/${id}`),
  applyDiscount: (id, discountPercent) =>
    apiClient.post(`/api/v1/products/${id}/discount?discount_percent=${discountPercent}`),
  getStale: (filters = {}) => apiClient.get('/api/v1/products/stale/list', { params: filters }),
  getCategories: (params = {}) => apiClient.get('/api/v1/products/categories/list', { params }),
  importExcel: (file, options = {}) => {
    const { signal, onUploadProgress, timeout } = options
    const formData = new FormData()
    formData.append('file', file)
    return apiClient.post('/api/v1/products/import/excel', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
      onUploadProgress,
      timeout: timeout ?? 0,
    })
  },
  uploadProductImage: (id, file, options = {}) => {
    const { onUploadProgress, signal } = options
    const formData = new FormData()
    formData.append('file', file)
    return apiClient.post(`/api/v1/products/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
      signal,
    })
  },
  deleteProductImage: (id) => apiClient.delete(`/api/v1/products/${id}/image`),
  deleteProductGalleryImage: (id, fileName) =>
    apiClient.delete(`/api/v1/products/${id}/images/${encodeURIComponent(fileName)}`),
  exportExcel: (filters = {}) =>
    apiClient.get('/api/v1/products/export/excel', {
      params: filters,
      responseType: 'blob',
    }),
  getStats: () => apiClient.get('/api/v1/products/stats/summary'),
  /** Проверка существования файлов на диске для image_url */
  getImageHealth: (params = {}) =>
    apiClient.get('/api/v1/products/images/health', { params }),
}

// ============================================================================
// SALES API
// ============================================================================
export const saleApi = {
  getAll: (filters = {}) => apiClient.get('/api/v1/sales', { params: filters }),
  getById: (id) => apiClient.get(`/api/v1/sales/${id}`),
  create: (data) => apiClient.post('/api/v1/sales', data),
  cancel: (id) => apiClient.delete(`/api/v1/sales/${id}`),
  getTodayRevenue: () => apiClient.get('/api/v1/sales/today/revenue'),
  getTopSalesToday: (limit = 5) => apiClient.get('/api/v1/sales/top-sales/today', { params: { limit } }),
  clearAll: () => apiClient.delete('/api/v1/sales'),
}

// ============================================================================
// RESERVES API
// ============================================================================
export const reserveApi = {
  getAll: (filters = {}) => apiClient.get('/api/v1/reserves', { params: filters }),
  getById: (id) => apiClient.get(`/api/v1/reserves/${id}`),
  getByStatus: (status, filters = {}) =>
    apiClient.get(`/api/v1/reserves/status/${status}`, { params: filters }),
  create: (data) => apiClient.post('/api/v1/reserves', data),
  update: (id, data) => apiClient.put(`/api/v1/reserves/${id}`, data),
  moveToStock: (id) => apiClient.post(`/api/v1/reserves/${id}/to-stock`),
  complete: (id) => apiClient.post(`/api/v1/reserves/${id}/complete`),
  cancel: (id) => apiClient.post(`/api/v1/reserves/${id}/cancel`),
  restore: (id) => apiClient.post(`/api/v1/reserves/${id}/restore`),
  delete: (id) => apiClient.delete(`/api/v1/reserves/${id}`),
  getCnyRate: () => apiClient.get('/api/v1/reserves/exchange/cny-rate'),
}

export const orderApi = {
  getAll: (params = {}) => apiClient.get('/api/v1/orders', { params }),
  getById: (id) => apiClient.get(`/api/v1/orders/${id}`),
  updateStatus: (id, data) => apiClient.put(`/api/v1/orders/${id}/status`, data),
  retryNotifications: () => apiClient.post('/api/v1/orders/notifications/retry'),
}

// ============================================================================
// VEHICLE / ENGINE COMPATIBILITY (Справочник + связи в товаре)
// ============================================================================
export const compatibilityApi = {
  engineCodes: (params) => apiClient.get('/api/v1/compatibility/engine-codes', { params }),
  getEngineCode: (id) => apiClient.get(`/api/v1/compatibility/engine-codes/${id}`),
  createEngineCode: (data) => apiClient.post('/api/v1/compatibility/engine-codes', data),
  updateEngineCode: (id, data) => apiClient.put(`/api/v1/compatibility/engine-codes/${id}`, data),
  deleteEngineCode: (id) => apiClient.delete(`/api/v1/compatibility/engine-codes/${id}`),
  addEngineCodeCompatibility: (engineCodeId, data) =>
    apiClient.post(`/api/v1/compatibility/engine-codes/${engineCodeId}/compatibility`, data),
  updateEngineCodeCompatibility: (engineCodeId, compatibilityId, data) =>
    apiClient.put(`/api/v1/compatibility/engine-codes/${engineCodeId}/compatibility/${compatibilityId}`, data),
  deleteEngineCodeCompatibility: (engineCodeId, compatibilityId) =>
    apiClient.delete(`/api/v1/compatibility/engine-codes/${engineCodeId}/compatibility/${compatibilityId}`),
  vehicleBrands: (params) => apiClient.get('/api/v1/compatibility/vehicle-brands', { params }),
  createVehicleBrand: (data) => apiClient.post('/api/v1/compatibility/vehicle-brands', data),
  updateVehicleBrand: (id, data) => apiClient.put(`/api/v1/compatibility/vehicle-brands/${id}`, data),
  deleteVehicleBrand: (id) => apiClient.delete(`/api/v1/compatibility/vehicle-brands/${id}`),
  vehicleModels: (params) => apiClient.get('/api/v1/compatibility/vehicle-models', { params }),
  createVehicleModel: (data) => apiClient.post('/api/v1/compatibility/vehicle-models', data),
  updateVehicleModel: (id, data) => apiClient.put(`/api/v1/compatibility/vehicle-models/${id}`, data),
  deleteVehicleModel: (id) => apiClient.delete(`/api/v1/compatibility/vehicle-models/${id}`),
  engineFamilies: (params) => apiClient.get('/api/v1/compatibility/engine-families', { params }),
  getEngineFamily: (id) => apiClient.get(`/api/v1/compatibility/engine-families/${id}`),
  getEngineFamilyByCode: (code) =>
    apiClient.get(`/api/v1/compatibility/engine-families/by-code/${encodeURIComponent(String(code))}`),
  createEngineFamily: (data) => apiClient.post('/api/v1/compatibility/engine-families', data),
  updateEngineFamily: (id, data) => apiClient.put(`/api/v1/compatibility/engine-families/${id}`, data),
  deleteEngineFamily: (id) => apiClient.delete(`/api/v1/compatibility/engine-families/${id}`),
  autocompleteFamilies: (q) => apiClient.get('/api/v1/compatibility/autocomplete', { params: { q } }),
}

export const categoryApi = {
  getAll: () => apiClient.get('/api/v1/categories'),
  create: (data) => apiClient.post('/api/v1/categories', data),
  update: (id, data) => apiClient.put(`/api/v1/categories/${id}`, data),
  delete: (id) => apiClient.delete(`/api/v1/categories/${id}`),
}

export const brandApi = {
  getAll: () => apiClient.get('/api/v1/brands'),
  create: (data) => apiClient.post('/api/v1/brands', data),
  update: (id, data) => apiClient.put(`/api/v1/brands/${id}`, data),
  delete: (id) => apiClient.delete(`/api/v1/brands/${id}`),
}

export const publicApi = {
  getProducts: (params = {}) => apiClient.get('/api/v1/public/products', { params }),
  createOrder: (data) => apiClient.post('/api/v1/public/orders', data),
  /** Статус заказа для клиента: reserve_id из ответа createOrder, phone — как при оформлении */
  getOrderStatus: (reserveId, phone) =>
    apiClient.get(`/api/v1/public/orders/${reserveId}`, { params: { phone } }),
}

// ============================================================================
// HISTORY API
// ============================================================================
export const historyApi = {
  getAll: (filters = {}) => apiClient.get('/api/v1/history', { params: filters }),
  getByProductId: (productId, filters = {}) =>
    apiClient.get(`/api/v1/history/product/${productId}`, { params: filters }),
  delete: (id) => apiClient.delete(`/api/v1/history/${id}`),
  clearAll: () => apiClient.delete('/api/v1/history'),
  cleanup: () => apiClient.post('/api/v1/history/cleanup'),
  getStats: () => apiClient.get('/api/v1/history/stats/operations'),
}

// ============================================================================
// REVISIONS API
// ============================================================================
export const revisionApi = {
  getAll: (filters = {}) => apiClient.get('/api/v1/revisions', { params: filters }),
  getById: (id) => apiClient.get(`/api/v1/revisions/${id}`),
  start: (data = {}) => apiClient.post('/api/v1/revisions/start', data),
  updateItem: (sessionId, productId, data) =>
    apiClient.put(`/api/v1/revisions/${sessionId}/item/${productId}`, data),
  complete: (id, applyCorrections = true) =>
    apiClient.post(`/api/v1/revisions/${id}/complete`, null, { params: { apply_corrections: applyCorrections } }),
  cancel: (id) => apiClient.post(`/api/v1/revisions/${id}/cancel`),
  delete: (id) => apiClient.delete(`/api/v1/revisions/${id}`),
}

// ============================================================================
// SETTINGS API
// ============================================================================
export const settingsApi = {
  getAll: () => apiClient.get('/api/v1/settings'),
  get: (key) => apiClient.get(`/api/v1/settings/${key}`),
  update: (data) => apiClient.put('/api/v1/settings', data),
  getDashboard: () => apiClient.get('/api/v1/settings/dashboard'),
  getCnyRate: () => apiClient.get('/api/v1/settings/exchange/cny-rate'),
  // Backend expects "rate" as query param, not JSON body.
  setCnyRate: (rate) =>
    apiClient.put('/api/v1/settings/exchange/cny-rate', null, {
      params: { rate },
    }),
  testNotification: () => apiClient.post('/api/v1/settings/notifications/test'),
  getNotifications: (unreadOnly = false) =>
    apiClient.get('/api/v1/settings/notifications', { params: { unread_only: unreadOnly } }),
  markNotificationAsRead: (id) => apiClient.post(`/api/v1/settings/notifications/${id}/read`),
  reset: (confirm = false) => apiClient.post(`/api/v1/settings/reset?confirm=${confirm}`),
}

// ============================================================================
// HEALTH & INFO
// ============================================================================
export const systemApi = {
  health: () => apiClient.get('/health'),
  info: () => apiClient.get('/api/v1/info'),
}

export default apiClient
