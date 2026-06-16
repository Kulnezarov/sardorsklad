import apiClient from './client';

export const intakeApi = {
  list: () => apiClient.get('/api/v1/intake-invoices/'),
  nextNumber: () => apiClient.get('/api/v1/intake-invoices/next-number'),
  upsert: (invoice) => apiClient.post('/api/v1/intake-invoices/', invoice),
  remove: (clientId) =>
    apiClient.delete(`/api/v1/intake-invoices/client/${encodeURIComponent(String(clientId).trim())}`),
  revertWarehouse: (clientId) =>
    apiClient.post(
      `/api/v1/intake-invoices/client/${encodeURIComponent(String(clientId).trim())}/revert-warehouse`,
    ),
};
