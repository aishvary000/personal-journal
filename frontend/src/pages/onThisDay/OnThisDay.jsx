import { useState, useEffect, useCallback } from 'react';

const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const API_BASE = import.meta.env.VITE_API_BASE_URL;

function todayString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export default function OnThisDay() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [photos, setPhotos] = useState([]);
  const [range, setRange] = useState({ start: '', end: '' });
  const [activeVideo, setActiveVideo] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [shareModal, setShareModal] = useState(null); // { link, passcode, name } once created
  const [shareChoice, setShareChoice] = useState(null); // null | 'choosing' | 'new'
  const [collectionName, setCollectionName] = useState('');
  const [expiryChoice, setExpiryChoice] = useState('7'); // '7' | '30' | '90' | 'never'
  const [existingCollections, setExistingCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openShareChoice() {
    setShareChoice('choosing');
    // preload existing collections so the "add to existing" option can show them
    try {
      const res = await fetch(`${API_BASE}/api/shares?limit=100`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) setExistingCollections(data.shares);
    } catch {
      // if this fails, the "add to existing" option just won't have anything to show —
      // "create new" still works fine regardless
    }
  }

  async function handleAddToExisting() {
    if (!selectedCollectionId) return;

    const res = await fetch(`${API_BASE}/api/shares/${selectedCollectionId}/add-photos`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: Array.from(selectedIds) }),
    });

    const data = await res.json();
    if (res.ok) {
      setShareModal({ link: data.url, name: data.collection_name, addedTo: true });
      setSelectedIds(new Set());
      setShareChoice(null);
      setSelectedCollectionId('');
    }
  }

  async function handleCreateShare() {
    const res = await fetch(`${API_BASE}/api/shares`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo_ids: Array.from(selectedIds),
        collection_name: collectionName,
        expires_in_days: expiryChoice === 'never' ? null : Number(expiryChoice),
      }),
    });

    const data = await res.json();
    if (res.ok) {
      setShareModal({ link: data.url, passcode: data.passcode, name: collectionName || 'Untitled share' });
      setSelectedIds(new Set());
      setShareChoice(null);
      setCollectionName('');
      setExpiryChoice('7');
    }
  }

  // separate state for the input fields, so typing doesn't refetch until submit
  const [startInput, setStartInput] = useState(todayString());
  const [endInput, setEndInput] = useState(todayString());

  const fetchPhotos = useCallback((start, end) => {
    setStatus('loading');

    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString() ? `?${params.toString()}` : '';

    fetch(`${API_BASE}/api/photos${query}`, {
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error('request failed');
        return res.json();
      })
      .then((data) => {
        setPhotos(data.photos);
        setRange({ start: data.start, end: data.end });
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  // initial load: no params, defaults to today on the backend
  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  function handleSearch(e) {
    e.preventDefault();
    fetchPhotos(startInput, endInput);
  }

  function handleResetToToday() {
    const today = todayString();
    setStartInput(today);
    setEndInput(today);
    fetchPhotos(today, today);
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>on this day</span>
        {range.start && (
          <span style={styles.date}>
            {range.start === range.end ? range.start : `${range.start} → ${range.end}`}
          </span>
        )}
      </header>

      <div style={styles.rangeBar}>
        <label style={styles.label}>
          from
          <input
            type="date"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            style={styles.dateInput}
          />
        </label>
        <label style={styles.label}>
          to
          <input
            type="date"
            value={endInput}
            onChange={(e) => setEndInput(e.target.value)}
            style={styles.dateInput}
          />
        </label>
        <button onClick={handleSearch} style={styles.searchButton}>
          search
        </button>
        <button onClick={handleResetToToday} style={styles.todayButton}>
          today
        </button>
        {selectedIds.size > 0 && (
          <button onClick={openShareChoice} style={styles.searchButton}>
            share selected ({selectedIds.size})
          </button>
        )}
      </div>

      {status === 'loading' && <p style={styles.message}>loading photos…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load photos — try refreshing.</p>}
      {status === 'loaded' && photos.length === 0 && (
        <p style={styles.message}>nothing found for this range.</p>
      )}

      {status === 'loaded' && photos.length > 0 && (
        <div style={styles.grid}>
          {photos.map((p) => (
            <figure key={p.id} style={styles.card}>
              <input
                type="checkbox"
                checked={selectedIds.has(p.id)}
                onChange={() => toggleSelected(p.id)}
                style={styles.checkbox}
              />
              {p.media_type === 'video' ? (
                <button
                  onClick={() => setActiveVideo(p)}
                  style={{ ...styles.thumbLink, ...styles.thumbButtonReset }}
                >
                  <img src={p.thumb_url} alt="" style={styles.image} loading="lazy" />
                  <span style={styles.playOverlay} aria-hidden="true">▶</span>
                </button>
              ) : (
                <a href={p.full_url} target="_blank" rel="noopener noreferrer" style={styles.thumbLink}>
                  <img src={p.thumb_url} alt="" style={styles.image} loading="lazy" />
                </a>
              )}
              <figcaption style={styles.caption}>
                <span>
                  {p.years_ago === 0 ? 'today' : `${p.years_ago} year${p.years_ago > 1 ? 's' : ''} ago`}
                </span>
                <a href={p.download_url} style={styles.downloadLink}>
                  ⬇ download
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {activeVideo && (
        <div style={styles.modalBackdrop} onClick={() => setActiveVideo(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <video
              src={activeVideo.full_url}
              controls
              autoPlay={false}
              style={styles.modalVideo}
            />
            <button onClick={() => setActiveVideo(null)} style={styles.modalClose}>
              close
            </button>
          </div>
        </div>
      )}
      {shareChoice === 'choosing' && (
        <div style={styles.modalBackdrop} onClick={() => setShareChoice(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.shareBox}>
              <span style={styles.shareLabel}>share these {selectedIds.size} photo(s)</span>
              <button
                onClick={() => setShareChoice('new')}
                style={styles.searchButton}
              >
                create new collection
              </button>
              {existingCollections.length > 0 ? (
                <>
                  <span style={styles.shareLabel}>or add to an existing collection</span>
                  <select
                    value={selectedCollectionId}
                    onChange={(e) => setSelectedCollectionId(e.target.value)}
                    style={styles.dateInput}
                  >
                    <option value="">select a collection…</option>
                    {existingCollections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.collection_name} ({c.photo_count} photos)
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddToExisting}
                    disabled={!selectedCollectionId}
                    style={styles.todayButton}
                  >
                    add to selected collection
                  </button>
                </>
              ) : (
                <p style={styles.shareNote}>no existing collections yet — create one above.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {shareChoice === 'new' && (
        <div style={styles.modalBackdrop} onClick={() => setShareChoice(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.shareBox}>
              <span style={styles.shareLabel}>name this collection</span>
              <input
                type="text"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder="e.g. Goa trip 2024"
                style={styles.dateInput}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateShare();
                }}
              />
              <span style={styles.shareLabel}>link expires after</span>
              <select
                value={expiryChoice}
                onChange={(e) => setExpiryChoice(e.target.value)}
                style={styles.dateInput}
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="never">never</option>
              </select>
              <p style={styles.shareNote}>
                helps you identify this share later — not shown to whoever you send the link to.
              </p>
            </div>
            <button onClick={handleCreateShare} style={styles.searchButton}>
              create share
            </button>
          </div>
        </div>
      )}

      {shareModal && (
        <div style={styles.modalBackdrop} onClick={() => setShareModal(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.shareBox}>
              <div style={styles.shareRow}>
                <span style={styles.shareLabel}>collection</span>
                <code style={styles.shareValue}>{shareModal.name}</code>
              </div>
              <div style={styles.shareRow}>
                <span style={styles.shareLabel}>link</span>
                <code style={styles.shareValue}>{shareModal.link}</code>
              </div>
              {shareModal.passcode && (
                <div style={styles.shareRow}>
                  <span style={styles.shareLabel}>passcode</span>
                  <code style={styles.shareValue}>{shareModal.passcode}</code>
                </div>
              )}
              <p style={styles.shareNote}>
                {shareModal.addedTo
                  ? 'photos added — the existing link and passcode still work, no need to resend them.'
                  : 'send both the link and the passcode to whoever you want to see these.'}
              </p>
            </div>
            <button onClick={() => setShareModal(null)} style={styles.modalClose}>
              close
            </button>
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
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    maxWidth: '900px',
    margin: '0 auto 16px',
  },
  title: {
    fontSize: '16px',
    letterSpacing: '1px',
    color: '#E8A33D',
  },
  date: {
    fontSize: '13px',
    color: '#6B7280',
  },
  rangeBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: '12px',
    maxWidth: '900px',
    margin: '0 auto 24px',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    padding: '14px 16px',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '11px',
    color: '#6B7280',
  },
  dateInput: {
    background: '#0B0D12',
    border: '1px solid #2D3340',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#E5E7EB',
    fontFamily: FONT_MONO,
    fontSize: '13px',
  },
  searchButton: {
    background: '#E8A33D',
    color: '#0B0D12',
    border: 'none',
    borderRadius: '6px',
    padding: '9px 16px',
    fontFamily: FONT_MONO,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  todayButton: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#9CA3AF',
    borderRadius: '6px',
    padding: '9px 16px',
    fontFamily: FONT_MONO,
    fontSize: '13px',
    cursor: 'pointer',
  },
  message: {
    maxWidth: '900px',
    margin: '0 auto',
    fontSize: '13px',
    color: '#9CA3AF',
  },
  grid: {
    maxWidth: '900px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
  },
  card: {
    margin: 0,
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    aspectRatio: '1',
    objectFit: 'cover',
    display: 'block',
  },
  thumbLink: {
    position: 'relative',
    display: 'block',
  },
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: 'rgba(11, 13, 18, 0.7)',
    color: '#E8A33D',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    pointerEvents: 'none',
  },
  thumbButtonReset: {
    border: 'none',
    padding: 0,
    margin: 0,
    background: 'none',
    cursor: 'pointer',
    width: '100%',
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
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
  },
  modalVideo: {
    maxWidth: '90vw',
    maxHeight: '80vh',
    borderRadius: '8px',
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
  caption: {
    padding: '8px 10px',
    fontSize: '11px',
    color: '#6B7280',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  downloadLink: {
    color: '#E8A33D',
    textDecoration: 'none',
  },
  checkbox: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    zIndex: 2,
    width: '18px',
    height: '18px',
    cursor: 'pointer',
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
};