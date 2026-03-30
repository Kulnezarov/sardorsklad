import apiClient from './client';

// ── Wish Items — "Нужно заказать" ─────────────────────────────────────────
export const wishApi = {
  list:   (params = {}) => apiClient.get('/api/v1/wish-items/', { params }),
  create: (data)        => apiClient.post('/api/v1/wish-items/', data),
  update: (id, data)    => apiClient.put(`/api/v1/wish-items/${id}`, data),
  delete: (id)          => apiClient.delete(`/api/v1/wish-items/${id}`),
};

// ── Purchase Orders — "Заказано / В пути" ────────────────────────────────
export const poApi = {
  list:    (params = {}) => apiClient.get('/api/v1/purchase-orders/', { params }),
  create:  (data)        => apiClient.post('/api/v1/purchase-orders/', data),
  update:  (id, data)    => apiClient.put(`/api/v1/purchase-orders/${id}`, data),
  accept:  (id, data)    => apiClient.post(`/api/v1/purchase-orders/${id}/accept`, data),
  cancel:  (id)          => apiClient.post(`/api/v1/purchase-orders/${id}/cancel`),
  restore: (id)          => apiClient.post(`/api/v1/purchase-orders/${id}/restore`),
  delete:  (id)          => apiClient.delete(`/api/v1/purchase-orders/${id}`),
};

// ── Legacy reserve API (kept for backward compat) ─────────────────────────
export const reserveApi = {
  getReserve:    (filters = {}) => apiClient.get('/api/v1/reserves/', { params: filters }),
  getReserveItem:(id)           => apiClient.get(`/api/v1/reserves/${id}`),
  createOrder:   (data)         => apiClient.post('/api/v1/reserves/', data),
  updateOrder:   (id, data)     => apiClient.put(`/api/v1/reserves/${id}`, data),
  moveToStock:   (id)           => apiClient.post(`/api/v1/reserves/${id}/to-stock`),
  cancelOrder:   (id)           => apiClient.post(`/api/v1/reserves/${id}/cancel`),
  restoreOrder:  (id)           => apiClient.post(`/api/v1/reserves/${id}/restore`),
  deleteOrder:   (id)           => apiClient.delete(`/api/v1/reserves/${id}`),
};
