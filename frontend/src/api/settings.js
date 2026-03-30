import apiClient from './client';

export const settingsApi = {
  getSettings: () => apiClient.get('/api/v1/settings/'),
  updateSettings: (data) => apiClient.put('/api/v1/settings/', data),
  getDashboard: () => apiClient.get('/api/v1/settings/dashboard'),
  getCnyRate: () => apiClient.get('/api/v1/settings/exchange/cny-rate'),
};
