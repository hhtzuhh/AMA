import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { StoryData, Character, Page } from '../types'

const API = 'http://localhost:8000'

// ---- helpers ----------------------------------------------------------------

const MOOD_COLORS: Record<string, string> = {
  happy: '#16a34a',
  sad: '#2563eb',
  angry: '#dc2626',
  scary: '#7c3aed',
  wonder: '#0891b2',
  tense: '#d97706',
  calm: '#059669',
  playful: '#db2777',
}

function moodBadge(mood: string) {
  const bg = MOOD_COLORS[mood?.toLowerCase()] ?? '#374151'
  return (
    <span style={{
      background: bg, color: '#fff', borderRadius: 4,
      padding: '1px 8px', fontSize: 11, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      flexShrink: 0,
    }}>
      {mood || '—'}
    </span>
  )
}

// ---- Characters section -----------------------------------------------------

interface CharsSectionProps {
  story: StoryData
  onSaveStory: (updated: StoryData) => Promise<void>
  saving: boolean
}

function CharactersSection({ story, onSaveStory, saving }: CharsSectionProps) {
  // checked states per character: { [charIndex]: Set<state> }
  const [checkedStates, setCheckedStates] = useState<Record<number, Set<string>>>(() => {
    const init: Record<number, Set<string>> = {}
    story.characters.forEach((c, i) => {
      init[i] = new Set(c.sprite_states)
    })
    return init
  })

  function toggleState(charIdx: number, state: string) {
    setCheckedStates(prev => {
      const next = new Set(prev[charIdx])
      if (next.has(state)) next.delete(state)
      else next.add(state)
      return { ...prev, [charIdx]: next }
    })
  }

  async function handleSave() {
    const updatedChars = story.characters.map((c, i) => ({
      ...c,
      sprite_states: c.sprite_states.filter(s => checkedStates[i]?.has(s)),
    }))
    await onSaveStory({ ...story, characters: updatedChars })
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f9fafb' }}>Characters</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            marginLeft: 'auto',
            background: saving ? '#374151' : '#4338ca',
            color: '#fff', border: 'none', borderRadius: 6,
            padding: '5px 16px', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {story.characters.map((char, ci) => (
          <div key={char.name} style={{
            background: '#1f2937', border: '1px solid #374151',
            borderRadius: 8, padding: '12px 16px',
          }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <div style={{ fontWeight: 700, color: '#e5e7eb', minWidth: 120 }}>{char.name}</div>
              <div style={{ color: '#9ca3af', fontSize: 13 }}>{char.visual_description}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {char.sprite_states.map(state => {
                const checked = checkedStates[ci]?.has(state) ?? true
                return (
                  <label key={state} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    color: checked ? '#d1d5db' : '#6b7280', fontSize: 13,
                    cursor: 'pointer', userSelect: 'none',
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleState(ci, state)}
                      style={{ accentColor: '#6366f1' }}
                    />
                    {state}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- Pages section ----------------------------------------------------------

interface PagesMeta {
  [pageNum: string]: {
    enabled?: boolean
    order?: number
  }
}

interface PagesSectionProps {
  story: StoryData
  manifest: PagesMeta
  onSaveStory: (updated: StoryData) => Promise<void>
  onToggle: (pageNum: number) => Promise<void>
  onSaveOrder: (order: number[]) => Promise<void>
  saving: boolean
}

function PagesSection({ story, manifest, onSaveStory, onToggle, onSaveOrder, saving }: PagesSectionProps) {
  // Local ordered list of page numbers
  const [orderedNums, setOrderedNums] = useState<number[]>(() =>
    [...story.pages]
      .sort((a, b) => {
        const ao = manifest[String(a.page)]?.order ?? a.page
        const bo = manifest[String(b.page)]?.order ?? b.page
        return ao - bo
      })
      .map(p => p.page)
  )

  // Expanded page
  const [expandedPage, setExpandedPage] = useState<number | null>(null)
  // Per-page draft edits
  const [drafts, setDrafts] = useState<Record<number, Partial<Page>>>({})

  const pagesByNum = Object.fromEntries(story.pages.map(p => [p.page, p]))

  function moveUp(idx: number) {
    if (idx === 0) return
    setOrderedNums(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  function moveDown(idx: number) {
    if (idx === orderedNums.length - 1) return
    setOrderedNums(prev => {
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  function updateDraft(pageNum: number, field: keyof Page, value: string) {
    setDrafts(prev => ({
      ...prev,
      [pageNum]: { ...prev[pageNum], [field]: value },
    }))
  }

  async function handleSaveEdits(pageNum: number) {
    const draft = drafts[pageNum]
    if (!draft) return
    const updatedPages = story.pages.map(p =>
      p.page === pageNum ? { ...p, ...draft } : p
    )
    await onSaveStory({ ...story, pages: updatedPages })
    setDrafts(prev => {
      const next = { ...prev }
      delete next[pageNum]
      return next
    })
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f9fafb' }}>Pages</h2>
        <button
          onClick={() => onSaveOrder(orderedNums)}
          disabled={saving}
          style={{
            marginLeft: 'auto',
            background: saving ? '#374151' : '#4338ca',
            color: '#fff', border: 'none', borderRadius: 6,
            padding: '5px 16px', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Order'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {orderedNums.map((pageNum, idx) => {
          const page = pagesByNum[pageNum]
          if (!page) return null
          const enabled = manifest[String(pageNum)]?.enabled ?? true
          const isExpanded = expandedPage === pageNum
          const draft = drafts[pageNum] ?? {}
          const hasDraft = Object.keys(draft).length > 0

          return (
            <div key={pageNum} style={{
              background: '#1f2937',
              border: `1px solid ${isExpanded ? '#6366f1' : '#374151'}`,
              borderRadius: 8, overflow: 'hidden',
              opacity: enabled ? 1 : 0.5,
            }}>
              {/* Row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', cursor: 'pointer',
              }}>
                {/* Enable toggle */}
                <label
                  title={enabled ? 'Click to disable' : 'Click to enable'}
                  style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}
                  onClick={e => { e.stopPropagation(); onToggle(pageNum) }}
                >
                  <span style={{
                    display: 'inline-block', width: 32, height: 18, borderRadius: 9,
                    background: enabled ? '#4338ca' : '#374151',
                    position: 'relative', transition: 'background 0.15s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2,
                      left: enabled ? 15 : 2,
                      width: 14, height: 14, borderRadius: '50%',
                      background: '#fff', transition: 'left 0.15s',
                    }} />
                  </span>
                </label>

                {/* Page number */}
                <span style={{ color: '#9ca3af', fontSize: 12, fontFamily: 'monospace', minWidth: 40 }}>
                  p.{pageNum}
                </span>

                {/* Mood badge */}
                {moodBadge(page.mood)}

                {/* Summary */}
                <span
                  style={{ color: '#d1d5db', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => setExpandedPage(isExpanded ? null : pageNum)}
                >
                  {page.summary || page.text?.slice(0, 100)}
                </span>

                {/* Reorder buttons */}
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={e => { e.stopPropagation(); moveUp(idx) }}
                    disabled={idx === 0}
                    style={{
                      background: 'transparent', border: '1px solid #374151',
                      color: idx === 0 ? '#4b5563' : '#9ca3af',
                      borderRadius: 4, padding: '2px 6px', cursor: idx === 0 ? 'default' : 'pointer',
                      fontSize: 12,
                    }}
                  >▲</button>
                  <button
                    onClick={e => { e.stopPropagation(); moveDown(idx) }}
                    disabled={idx === orderedNums.length - 1}
                    style={{
                      background: 'transparent', border: '1px solid #374151',
                      color: idx === orderedNums.length - 1 ? '#4b5563' : '#9ca3af',
                      borderRadius: 4, padding: '2px 6px',
                      cursor: idx === orderedNums.length - 1 ? 'default' : 'pointer',
                      fontSize: 12,
                    }}
                  >▼</button>
                </div>

                {/* Expand toggle */}
                <span
                  style={{ color: '#6b7280', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => setExpandedPage(isExpanded ? null : pageNum)}
                >
                  {isExpanded ? '▲' : '▼'}
                </span>
              </div>

              {/* Expanded edit panel */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #374151', padding: '12px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Text" value={draft.text ?? page.text}
                      onChange={v => updateDraft(pageNum, 'text', v)} multiline />
                    <Field label="Summary" value={draft.summary ?? page.summary}
                      onChange={v => updateDraft(pageNum, 'summary', v)} multiline />
                    <Field label="Setting" value={draft.setting ?? page.setting}
                      onChange={v => updateDraft(pageNum, 'setting', v)} />
                    <Field label="Mood" value={draft.mood ?? page.mood}
                      onChange={v => updateDraft(pageNum, 'mood', v)} />
                    <Field label="Scene Motion" value={draft.scene_motion ?? page.scene_motion}
                      onChange={v => updateDraft(pageNum, 'scene_motion', v)} multiline />
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleSaveEdits(pageNum)}
                      disabled={!hasDraft || saving}
                      style={{
                        background: hasDraft && !saving ? '#4338ca' : '#374151',
                        color: '#fff', border: 'none', borderRadius: 6,
                        padding: '5px 16px', fontSize: 13,
                        cursor: hasDraft && !saving ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {saving ? 'Saving…' : 'Save Edits'}
                    </button>
                    <button
                      onClick={() => {
                        setDrafts(prev => { const n = { ...prev }; delete n[pageNum]; return n })
                      }}
                      style={{
                        background: 'transparent', color: '#9ca3af',
                        border: '1px solid #374151', borderRadius: 6,
                        padding: '5px 16px', fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---- tiny Field component ---------------------------------------------------

function Field({
  label, value, onChange, multiline = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
}) {
  return (
    <div>
      <label style={{ display: 'block', color: '#9ca3af', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#111827', color: '#e5e7eb',
            border: '1px solid #374151', borderRadius: 6,
            padding: '6px 10px', fontSize: 13, resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#111827', color: '#e5e7eb',
            border: '1px solid #374151', borderRadius: 6,
            padding: '6px 10px', fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      )}
    </div>
  )
}

// ---- Main page --------------------------------------------------------------

export default function StoryEditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [story, setStory] = useState<StoryData | null>(null)
  const [manifest, setManifest] = useState<PagesMeta>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const [storyRes, manifestRes] = await Promise.all([
        fetch(`${API}/api/projects/${projectId}/story`),
        fetch(`${API}/api/projects/${projectId}/manifest`),
      ])
      if (!storyRes.ok) throw new Error('story_data.json not found — run Story Understanding first')
      const storyData: StoryData = await storyRes.json()
      const manifestData = manifestRes.ok ? await manifestRes.json() : {}
      setStory(storyData)
      setManifest(manifestData.pages ?? {})
    } catch (e: any) {
      setError(e.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleSaveStory(updated: StoryData) {
    if (!projectId) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/story`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail ?? 'Save failed')
      }
      setStory(updated)
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(pageNum: number) {
    if (!projectId) return
    const res = await fetch(`${API}/api/projects/${projectId}/pages/${pageNum}/toggle`, { method: 'POST' })
    if (res.ok) {
      const { enabled } = await res.json()
      setManifest(prev => ({
        ...prev,
        [String(pageNum)]: { ...prev[String(pageNum)], enabled },
      }))
    }
  }

  async function handleSaveOrder(order: number[]) {
    if (!projectId) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/pages/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      })
      if (!res.ok) throw new Error('Reorder failed')
      // Update local manifest order
      setManifest(prev => {
        const next = { ...prev }
        order.forEach((pageNum, idx) => {
          next[String(pageNum)] = { ...next[String(pageNum)], order: idx }
        })
        return next
      })
      setSaveMsg('Order saved!')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, color: '#9ca3af', textAlign: 'center' }}>
        Loading story data…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 40, color: '#ef4444', textAlign: 'center' }}>
        {error}
      </div>
    )
  }

  if (!story) return null

  return (
    <div style={{
      minHeight: 'calc(100vh - 41px)',
      background: '#111827',
      color: '#f9fafb',
      padding: '24px 32px',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          Story Editor
        </h1>
        <span style={{ color: '#6b7280', fontSize: 14 }}>
          {story.title}
        </span>
        {saveMsg && (
          <span style={{
            marginLeft: 'auto', fontSize: 13,
            color: saveMsg.startsWith('Error') ? '#ef4444' : '#34d399',
          }}>
            {saveMsg}
          </span>
        )}
      </div>

      <CharactersSection
        story={story}
        onSaveStory={handleSaveStory}
        saving={saving}
      />

      <PagesSection
        story={story}
        manifest={manifest}
        onSaveStory={handleSaveStory}
        onToggle={handleToggle}
        onSaveOrder={handleSaveOrder}
        saving={saving}
      />
    </div>
  )
}
