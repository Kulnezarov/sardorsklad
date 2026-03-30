import apiClient from './client';

export const revisionApi = {
  getSessions: () => apiClient.get('/revision'),
  getSession: (id) => apiClient.get(`/revision/${id}`),
  startSession: () => apiClient.post('/revision/start'),
  getSessionItems: (sessionId) => apiClient.get(`/revision/${sessionId}`),
  updateItem: (sessionId, productId, data) => 
    apiClient.put(`/revision/${sessionId}/item/${productId}`, data),
  completeSession: (sessionId) => apiClient.post(`/revision/${sessionId}/complete`),
};
