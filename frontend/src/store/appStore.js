import { create } from 'zustand'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token if exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth and redirect if unauthorized
      localStorage.removeItem('authToken')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export const useStore = create((set, get) => ({
  // ===== STATE =====
  products: [],
  sales: [],
  reserves: [],
  history: [],
  revisions: [],
  settings: null,
  notifications: [],
  dashboardStats: null,

  loading: false,
  error: null,
  success: null,

  darkMode: localStorage.getItem('darkMode') === 'true',
  sidebarOpen: true,

  // ===== INITIALIZATION =====
  initializeApp: async () => {
    try {
      set({ loading: true })
      const [productsRes, settingsRes, statsRes] = await Promise.all([
        api.get('/api/v1/products'),
        api.get('/api/v1/settings'),
        api.get('/api/v1/settings/dashboard'),
      ])
      set({
        products: productsRes.data,
        settings: settingsRes.data,
        dashboardStats: statsRes.data,
        loading: false,
      })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message, loading: false })
    }
  },

  // ===== PRODUCTS =====
  fetchProducts: async (filters = {}) => {
    try {
      set({ loading: true })
      const params = new URLSearchParams(filters)
      const response = await api.get(`/api/v1/products?${params}`)
      set({ products: response.data, loading: false })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message, loading: false })
    }
  },

  getProduct: async (id) => {
    try {
      const response = await api.get(`/api/v1/products/${id}`)
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  addProduct: async (product) => {
    try {
      const response = await api.post('/api/v1/products', product)
      set({
        products: [...get().products, response.data],
        success: 'Product created successfully',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  updateProduct: async (id, product) => {
    try {
      const response = await api.put(`/api/v1/products/${id}`, product)
      set({
        products: get().products.map((p) => (p.id === id ? response.data : p)),
        success: 'Product updated successfully',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  deleteProduct: async (id) => {
    try {
      await api.delete(`/api/v1/products/${id}`)
      set({
        products: get().products.filter((p) => p.id !== id),
        success: 'Product deleted successfully',
      })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  importProducts: async (file) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post('/api/v1/products/import/excel', formData)
      set({ success: `Imported ${response.data.success_count} products` })
      await get().fetchProducts()
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  exportProducts: async (format = 'xlsx', filters = {}) => {
    try {
      const params = new URLSearchParams(filters)
      const response = await api.get(`/api/v1/products/export/${format}?${params}`, {
        responseType: 'blob',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  // ===== SALES =====
  fetchSales: async (filters = {}) => {
    try {
      set({ loading: true })
      const params = new URLSearchParams(filters)
      const response = await api.get(`/api/v1/sales?${params}`)
      set({ sales: response.data, loading: false })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message, loading: false })
    }
  },

  createSale: async (sale) => {
    try {
      const response = await api.post('/api/v1/sales', sale)
      set({
        sales: [response.data, ...get().sales],
        success: 'Sale recorded successfully',
      })
      await get().fetchProducts() // Refresh quantities
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  getTodayRevenue: async () => {
    try {
      const response = await api.get('/api/v1/sales/today/revenue')
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  cancelSale: async (id) => {
    try {
      const response = await api.delete(`/api/v1/sales/${id}`)
      set({
        sales: get().sales.map((s) => (s.id === id ? { ...s, is_cancelled: true } : s)),
        success: 'Sale cancelled successfully',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  // ===== RESERVES =====
  fetchReserves: async (filters = {}) => {
    try {
      set({ loading: true })
      const params = new URLSearchParams(filters)
      const response = await api.get(`/api/v1/reserves?${params}`)
      set({ reserves: response.data, loading: false })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message, loading: false })
    }
  },

  createReserve: async (reserve) => {
    try {
      const response = await api.post('/api/v1/reserves', reserve)
      set({
        reserves: [...get().reserves, response.data],
        success: 'Reserve created successfully',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  updateReserve: async (id, data) => {
    try {
      const response = await api.put(`/api/v1/reserves/${id}`, data)
      set({
        reserves: get().reserves.map((r) => (r.id === id ? response.data : r)),
        success: 'Reserve updated successfully',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  moveReserveToStock: async (id) => {
    try {
      const response = await api.post(`/api/v1/reserves/${id}/to-stock`)
      set({ success: 'Reserve moved to stock' })
      await get().fetchReserves()
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  // ===== HISTORY =====
  fetchHistory: async (filters = {}) => {
    try {
      set({ loading: true })
      const params = new URLSearchParams(filters)
      const response = await api.get(`/api/v1/history?${params}`)
      set({ history: response.data, loading: false })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message, loading: false })
    }
  },

  // ===== REVISIONS =====
  fetchRevisions: async (filters = {}) => {
    try {
      set({ loading: true })
      const params = new URLSearchParams(filters)
      const response = await api.get(`/api/v1/revisions?${params}`)
      set({ revisions: response.data, loading: false })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message, loading: false })
    }
  },

  startRevision: async (notes) => {
    try {
      const response = await api.post('/api/v1/revisions/start', { notes })
      set({ success: 'Revision session started' })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  // ===== SETTINGS =====
  fetchSettings: async () => {
    try {
      const response = await api.get('/api/v1/settings')
      set({ settings: response.data })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  updateSettings: async (settings) => {
    try {
      const response = await api.put('/api/v1/settings', settings)
      set({
        settings: response.data,
        success: 'Settings updated successfully',
      })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
      throw error
    }
  },

  // ===== NOTIFICATIONS =====
  fetchNotifications: async () => {
    try {
      const response = await api.get('/api/v1/settings/notifications')
      set({ notifications: response.data })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
    }
  },

  markNotificationAsRead: async (id) => {
    try {
      await api.post(`/api/v1/settings/notifications/${id}/read`)
      set({
        notifications: get().notifications.map((n) =>
          n.id === id ? { ...n, is_read: true } : n,
        ),
      })
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
    }
  },

  // ===== DASHBOARD =====
  fetchDashboardStats: async () => {
    try {
      const response = await api.get('/api/v1/settings/dashboard')
      set({ dashboardStats: response.data })
      return response.data
    } catch (error) {
      set({ error: error.response?.data?.detail || error.message })
    }
  },

  // ===== UI STATE =====
  toggleDarkMode: () => {
    const newMode = !get().darkMode
    set({ darkMode: newMode })
    localStorage.setItem('darkMode', newMode)
  },

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

  // ===== UTILITIES =====
  clearError: () => set({ error: null }),
  clearSuccess: () => set({ success: null }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))
