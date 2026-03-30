import apiClient from './client';

export const historyApi = {
  getHistory: (filters = {}) => apiClient.get('/api/v1/history/', { params: filters }),
  deleteHistoryItem: (id) => apiClient.delete(`/api/v1/history/${id}`),
  clearHistory: () => apiClient.delete('/api/v1/history/'),
  cleanup: () => apiClient.post('/api/v1/history/cleanup'),
};
