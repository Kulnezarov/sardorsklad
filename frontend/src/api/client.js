import axios from 'axios'

/**
 * Resolve API base URL.
 * - Set VITE_API_URL to a full base (e.g. http://192.168.1.10:8000/api/v1) for a fixed backend.
 * - Set VITE_API_URL=auto (or leave empty) to use the same hostname as the page + VITE_API_PORT (default 8000).
 *   This fixes LAN access: opening http://192.168.x.x:5173 calls http://192.168.x.x:8000/api/v1.
 */
/** Размер одной страницы при запросе списка товаров. Небольшой размер снижает нагрузку на телефоны. */
export const PRODUCTS_PAGE_SIZE = 30

/**
 * Загружает все товары по частям (skip/limit), чтобы не слать один огромный SELECT
 * (иначе на Supabase часто sqlalche.me/e/20/e3q8 — таймаут операции).
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

/**
 * Non-local HTTP backends break HTTPS sites (Mixed Content).
 * For any remote host (Railway, etc.) always use HTTPS — Railway serves TLS on the public domain.
 * Keep HTTP only for localhost / private LAN IPs (local dev).
 */
function isLocalOrPrivateHost(hostname) {
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname)) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function upgradeHttpToHttpsIfNeeded(url) {
  if (!url.startsWith('http://')) return url
  try {
    const u = new URL(url)
    if (isLocalOrPrivateHost(u.hostname)) return url
    u.protocol = 'https:'
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

export function getResolvedApiBaseUrl() {
  const raw = (import.meta.env.VITE_API_URL || '').trim()
  if (raw && raw !== 'auto') {
    return upgradeHttpToHttpsIfNeeded(raw.replace(/\/$/, ''))
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const port = String(import.meta.env.VITE_API_PORT || '8000').trim()
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:${port}/api/v1`
  }
  return 'http://localhost:8000/api/v1'
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
    if (error.response?.status === 401) {
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      // Emit custom event for auth state change
      window.dispatchEvent(new CustomEvent('auth:logout'))
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

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
  getByBarcode: (barcode) => apiClient.get(`/api/v1/products/barcode/${barcode}`),
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
  exportExcel: (filters = {}) =>
    apiClient.get('/api/v1/products/export/excel', {
      params: filters,
      responseType: 'blob',
    }),
  getStats: () => apiClient.get('/api/v1/products/stats/summary'),
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
