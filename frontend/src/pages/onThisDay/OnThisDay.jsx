
import { useState, useEffect, useCallback } from 'react';

const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

function todayString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export default function OnThisDay() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [photos, setPhotos] = useState([]);
  const [range, setRange] = useState({ start: '', end: '' });

  // separate state for the input fields, so typing doesn't refetch until submit
  const [startInput, setStartInput] = useState(todayString());
  const [endInput, setEndInput] = useState(todayString());

  const fetchPhotos = useCallback((start, end) => {
    setStatus('loading');

    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString() ? `?${params.toString()}` : '';

    fetch(`https://api.personal-journal.aishvary.dev/api/photos${query}`, {
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
              <a href={p.full_url} target="_blank" rel="noopener noreferrer">
                <img src={p.thumb_url} alt="" style={styles.image} loading="lazy" />
              </a>
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
  },
  image: {
    width: '100%',
    aspectRatio: '1',
    objectFit: 'cover',
    display: 'block',
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
};

