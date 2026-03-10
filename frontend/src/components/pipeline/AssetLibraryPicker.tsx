import { useEffect, useRef, useState } from 'react'

const API = 'http://localhost:8000'

type Category = 'library' | 'sprites' | 'scenes' | 'audio' | 'refs'

interface AssetItem {
  url: string
  filename: string
  size: number
}

interface AllAssets {
  library?: AssetItem[]
  sprites?: AssetItem[]
  scenes?: AssetItem[]
  audio?: AssetItem[]
  refs?: AssetItem[]
  [key: string]: AssetItem[] | undefined
}

interface Props {
  projectId: string
  onSelect?: (url: string) => void
  onClose: () => void
  title?: string
  defaultTab?: Category
}

export function AssetLibraryPicker({ projectId, onSelect, onClose, title, defaultTab = 'library' }: Props) {
  const [assets, setAssets] = useState<AllAssets>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Category>(defaultTab)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/library`)
      setAssets(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    await fetch(`${API}/api/projects/${projectId}/library`, { method: 'POST', body: fd })
    setUploading(false)
    await load()
  }

  async function handleRename(url: string) {
    const trimmed = renameVal.trim()
    setRenaming(null)
    if (!trimmed || trimmed === url.split('/').pop()) return
    await fetch(`${API}/api/projects/${projectId}/library/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, new_name: trimmed }),
    })
    await load()
  }

  const TABS: { key: Category; label: string }[] = [
    { key: 'library', label: 'Uploads' },
    { key: 'sprites', label: 'Sprites' },
    { key: 'scenes', label: 'Scenes' },
    { key: 'audio', label: 'Audio' },
    { key: 'refs', label: 'Refs' },
  ]

  const currentItems = (assets[tab] ?? []).filter(item =>
    !search || item.filename.toLowerCase().includes(search.toLowerCase())
  )

  const isImage = (url: string) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url)
  const isVideo = (url: string) => /\.(mp4|webm|mov)$/i.test(url)
  const isAudio = (url: string) => /\.(wav|mp3|ogg|m4a)$/i.test(url)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, width: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'white', fontWeight: 'bold', fontSize: 13, flex: 1 }}>
            {title ?? 'Asset Library'}
          </span>
          <input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '3px 8px', width: 140, outline: 'none' }}
          />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', padding: '0 12px', alignItems: 'center' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
                color: tab === t.key ? '#818cf8' : '#6b7280',
                fontSize: 11, padding: '7px 10px', cursor: 'pointer', fontWeight: tab === t.key ? 'bold' : 'normal',
              }}
            >
              {t.label}
              <span style={{ marginLeft: 4, fontSize: 10, color: '#4b5563' }}>({(assets[t.key] ?? []).length})</span>
            </button>
          ))}
          {tab === 'library' && (
            <div style={{ marginLeft: 'auto' }}>
              <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{ background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: uploading ? 'not-allowed' : 'pointer' }}
              >
                {uploading ? 'Uploading...' : '↑ Upload'}
              </button>
            </div>
          )}
        </div>

        {/* Grid */}
        <div style={{ overflowY: 'auto', padding: 12, flex: 1 }}>
          {loading ? (
            <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 40 }}>Loading...</div>
          ) : currentItems.length === 0 ? (
            <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 40 }}>
              {search ? 'No matches.' : tab === 'library' ? 'No uploads yet — use ↑ Upload above.' : 'No assets generated yet.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {currentItems.map(item => {
                const fullUrl = `${API}/api/projects/${projectId}/assets/${item.url}`
                const img = isImage(item.url)
                const vid = isVideo(item.url)
                const aud = isAudio(item.url)
                const isRenaming = renaming === item.url
                return (
                  <div
                    key={item.url}
                    onClick={() => { if (onSelect && !isRenaming) { onSelect(item.url); onClose() } }}
                    style={{
                      borderRadius: 6, overflow: 'hidden', border: '1px solid #374151',
                      background: '#1f2937', cursor: onSelect && !isRenaming ? 'pointer' : 'default',
                    }}
                    onMouseEnter={e => onSelect && (e.currentTarget.style.borderColor = '#6366f1')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#374151')}
                  >
                    <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
                      {img && <img src={fullUrl} alt={item.filename} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.1' }} />}
                      {vid && <span style={{ fontSize: 30 }}>🎬</span>}
                      {aud && <span style={{ fontSize: 30 }}>🎵</span>}
                      {!img && !vid && !aud && <span style={{ fontSize: 30 }}>📄</span>}
                    </div>
                    <div style={{ padding: '4px 6px' }}>
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameVal}
                          onChange={e => setRenameVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(item.url); if (e.key === 'Escape') setRenaming(null) }}
                          onBlur={() => handleRename(item.url)}
                          onClick={e => e.stopPropagation()}
                          style={{ width: '100%', background: '#374151', border: '1px solid #6366f1', borderRadius: 3, color: 'white', fontSize: 10, padding: '1px 3px', boxSizing: 'border-box', outline: 'none' }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <span style={{ fontSize: 9, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }} title={item.filename}>{item.filename}</span>
                          {tab === 'library' && (
                            <button
                              onClick={e => { e.stopPropagation(); setRenaming(item.url); setRenameVal(item.filename) }}
                              style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 11, cursor: 'pointer', padding: 0, flexShrink: 0 }}
                              title="Rename"
                            >✎</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
