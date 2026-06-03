import React, { useState } from 'react';
import { FiUsers } from 'react-icons/fi';
import Sales from './Sales';
import Debt from './Debt';

/**
 * Продажа: одна касса на обе вкладки (чек не сбрасывается), «В долг» и клиенты.
 */
export default function SalesHub() {
  const [tab, setTab] = useState('pos');

  if (tab === 'clients') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <Debt onBack={() => setTab('debt')} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="sales-hub-tabs">
        <button
          type="button"
          className={`sales-hub-tab${tab === 'pos' ? ' sales-hub-tab-active' : ''}`}
          onClick={() => setTab('pos')}
        >
          Продажа
        </button>
        <button
          type="button"
          className={`sales-hub-tab sales-hub-tab-debt${tab === 'debt' ? ' sales-hub-tab-active' : ''}`}
          onClick={() => setTab('debt')}
        >
          В долг
        </button>
        {tab === 'debt' && (
          <button
            type="button"
            className="sales-hub-tab-clients"
            onClick={() => setTab('clients')}
            title="Клиенты и история"
          >
            <FiUsers size={16} />
            <span>Клиенты</span>
          </button>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <Sales
          mode={tab === 'debt' ? 'debt' : 'cash'}
          onOpenClients={() => setTab('clients')}
          onSwitchToDebtTab={() => setTab('debt')}
        />
      </div>
    </div>
  );
}
