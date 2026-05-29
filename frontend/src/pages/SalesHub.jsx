import React, { useState } from 'react';
import Sales from './Sales';
import Debt from './Debt';

/**
 * Продажа: вкладка «Продажа» (касса) и «В долг» (клиенты и долги).
 */
export default function SalesHub() {
  const [tab, setTab] = useState('pos');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '12px 16px 0',
          maxWidth: 1200,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <button
          type="button"
          onClick={() => setTab('pos')}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: 12,
            border: tab === 'pos' ? '2px solid var(--primary)' : '1px solid var(--border)',
            background: tab === 'pos' ? 'var(--primary-light)' : 'var(--surface)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Продажа
        </button>
        <button
          type="button"
          onClick={() => setTab('debt')}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: 12,
            border: tab === 'debt' ? '2px solid var(--primary)' : '1px solid var(--border)',
            background: tab === 'debt' ? 'var(--primary-light)' : 'var(--surface)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          В долг
        </button>
      </div>
      <div style={{ flex: 1 }}>
        {tab === 'pos' ? <Sales /> : <Debt />}
      </div>
    </div>
  );
}
