import apiClient from './client';

export const productsApi = {
  getProducts: (filters = {}) => apiClient.get('/api/v1/products/', { params: filters }),
  getProduct: (id) => apiClient.get(`/api/v1/products/${id}`),
  createProduct: (data) => apiClient.post('/api/v1/products/', data),
  updateProduct: (id, data) => apiClient.put(`/api/v1/products/${id}`, data),
  deleteProduct: (id) => apiClient.delete(`/api/v1/products/${id}`),
  getCategories: () => apiClient.get('/api/v1/products/categories/list'),
  getStats: () => apiClient.get('/api/v1/products/stats/summary'),
  uploadProductImage: (id, file, options = {}) => {
    const { onUploadProgress, signal } = options;
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post(`/api/v1/products/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
      signal,
    });
  },
  deleteProductImage: (id) => apiClient.delete(`/api/v1/products/${id}/image`),
  deleteProductGalleryImage: (id, fileName) =>
    apiClient.delete(`/api/v1/products/${id}/images/${encodeURIComponent(fileName)}`),
};
