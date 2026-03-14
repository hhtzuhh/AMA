import { useState, useRef } from 'react'
import type { Character } from '../../types'
import { charSlug } from './PageNode'
import { API_URL as API } from '../../config'

interface Props {
  projectId: string
  characters: Character[]
  manifest: Record<string, any>
  onManifestChange: () => void
  onCharactersReloaded: () => void
  onClose: () => void
}

export default function SpritesPanel({ projectId, characters, manifest, onManifestChange, onCharactersReloaded, onClose }: Props) {
  // generating: "slug/state" → progress string
  const [generating, setGenerating] = useState<Record<string, string>>({})
  const pollsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  // cacheBust: "slug/state" → timestamp, updated after each successful generation
  const [cacheBust, setCacheBust] = useState<Record<string, number>>({})
  // newState: slug → typed state name
  const [newState, setNewState] = useState<Record<string, string>>({})
  // new character form
  const [showAddChar, setShowAddChar] = useState(false)
  const [newCharName, setNewCharName] = useState('')
  const [newCharDesc, setNewCharDesc] = useState('')
  const [creatingChar, setCreatingChar] = useState(false)
  const [createProgress, setCreateProgress] = useState('')

  function assetUrl(path: string) {
    return `${API}/api/projects/${projectId}/assets/${path}`
  }

  async function generateSprite(slug: string, state: string) {
    const key = `${slug}/${state}`
    setGenerating(prev => ({ ...prev, [key]: 'Starting…' }))
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/pipeline/sprite/${slug}/${state}`, { method: 'POST' })
      const { job_id } = await res.json()
      if (pollsRef.current[key]) clearInterval(pollsRef.current[key])
      pollsRef.current[key] = setInterval(async () => {
        const jr = await fetch(`${API}/api/projects/${projectId}/pipeline/jobs/${job_id}`)
        const job = await jr.json()
        setGenerating(prev => ({ ...prev, [key]: job.progress ?? '' }))
        if (job.status === 'done' || job.status === 'failed') {
          clearInterval(pollsRef.current[key])
          delete pollsRef.current[key]
          setGenerating(prev => { const n = { ...prev }; delete n[key]; return n })
          if (job.status === 'done') {
            setCacheBust(prev => ({ ...prev, [key]: Date.now() }))
          }
          onManifestChange()
        }
      }, 2000)
    } catch {
      setGenerating(prev => { const n = { ...prev }; delete n[`${slug}/${state}`]; return n })
    }
  }

  async function generateAll() {
    for (const char of characters) {
      const slug = charSlug(char.name)
      for (const state of char.sprite_states ?? ['idle']) {
        await generateSprite(slug, state)
        await new Promise(r => setTimeout(r, 300))
      }
    }
  }

  async function createCharacter() {
    if (!newCharName.trim()) return
    setCreatingChar(true)
    setCreateProgress('Planning character…')
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/studio/characters/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCharName.trim(), description: newCharDesc.trim() }),
      })
      const data = await res.json()
      if (data.error) { setCreateProgress('Error: ' + data.error); return }
      setCreateProgress('Done! Generating idle sprite…')
      onCharactersReloaded()
      onManifestChange()
      // Auto-generate idle sprite
      const slug = data.slug
      if (slug) generateSprite(slug, 'idle')
      setNewCharName('')
      setNewCharDesc('')
      setShowAddChar(false)
      setCreateProgress('')
    } catch (e: any) {
      setCreateProgress('Error: ' + e.message)
    } finally {
      setCreatingChar(false)
    }
  }

  async function addNewState(slug: string, state: string) {
    const trimmed = state.trim().toLowerCase()
    if (!trimmed) return
    // Register the state on the character in story_data
    await fetch(`${API}/api/projects/${projectId}/characters/${slug}/sprite-states`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: trimmed }),
    })
    setNewState(prev => ({ ...prev, [slug]: '' }))
    onManifestChange()
    onCharactersReloaded()
    // Immediately kick off generation
    generateSprite(slug, trimmed)
  }

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 340, height: '100%',
      background: '#0f0f1a', borderLeft: '1px solid #374151',
      zIndex: 50, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#f59e0b' }}>🎨 Character Sprites</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={generateAll}
            style={{ background: '#92400e', color: '#fbbf24', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
          >
            Run All
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {characters.length === 0 && (
          <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 40 }}>
            No characters yet — run Story Understanding first.
          </div>
        )}
        {characters.map(char => {
          const slug = charSlug(char.name)
          const charManifest = manifest?.characters?.[slug]
          const states: string[] = char.sprite_states?.length ? char.sprite_states : ['idle']

          return (
            <div key={slug} style={{ marginBottom: 18 }}>
              {/* Character header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {/* Ref image preview */}
                {charManifest && (
                  <img
                    src={assetUrl(`refs/${slug}_ref.png`)}
                    style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', background: '#1f2937' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>{char.name}</div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{char.role}</div>
                </div>
              </div>

              {/* Sprite states grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {states.map(state => {
                  const key = `${slug}/${state}`
                  const entry = charManifest?.sprites?.[state]
                  const versions: any[] = entry?.versions ?? []
                  const latest = versions.length > 0 ? versions[versions.length - 1] : null
                  const isGenerating = key in generating

                  return (
                    <div key={state} style={{ background: '#111827', borderRadius: 6, padding: 6, border: '1px solid #1f2937', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 64, height: 64, background: '#0f172a', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {latest ? (
                          <img src={`${assetUrl(latest.url)}?t=${cacheBust[key] ?? 0}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                          <span style={{ fontSize: 9, color: '#4b5563' }}>none</span>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: '#9ca3af', textAlign: 'center', textTransform: 'capitalize' }}>{state}</div>
                      {isGenerating ? (
                        <div style={{ fontSize: 9, color: '#fbbf24', textAlign: 'center' }}>⏳ {generating[key] || '…'}</div>
                      ) : (
                        <button
                          onClick={() => generateSprite(slug, state)}
                          style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, border: 'none', background: latest ? '#1f2937' : '#92400e', color: latest ? '#9ca3af' : '#fbbf24', cursor: 'pointer', width: '100%' }}
                        >
                          {latest ? '↺ Regen' : 'Generate'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Add new state */}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <input
                  value={newState[slug] ?? ''}
                  onChange={e => setNewState(prev => ({ ...prev, [slug]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addNewState(slug, newState[slug] ?? '') }}
                  placeholder="New state (e.g. running)"
                  style={{
                    flex: 1, background: '#111827', border: '1px dashed #374151', color: '#d1d5db',
                    borderRadius: 4, padding: '3px 7px', fontSize: 10, outline: 'none',
                  }}
                />
                <button
                  onClick={() => addNewState(slug, newState[slug] ?? '')}
                  disabled={!(newState[slug] ?? '').trim()}
                  style={{
                    background: '#92400e', color: '#fbbf24', border: 'none', borderRadius: 4,
                    padding: '3px 8px', fontSize: 10, cursor: 'pointer', opacity: !(newState[slug] ?? '').trim() ? 0.4 : 1,
                  }}
                >
                  + Add
                </button>
              </div>
            </div>
          )
        })}

        {/* Add new character */}
        <div style={{ borderTop: '1px solid #1f2937', marginTop: 8, paddingTop: 12 }}>
          <button
            onClick={() => setShowAddChar(v => !v)}
            style={{ width: '100%', background: showAddChar ? '#1c1a0a' : '#111827', border: '1px dashed #b45309', color: '#fbbf24', borderRadius: 6, padding: '6px 0', fontSize: 11, cursor: 'pointer' }}
          >
            {showAddChar ? '▲ Cancel' : '+ Add New Character'}
          </button>

          {showAddChar && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                value={newCharName}
                onChange={e => setNewCharName(e.target.value)}
                placeholder="Character name"
                style={{ background: '#111827', border: '1px solid #374151', color: '#d1d5db', borderRadius: 4, padding: '5px 8px', fontSize: 11 }}
              />
              <textarea
                value={newCharDesc}
                onChange={e => setNewCharDesc(e.target.value)}
                placeholder="Describe who they are, what they look like, personality…"
                rows={3}
                style={{ background: '#111827', border: '1px solid #374151', color: '#d1d5db', borderRadius: 4, padding: '5px 8px', fontSize: 11, resize: 'vertical' }}
              />
              <button
                onClick={createCharacter}
                disabled={creatingChar || !newCharName.trim()}
                style={{
                  background: creatingChar ? '#374151' : '#92400e', color: '#fbbf24', border: 'none',
                  borderRadius: 4, padding: '6px 0', fontSize: 11, cursor: (creatingChar || !newCharName.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {creatingChar ? '⏳ Creating…' : 'Create Character + Portrait'}
              </button>
              {createProgress && (
                <div style={{ fontSize: 10, color: '#fbbf24' }}>{createProgress}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
