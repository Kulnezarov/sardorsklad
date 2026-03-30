import apiClient from './client';

export const salesApi = {
  getSales: (filters = {}) => apiClient.get('/api/v1/sales/', { params: filters }),
  getSale: (id) => apiClient.get(`/api/v1/sales/${id}`),
  createSale: (data) => apiClient.post('/api/v1/sales/', data),
  deleteSale: (id) => apiClient.delete(`/api/v1/sales/${id}`),
  clearSales: () => apiClient.delete('/api/v1/sales/'),
  getTodayStats: () => apiClient.get('/api/v1/sales/today/revenue'),
};
