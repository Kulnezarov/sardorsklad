import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { categoryApi, brandApi } from '../api/client';

function EntityBlock({ title, rows, onCreate, onDelete }) {
  const [name, setName] = useState('');
  return (
    <div className="ios-card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="ios-input" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="ios-button" onClick={() => { if (!name.trim()) return; onCreate(name.trim()); setName(''); }}>
          Добавить
        </button>
      </div>
      {rows.map((row) => (
        <div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 700 }}>{row.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.slug}</div>
          </div>
          <button type="button" className="ios-button danger" onClick={() => onDelete(row.id)}>
            Удалить
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Categories() {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery({ queryKey: ['categories-admin'], queryFn: () => categoryApi.getAll().then((r) => r.data) });
  const { data: brands = [] } = useQuery({ queryKey: ['brands-admin'], queryFn: () => brandApi.getAll().then((r) => r.data) });

  const createCategory = useMutation({
    mutationFn: (name) => categoryApi.create({ name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categories-admin'] }); toast.success('Категория добавлена'); },
    onError: () => toast.error('Не удалось добавить категорию'),
  });
  const deleteCategory = useMutation({
    mutationFn: (id) => categoryApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categories-admin'] }); toast.success('Категория удалена'); },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Ошибка удаления'),
  });
  const createBrand = useMutation({
    mutationFn: (name) => brandApi.create({ name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['brands-admin'] }); toast.success('Бренд добавлен'); },
    onError: () => toast.error('Не удалось добавить бренд'),
  });
  const deleteBrand = useMutation({
    mutationFn: (id) => brandApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['brands-admin'] }); toast.success('Бренд удален'); },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Ошибка удаления'),
  });

  return (
    <div className="page-ios">
      <h1 className="ios-mega-title">Категории и бренды</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <EntityBlock title="Категории" rows={categories} onCreate={(name) => createCategory.mutate(name)} onDelete={(id) => deleteCategory.mutate(id)} />
        <EntityBlock title="Бренды" rows={brands} onCreate={(name) => createBrand.mutate(name)} onDelete={(id) => deleteBrand.mutate(id)} />
      </div>
    </div>
  );
}
