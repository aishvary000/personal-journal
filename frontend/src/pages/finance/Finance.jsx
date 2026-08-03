
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export default function TransactionReview() {
  const [status, setStatus] = useState('loading');
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/finance/transactions?needs_review=true&limit=50`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${API_BASE}/api/finance/categories`, { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([txData, catData]) => {
        setTransactions(txData.transactions);
        setCategories(catData.categories);
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  function updateLocal(id, field, value) {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }

  async function handleSave(transaction) {
    setSavingId(transaction.id);
    try {
      const res = await fetch(`${API_BASE}/api/finance/transactions/${transaction.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: transaction.amount,
          merchant: transaction.merchant,
          category: transaction.category,
        }),
      });
      if (res.ok) {
        // remove from the review list once confirmed
        setTransactions((prev) => prev.filter((t) => t.id !== transaction.id));
      }
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>needs review</span>
        <span style={styles.count}>{transactions.length} transaction(s)</span>
      </header>

      {status === 'loading' && <p style={styles.message}>loading…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load transactions.</p>}
      {status === 'loaded' && transactions.length === 0 && (
        <p style={styles.message}>nothing needs review right now.</p>
      )}

      {status === 'loaded' && transactions.map((t) => (
        <div key={t.id} style={styles.card}>
          <div style={styles.rawText}>"{t.raw_text}"</div>
          <div style={styles.fields}>
            <label style={styles.field}>
              <span style={styles.label}>amount</span>
              <input
                type="number"
                value={t.amount || ''}
                onChange={(e) => updateLocal(t.id, 'amount', e.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>merchant</span>
              <input
                type="text"
                value={t.merchant || ''}
                onChange={(e) => updateLocal(t.id, 'merchant', e.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>category</span>
              <select
                value={t.category || 'Uncategorized'}
                onChange={(e) => updateLocal(t.id, 'category', e.target.value)}
                style={styles.input}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            onClick={() => handleSave(t)}
            disabled={savingId === t.id}
            style={styles.confirmButton}
          >
            {savingId === t.id ? 'saving…' : 'confirm & teach'}
          </button>
        </div>
      ))}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#0B0D12', fontFamily: FONT_MONO, padding: '32px 24px', color: '#E5E7EB' },
  header: { maxWidth: '700px', margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: '16px', letterSpacing: '1px', color: '#E8A33D' },
  count: { fontSize: '12px', color: '#6B7280' },
  message: { maxWidth: '700px', margin: '0 auto', fontSize: '13px', color: '#9CA3AF' },
  card: { maxWidth: '700px', margin: '0 auto 14px', background: '#12151C', border: '1px solid #262B36', borderRadius: '8px', padding: '16px' },
  rawText: { fontSize: '11px', color: '#6B7280', marginBottom: '12px', lineHeight: 1.5 },
  fields: { display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px' },
  label: { fontSize: '10px', color: '#6B7280', textTransform: 'uppercase' },
  input: { background: '#0B0D12', border: '1px solid #2D3340', borderRadius: '6px', padding: '8px 10px', color: '#E5E7EB', fontFamily: FONT_MONO, fontSize: '13px' },
  confirmButton: { background: '#E8A33D', color: '#0B0D12', border: 'none', borderRadius: '6px', padding: '8px 16px', fontFamily: FONT_MONO, fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
};