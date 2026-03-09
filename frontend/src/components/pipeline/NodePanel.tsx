import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type { Page, Character } from '../../types'
import { charSlug } from './PageNode'

const API = 'http://localhost:8000'

export interface StageInfo {
  label: string; script: string; inputLabel: string; outputLabel: string; description: string
}

type SelectedNode =
  | { type: 'pipelineStage'; data: StageInfo }
  | { type: 'page'; data: { page: Page } }

interface Props {
  selected: SelectedNode | null
  onClose: () => void
  pipelineStatus: Record<string, string>
  manifest: Record<string, any>
  completedSprites: Set<string>
  doneBackgrounds: Set<number>
  doneNarrations: Set<number>
  onManifestChange: () => void
  onPageDeleted: (pageNum: number) => void
  onPageUpdated: () => void
  characters: Character[]
}

export default function NodePanel({ selected, onClose, manifest, completedSprites, doneBackgrounds, doneNarrations, onManifestChange, onPageDeleted, onPageUpdated, characters }: Props) {
  const { projectId } = useParams<{ projectId: string }>()

  function assetUrl(path: string) {
    return `${API}/api/projects/${projectId}/assets/${path}`
  }

  function getSpriteEntry(charName: string, state: string) {
    const slug = charSlug(charName)
    return manifest?.characters?.[slug]?.sprites?.[state] ?? null
  }

  function getBackgroundEntry(pageNum: number) {
    return manifest?.pages?.[String(pageNum)]?.background ?? null
  }

  function getNarrationEntry(pageNum: number) {
    return manifest?.pages?.[String(pageNum)]?.narration ?? null
  }

  async function setCurrent(body: object) {
    await fetch(`${API}/api/projects/${projectId}/manifest/set-current`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    onManifestChange()
  }

  if (!selected) {
    return (
      <div style={{ width: 288, background: '#111827', borderLeft: '1px solid #374151', padding: 16, color: '#6b7280', fontSize: 13, flexShrink: 0 }}>
        Click a node to inspect it.
      </div>
    )
  }

  return (
    <div style={{ width: 320, background: '#111827', borderLeft: '1px solid #374151', padding: 16, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>Details</span>
        <button onClick={onClose} style={{ color: '#6b7280', background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      {selected.type === 'pipelineStage' && <StagePanel info={selected.data} />}
      {selected.type === 'page' && (
        <PagePanel
          page={selected.data.page}
          projectId={projectId!}
          characters={characters}
          completedSprites={completedSprites}
          doneBackgrounds={doneBackgrounds}
          doneNarrations={doneNarrations}
          getSpriteEntry={getSpriteEntry}
          getBackgroundEntry={getBackgroundEntry}
          getNarrationEntry={getNarrationEntry}
          assetUrl={assetUrl}
          setCurrent={setCurrent}
          onPageDeleted={onPageDeleted}
          onPageUpdated={onPageUpdated}
          onManifestChange={onManifestChange}
        />
      )}
    </div>
  )
}

function StagePanel({ info }: { info: StageInfo }) {
  return (
    <div>
      <h2 style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 12 }}>{info.label}</h2>
      <Field label="Script" value={info.script} mono />
      <Field label="Input" value={info.inputLabel} />
      <Field label="Output" value={info.outputLabel} />
      <Field label="Description" value={info.description} />
    </div>
  )
}

function VersionPicker({ entry, onSelect }: { entry: any; onSelect: (v: number) => void }) {
  if (!entry || !entry.versions?.length) return null
  const count = entry.versions.length
  if (count <= 1) return <span style={{ fontSize: 10, color: '#4b5563' }}>v1</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
      {entry.versions.map((_: any, i: number) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', border: 'none',
            background: entry.current === i ? '#4338ca' : '#1f2937',
            color: entry.current === i ? 'white' : '#6b7280',
          }}
        >
          v{i + 1}
        </button>
      ))}
    </div>
  )
}

function SectionHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', background: '#1f2937', border: 'none', borderRadius: 4,
        padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: expanded ? 8 : 0,
      }}
    >
      <span style={{ fontSize: 10, color: '#6b7280' }}>{expanded ? '▼' : '▶'}</span>
      <span style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>{title}</span>
    </button>
  )
}

function buildBgPrompt(page: Page, draft: Record<string, string>): string {
  const setting = draft.setting ?? page.setting
  const motion = draft.scene_motion ?? page.scene_motion ?? ''
  const fg = draft.foreground_characters ?? page.foreground_characters?.join(', ') ?? ''
  const bg = draft.background_characters ?? page.background_characters?.join(', ') ?? ''
  let prompt = `Static fixed camera angle — absolutely no camera movement. Scene: ${setting}. `
  if (fg) prompt += `Remove and erase completely: ${fg}. `
  if (bg) prompt += `In the far background: ${bg}. `
  if (motion) prompt += `${motion}. `
  prompt += `Only natural environmental elements animate. No text or captions.`
  return prompt
}

function PagePanel({ page, projectId, characters, completedSprites, doneBackgrounds, doneNarrations, getSpriteEntry, getBackgroundEntry, getNarrationEntry, assetUrl, setCurrent, onPageDeleted, onPageUpdated, onManifestChange }: {
  page: Page
  projectId: string
  characters: Character[]
  completedSprites: Set<string>
  doneBackgrounds: Set<number>
  doneNarrations: Set<number>
  getSpriteEntry: (char: string, state: string) => any
  getBackgroundEntry: (page: number) => any
  getNarrationEntry: (page: number) => any
  assetUrl: (path: string) => string
  setCurrent: (body: object) => void
  onPageDeleted: (pageNum: number) => void
  onPageUpdated: () => void
  onManifestChange: () => void
}) {
  // Page header draft (mood, setting, foreground_characters, background_characters)
  const [headerDraft, setHeaderDraft] = useState<Record<string, string>>({})
  const [headerSaving, setHeaderSaving] = useState(false)

  // Narration text draft
  const [narDraft, setNarDraft] = useState<string | null>(null)
  const [narSaving, setNarSaving] = useState(false)

  // Background scene_motion draft
  const [bgDraft, setBgDraft] = useState<string | null>(null)
  const [bgSaving, setBgSaving] = useState(false)

  // Per-character visual_description drafts: slug → value
  const [charDrafts, setCharDrafts] = useState<Record<string, string>>({})
  const [charSaving, setCharSaving] = useState<Record<string, boolean>>({})

  const [deleting, setDeleting] = useState(false)
  const [refPageInput, setRefPageInput] = useState<string>('')
  const [settingRef, setSettingRef] = useState(false)
  const [runningItems, setRunningItems] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeJobsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  // Section collapse state
  const [charExpanded, setCharExpanded] = useState(true)
  const [bgExpanded, setBgExpanded] = useState(true)
  const [narExpanded, setNarExpanded] = useState(true)

  function startItemJob(jobId: string, key: string, onDone: () => void) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/projects/${projectId}/pipeline/jobs/${jobId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(activeJobsRef.current[key])
          delete activeJobsRef.current[key]
          setRunningItems(prev => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
          onDone()
          onManifestChange()
        }
      } catch {
        // ignore transient fetch errors
      }
    }, 2000)
    activeJobsRef.current[key] = interval
    setRunningItems(prev => new Set(prev).add(key))
  }

  async function regenerateBackground() {
    const key = 'bg'
    if (runningItems.has(key)) return
    const res = await fetch(`${API}/api/projects/${projectId}/pipeline/background/${actualPage}`, { method: 'POST' })
    if (!res.ok) return
    const { job_id } = await res.json()
    startItemJob(job_id, key, () => {})
  }

  async function regenerateNarration() {
    const key = 'nar'
    if (runningItems.has(key)) return
    const res = await fetch(`${API}/api/projects/${projectId}/pipeline/narration/${actualPage}`, { method: 'POST' })
    if (!res.ok) return
    const { job_id } = await res.json()
    startItemJob(job_id, key, () => {})
  }

  async function regenerateSprite(slug: string, state: string) {
    const key = `sprite:${slug}/${state}`
    if (runningItems.has(key)) return
    const res = await fetch(`${API}/api/projects/${projectId}/pipeline/sprite/${slug}/${state}`, { method: 'POST' })
    if (!res.ok) return
    const { job_id } = await res.json()
    startItemJob(job_id, key, () => {})
  }

  function entryUrl(entry: any): string | null {
    if (!entry || entry.current < 0 || !entry.versions?.length) return null
    return assetUrl(entry.versions[entry.current].url)
  }

  const actualPage = page.actual_page ?? page.page
  const bgEntry = getBackgroundEntry(actualPage)
  const narEntry = getNarrationEntry(actualPage)

  // ── Page Header helpers ──────────────────────────────────────────────────
  const hasHeaderDraft = Object.keys(headerDraft).length > 0

  function headerFieldValue(key: string): string {
    if (key in headerDraft) return headerDraft[key]
    if (key === 'foreground_characters') return page.foreground_characters?.join(', ') ?? ''
    if (key === 'background_characters') return page.background_characters?.join(', ') ?? ''
    return (page as any)[key] ?? ''
  }

  function handleHeaderChange(key: string, value: string) {
    setHeaderDraft(prev => ({ ...prev, [key]: value }))
  }

  function discardHeader() {
    setHeaderDraft({})
  }

  async function saveHeader() {
    setHeaderSaving(true)
    try {
      // Convert comma-separated strings back to arrays for array fields
      const fields: Record<string, any> = {}
      for (const [k, v] of Object.entries(headerDraft)) {
        if (k === 'foreground_characters' || k === 'background_characters') {
          fields[k] = v.split(',').map(s => s.trim()).filter(Boolean)
        } else {
          fields[k] = v
        }
      }
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      setHeaderDraft({})
      onPageUpdated()
    } finally {
      setHeaderSaving(false)
    }
  }

  // ── Character visual_description save ──────────────────────────────────
  async function saveCharDesc(slug: string) {
    const val = charDrafts[slug]
    if (val === undefined) return
    setCharSaving(prev => ({ ...prev, [slug]: true }))
    try {
      await fetch(`${API}/api/projects/${projectId}/characters/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { visual_description: val } }),
      })
      setCharDrafts(prev => { const next = { ...prev }; delete next[slug]; return next })
    } finally {
      setCharSaving(prev => ({ ...prev, [slug]: false }))
    }
  }

  function discardCharDesc(slug: string) {
    setCharDrafts(prev => { const next = { ...prev }; delete next[slug]; return next })
  }

  // ── Narration text save ──────────────────────────────────────────────────
  async function saveNarration() {
    if (narDraft === null) return
    setNarSaving(true)
    try {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { text: narDraft } }),
      })
      setNarDraft(null)
      onPageUpdated()
    } finally {
      setNarSaving(false)
    }
  }

  // ── Background scene_motion save ─────────────────────────────────────────
  async function saveBgMotion() {
    if (bgDraft === null) return
    setBgSaving(true)
    try {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { scene_motion: bgDraft } }),
      })
      setBgDraft(null)
      onPageUpdated()
    } finally {
      setBgSaving(false)
    }
  }

  // ── Ref image ────────────────────────────────────────────────────────────
  async function setRefByPage() {
    const n = parseInt(refPageInput, 10)
    if (isNaN(n)) return
    setSettingRef(true)
    try {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}/ref`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref_page: n }),
      })
      onPageUpdated()
    } finally {
      setSettingRef(false)
      setRefPageInput('')
    }
  }

  async function uploadRefImage(file: File) {
    setSettingRef(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}/ref-image`, {
        method: 'POST',
        body: fd,
      })
      onPageUpdated()
    } finally {
      setSettingRef(false)
    }
  }

  async function deletePage() {
    if (!confirm(`Delete page ${page.page}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, { method: 'DELETE' })
      onPageDeleted(page.page)
    } finally {
      setDeleting(false)
    }
  }

  // Build a combined draft for bg prompt preview (header draft feeds in too)
  const bgPromptDraft: Record<string, string> = {}
  if ('setting' in headerDraft) bgPromptDraft.setting = headerDraft.setting
  if ('foreground_characters' in headerDraft) bgPromptDraft.foreground_characters = headerDraft.foreground_characters
  if ('background_characters' in headerDraft) bgPromptDraft.background_characters = headerDraft.background_characters
  if (bgDraft !== null) bgPromptDraft.scene_motion = bgDraft

  return (
    <div>
      {/* ── Page title ── */}
      <h2 style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 12 }}>
        Page {page.page}
        {page.actual_page !== undefined && page.actual_page !== page.page && (
          <span style={{ color: '#6b7280', fontWeight: 'normal', fontSize: 11 }}> (PDF p.{page.actual_page})</span>
        )}
        {' '}— {page.mood}
      </h2>

      {/* ─────────────────────────────────────────────────────────────────────
          PAGE HEADER SECTION
      ───────────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        {hasHeaderDraft && (
          <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 'bold', marginBottom: 4 }}>unsaved changes</div>
        )}
        {(
          [
            { key: 'mood', label: 'Mood' },
            { key: 'setting', label: 'Setting' },
            { key: 'foreground_characters', label: 'Foreground Characters' },
            { key: 'background_characters', label: 'Background Characters' },
          ] as Array<{ key: string; label: string }>
        ).map(({ key, label }) => (
          <div key={key} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{label}</div>
            <input
              type="text"
              value={headerFieldValue(key)}
              onChange={e => handleHeaderChange(key, e.target.value)}
              style={{
                width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box',
                outline: key in headerDraft ? '1px solid #f59e0b' : 'none',
              }}
            />
          </div>
        ))}
        {hasHeaderDraft && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              onClick={saveHeader}
              disabled={headerSaving}
              style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: headerSaving ? 'not-allowed' : 'pointer', opacity: headerSaving ? 0.7 : 1 }}
            >
              {headerSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={discardHeader}
              disabled={headerSaving}
              style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}
            >
              Discard
            </button>
          </div>
        )}
      </div>

      <div style={{ height: 1, background: '#374151', marginBottom: 16 }} />

      {/* ─────────────────────────────────────────────────────────────────────
          SECTION: CHARACTERS
      ───────────────────────────────────────────────────────────────────── */}
      <SectionHeader title="Characters" expanded={charExpanded} onToggle={() => setCharExpanded(e => !e)} />
      {charExpanded && (
        <div style={{ marginBottom: 16 }}>
          {page.character_states.length === 0 && (
            <div style={{ fontSize: 11, color: '#4b5563' }}>No characters on this page.</div>
          )}
          {page.character_states.map(cs => {
            const slug = charSlug(cs.character)
            const itemKey = `sprite:${slug}/${cs.state}`
            const done = completedSprites.has(`${slug}/${cs.state}`)
            const entry = done ? getSpriteEntry(cs.character, cs.state) : null
            const spriteUrl = entryUrl(entry)
            const isRunning = runningItems.has(itemKey)
            const charData = characters.find(c => charSlug(c.name) === slug)
            const currentVisDesc = charDrafts[slug] !== undefined ? charDrafts[slug] : (charData?.visual_description ?? '')
            const hasCharDraft = slug in charDrafts

            return (
              <div key={`${cs.character}/${cs.state}`} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #1f2937' }}>
                {/* Name + state badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#e5e7eb', fontWeight: 'bold' }}>{cs.character}</span>
                  <span style={{
                    fontSize: 10, background: '#374151', color: '#9ca3af', borderRadius: 10,
                    padding: '1px 7px', textTransform: 'capitalize',
                  }}>{cs.state}</span>
                </div>

                {/* Ref image + sprite preview row */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-end' }}>
                  {/* Ref image */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2 }}>Ref</div>
                    <img
                      src={assetUrl(`refs/${slug}_ref.png`)}
                      alt="ref"
                      style={{ height: 60, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4, display: 'block' }}
                      onError={e => {
                        const img = e.target as HTMLImageElement
                        img.style.display = 'none'
                        const placeholder = img.nextElementSibling as HTMLElement | null
                        if (placeholder) placeholder.style.display = 'flex'
                      }}
                    />
                    <div style={{ height: 60, width: 44, background: '#1f2937', borderRadius: 4, display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4b5563' }}>No ref</div>
                  </div>

                  {/* Sprite */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2 }}>Sprite</div>
                    {spriteUrl
                      ? <img src={spriteUrl} alt={cs.state} style={{ height: 60, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4, display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.15' }} />
                      : <div style={{ height: 60, width: 44, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4b5563' }}>Pending</div>
                    }
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, justifyContent: 'center' }}>
                      <VersionPicker
                        entry={entry}
                        onSelect={v => setCurrent({ type: 'sprite', char: slug, state: cs.state, version: v })}
                      />
                      <button
                        onClick={() => regenerateSprite(slug, cs.state)}
                        disabled={isRunning}
                        style={{
                          background: isRunning ? '#92400e' : '#374151',
                          color: isRunning ? '#fde68a' : '#d1d5db',
                          border: 'none', borderRadius: 4, padding: '1px 5px', fontSize: 10,
                          cursor: isRunning ? 'not-allowed' : 'pointer', lineHeight: 1.4,
                        }}
                      >
                        {isRunning ? '...' : '↻'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Visual description */}
                <div style={{ marginBottom: 2 }}>
                  <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Visual Description</div>
                  <textarea
                    value={currentVisDesc}
                    onChange={e => setCharDrafts(prev => ({ ...prev, [slug]: e.target.value }))}
                    rows={3}
                    style={{
                      width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                      color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'vertical', boxSizing: 'border-box',
                      outline: hasCharDraft ? '1px solid #f59e0b' : 'none',
                    }}
                  />
                </div>
                {hasCharDraft && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      onClick={() => saveCharDesc(slug)}
                      disabled={!!charSaving[slug]}
                      style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: charSaving[slug] ? 'not-allowed' : 'pointer', opacity: charSaving[slug] ? 0.7 : 1 }}
                    >
                      {charSaving[slug] ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => discardCharDesc(slug)}
                      disabled={!!charSaving[slug]}
                      style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ height: 1, background: '#374151', marginBottom: 16 }} />

      {/* ─────────────────────────────────────────────────────────────────────
          SECTION: BACKGROUND
      ───────────────────────────────────────────────────────────────────── */}
      <SectionHeader title="Background" expanded={bgExpanded} onToggle={() => setBgExpanded(e => !e)} />
      {bgExpanded && (
        <div style={{ marginBottom: 16 }}>
          {/* scene_motion editable */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Scene Motion</div>
            <input
              type="text"
              value={bgDraft !== null ? bgDraft : (page.scene_motion ?? '')}
              onChange={e => setBgDraft(e.target.value)}
              style={{
                width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box',
                outline: bgDraft !== null ? '1px solid #f59e0b' : 'none',
              }}
            />
            {bgDraft !== null && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  onClick={saveBgMotion}
                  disabled={bgSaving}
                  style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: bgSaving ? 'not-allowed' : 'pointer', opacity: bgSaving ? 0.7 : 1 }}
                >
                  {bgSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setBgDraft(null)}
                  disabled={bgSaving}
                  style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}
                >
                  Discard
                </button>
              </div>
            )}
          </div>

          {/* Prompt preview */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Prompt Preview</div>
            <textarea
              readOnly
              rows={4}
              value={buildBgPrompt(page, bgPromptDraft)}
              style={{
                width: '100%', background: '#0f172a', border: '1px solid #374151', borderRadius: 4,
                color: '#6b7280', fontSize: 10, padding: '4px 6px', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Reference section */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Reference Image</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
              {page.ref_source === 'custom'
                ? 'Custom image'
                : `PDF page ${page.ref_page ?? page.actual_page ?? page.page}`
              }
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input
                type="number"
                min={1}
                value={refPageInput}
                onChange={e => setRefPageInput(e.target.value)}
                placeholder="PDF page #"
                style={{
                  flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                  color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box',
                }}
              />
              <button
                onClick={setRefByPage}
                disabled={settingRef || !refPageInput}
                style={{ background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: settingRef ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
              >
                Set
              </button>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) uploadRefImage(e.target.files[0]) }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={settingRef}
                style={{ width: '100%', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: settingRef ? 'not-allowed' : 'pointer' }}
              >
                Upload Custom Ref Image
              </button>
            </div>
          </div>

          {/* Background video player */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Video</span>
                <button
                  onClick={regenerateBackground}
                  disabled={runningItems.has('bg')}
                  style={{
                    background: runningItems.has('bg') ? '#92400e' : '#374151',
                    color: runningItems.has('bg') ? '#fde68a' : '#d1d5db',
                    border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: 10,
                    cursor: runningItems.has('bg') ? 'not-allowed' : 'pointer', lineHeight: 1.4,
                  }}
                >
                  {runningItems.has('bg') ? '...' : '↻'}
                </button>
              </div>
              <VersionPicker
                entry={bgEntry}
                onSelect={v => setCurrent({ type: 'background', page: actualPage, version: v })}
              />
            </div>
            {doneBackgrounds.has(page.page) && entryUrl(bgEntry)
              ? <video key={entryUrl(bgEntry)!} src={entryUrl(bgEntry)!} style={{ width: '100%', borderRadius: 4, background: 'black' }} controls muted preload="metadata" />
              : <Pending />
            }
          </div>
        </div>
      )}

      <div style={{ height: 1, background: '#374151', marginBottom: 16 }} />

      {/* ─────────────────────────────────────────────────────────────────────
          SECTION: NARRATION
      ───────────────────────────────────────────────────────────────────── */}
      <SectionHeader title="Narration" expanded={narExpanded} onToggle={() => setNarExpanded(e => !e)} />
      {narExpanded && (
        <div style={{ marginBottom: 16 }}>
          {/* Narration text editable */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Text</div>
            <textarea
              value={narDraft !== null ? narDraft : page.text}
              onChange={e => setNarDraft(e.target.value)}
              rows={4}
              style={{
                width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'vertical', boxSizing: 'border-box',
                outline: narDraft !== null ? '1px solid #f59e0b' : 'none',
              }}
            />
            {narDraft !== null && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  onClick={saveNarration}
                  disabled={narSaving}
                  style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: narSaving ? 'not-allowed' : 'pointer', opacity: narSaving ? 0.7 : 1 }}
                >
                  {narSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setNarDraft(null)}
                  disabled={narSaving}
                  style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}
                >
                  Discard
                </button>
              </div>
            )}
          </div>

          {/* Audio player */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Audio</span>
                <button
                  onClick={regenerateNarration}
                  disabled={runningItems.has('nar')}
                  style={{
                    background: runningItems.has('nar') ? '#92400e' : '#374151',
                    color: runningItems.has('nar') ? '#fde68a' : '#d1d5db',
                    border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: 10,
                    cursor: runningItems.has('nar') ? 'not-allowed' : 'pointer', lineHeight: 1.4,
                  }}
                >
                  {runningItems.has('nar') ? '...' : '↻'}
                </button>
              </div>
              <VersionPicker
                entry={narEntry}
                onSelect={v => setCurrent({ type: 'narration', page: actualPage, version: v })}
              />
            </div>
            {doneNarrations.has(page.page) && entryUrl(narEntry)
              ? <audio key={entryUrl(narEntry)!} src={entryUrl(narEntry)!} controls style={{ width: '100%' }} />
              : <Pending />
            }
          </div>
        </div>
      )}

      {/* ── Delete Page ── */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #374151' }}>
        <button
          onClick={deletePage}
          disabled={deleting}
          style={{
            width: '100%', background: '#7f1d1d', color: '#fca5a5', border: '1px solid #991b1b',
            borderRadius: 4, padding: '6px 0', fontSize: 12, cursor: deleting ? 'not-allowed' : 'pointer',
            opacity: deleting ? 0.7 : 1,
          }}
        >
          {deleting ? 'Deleting...' : 'Delete Page'}
        </button>
      </div>
    </div>
  )
}

function Pending() {
  return <div style={{ height: 36, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#4b5563' }}>Not generated yet</div>
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{children}</div>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#d1d5db', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
