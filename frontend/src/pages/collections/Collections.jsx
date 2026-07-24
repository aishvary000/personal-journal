
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export default function Collections() {
  const [status, setStatus] = useState('loading');
  const [shares, setShares] = useState([]);
  const [resultModal, setResultModal] = useState(null); // { collection_name, url, passcode }
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // share object pending delete confirmation
  const [deletingId, setDeletingId] = useState(null);

  const PAGE_SIZE = 20;

  function fetchPage(offset) {
    return fetch(
      `${API_BASE}/api/shares?limit=${PAGE_SIZE}&offset=${offset}`,
      { credentials: 'include' }
    ).then((res) => res.json());
  }

  useEffect(() => {
    fetchPage(0)
      .then((data) => {
        setShares(data.shares);
        setHasMore(data.has_more);
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const data = await fetchPage(shares.length);
      setShares((prev) => [...prev, ...data.shares]);
      setHasMore(data.has_more);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleGetLink(shareId) {
    const res = await fetch(
      `${API_BASE}/api/shares/${shareId}/reset-passcode`,
      { method: 'POST', credentials: 'include' }
    );
    const data = await res.json();
    if (res.ok) {
      setResultModal(data);
    }
  }

  async function handleDelete(shareId) {
    setDeletingId(shareId);
    try {
      const res = await fetch(`${API_BASE}/api/shares/${shareId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.id !== shareId));
        setConfirmDelete(null);
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>collections</span>
      </header>

      {status === 'loading' && <p style={styles.message}>loading…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load collections.</p>}
      {status === 'loaded' && shares.length === 0 && (
        <p style={styles.message}>no shared collections yet.</p>
      )}

      {status === 'loaded' && shares.length > 0 && (
        <div style={styles.list}>
          {shares.map((s) => (
            <div key={s.id} style={styles.row}>
              <div style={styles.rowInfo}>
                <span style={styles.rowName}>{s.collection_name}</span>
                <span style={styles.rowMeta}>
                  {s.photo_count} photo{s.photo_count !== 1 ? 's' : ''} · created{' '}
                  {new Date(s.created_at).toLocaleDateString()}
                  {s.expires_at &&
                    (s.is_expired
                      ? ' · expired'
                      : ` · expires ${new Date(s.expires_at).toLocaleDateString()}`)}
                  {!s.expires_at && ' · never expires'}
                </span>
              </div>
              <div style={styles.rowActions}>
                <button onClick={() => handleGetLink(s.id)} style={styles.getLinkButton}>
                  get link
                </button>
                <button onClick={() => setConfirmDelete(s)} style={styles.deleteButton}>
                  delete
                </button>
              </div>
            </div>
          ))}
          {hasMore && (
            <button onClick={handleLoadMore} disabled={loadingMore} style={styles.loadMoreButton}>
              {loadingMore ? 'loading…' : 'load more'}
            </button>
          )}
        </div>
      )}

      {resultModal && (
        <div style={styles.modalBackdrop} onClick={() => setResultModal(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.shareBox}>
              <div style={styles.shareRow}>
                <span style={styles.shareLabel}>collection</span>
                <code style={styles.shareValue}>{resultModal.collection_name}</code>
              </div>
              <div style={styles.shareRow}>
                <span style={styles.shareLabel}>link</span>
                <code style={styles.shareValue}>{resultModal.url}</code>
              </div>
              <div style={styles.shareRow}>
                <span style={styles.shareLabel}>new passcode</span>
                <code style={styles.shareValue}>{resultModal.passcode}</code>
              </div>
              <p style={styles.shareNote}>
                any previous passcode for this collection no longer works — send this new one.
              </p>
            </div>
            <button onClick={() => setResultModal(null)} style={styles.modalClose}>
              close
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={styles.modalBackdrop} onClick={() => setConfirmDelete(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.shareBox}>
              <span style={styles.shareLabel}>delete collection?</span>
              <code style={styles.shareValue}>{confirmDelete.collection_name}</code>
              <p style={styles.shareNote}>
                the link will stop working immediately — this can't be undone.
              </p>
            </div>
            <div style={styles.confirmRow}>
              <button onClick={() => setConfirmDelete(null)} style={styles.modalClose}>
                cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={deletingId === confirmDelete.id}
                style={styles.confirmDeleteButton}
              >
                {deletingId === confirmDelete.id ? 'deleting…' : 'yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0B0D12',
    fontFamily: FONT_MONO,
    padding: '32px 24px',
    color: '#E5E7EB',
  },
  header: {
    maxWidth: '700px',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '16px',
    letterSpacing: '1px',
    color: '#E8A33D',
  },
  message: {
    maxWidth: '700px',
    margin: '0 auto',
    fontSize: '13px',
    color: '#9CA3AF',
  },
  list: {
    maxWidth: '700px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    padding: '14px 16px',
  },
  rowInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  rowName: {
    fontSize: '13px',
    color: '#E5E7EB',
  },
  rowMeta: {
    fontSize: '11px',
    color: '#6B7280',
  },
  getLinkButton: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#E8A33D',
    borderRadius: '6px',
    padding: '8px 14px',
    fontFamily: FONT_MONO,
    fontSize: '12px',
    cursor: 'pointer',
  },
  rowActions: {
    display: 'flex',
    gap: '8px',
  },
  deleteButton: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#F87171',
    borderRadius: '6px',
    padding: '8px 14px',
    fontFamily: FONT_MONO,
    fontSize: '12px',
    cursor: 'pointer',
  },
  confirmRow: {
    display: 'flex',
    gap: '10px',
  },
  confirmDeleteButton: {
    background: '#F87171',
    color: '#0B0D12',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontFamily: FONT_MONO,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  loadMoreButton: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#9CA3AF',
    borderRadius: '6px',
    padding: '10px',
    fontFamily: FONT_MONO,
    fontSize: '12px',
    cursor: 'pointer',
    marginTop: '4px',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(11, 13, 18, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px',
  },
  modalContent: {
    maxWidth: '90vw',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
  },
  shareBox: {
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '380px',
  },
  shareRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  shareLabel: {
    fontSize: '11px',
    color: '#6B7280',
  },
  shareValue: {
    background: '#0B0D12',
    border: '1px solid #2D3340',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#E8A33D',
    fontSize: '13px',
    wordBreak: 'break-all',
  },
  shareNote: {
    fontSize: '11px',
    color: '#6B7280',
    lineHeight: 1.5,
    margin: 0,
  },
  modalClose: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#9CA3AF',
    borderRadius: '6px',
    padding: '8px 16px',
    fontFamily: FONT_MONO,
    fontSize: '13px',
    cursor: 'pointer',
  },
};