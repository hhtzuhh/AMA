import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type { Page, Character } from '../../types'
import { charSlug } from './PageNode'
import { AssetLibraryPicker } from './AssetLibraryPicker'

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

const SECTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Characters: { bg: '#1e1b2e', text: '#a78bfa', border: '#4c1d95' },
  Background: { bg: '#0e1e2a', text: '#67e8f9', border: '#164e63' },
  Narration:  { bg: '#1c1a10', text: '#fcd34d', border: '#78350f' },
}

function SectionHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
  const colors = SECTION_COLORS[title] ?? { bg: '#1f2937', text: '#9ca3af', border: '#374151' }
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', background: colors.bg,
        border: `1px solid ${colors.border}`, borderRadius: 4,
        padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: expanded ? 8 : 0,
      }}
    >
      <span style={{ fontSize: 10, color: colors.text }}>{expanded ? '▼' : '▶'}</span>
      <span style={{ fontSize: 10, color: colors.text, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>{title}</span>
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
  const [headerDraft, setHeaderDraft] = useState<Record<string, string>>({})
  const [headerSaving, setHeaderSaving] = useState(false)
  const [narDraft, setNarDraft] = useState<string | null>(null)
  const [narSaving, setNarSaving] = useState(false)
  const [bgDraft, setBgDraft] = useState<string | null>(null)
  const [bgSaving, setBgSaving] = useState(false)
  const [charDrafts, setCharDrafts] = useState<Record<string, string>>({})
  const [charSaving, setCharSaving] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState(false)
  const [refPageInput, setRefPageInput] = useState<string>('')
  const [settingRef, setSettingRef] = useState(false)
  const [runningItems, setRunningItems] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeJobsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  // Character ref upload
  const charRefInputRef = useRef<HTMLInputElement>(null)
  const charRefTargetSlug = useRef<string>('')
  const [charRefUploading, setCharRefUploading] = useState<Record<string, boolean>>({})
  const [refBusters, setRefBusters] = useState<Record<string, number>>({})

  // Asset library picker
  type LibraryTarget =
    | { type: 'charRef'; slug: string; charName: string }
    | { type: 'bgRef'; pageNum: number }
    | { type: 'addCharRef' }
    | null
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget>(null)

  // Add character to page form
  const [showAddChar, setShowAddChar] = useState(false)
  const [addCharForm, setAddCharForm] = useState({ name: '', visDesc: '', state: '' })
  const [addCharRefUrl, setAddCharRefUrl] = useState('')
  const [addingChar, setAddingChar] = useState(false)
  const [addCharError, setAddCharError] = useState('')

  // Per-character sprite state draft for this page (slug → edited state)
  const [charStateDraft, setCharStateDraft] = useState<Record<string, string>>({})

  // Section collapse
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

  async function handleCharRefFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const slug = charRefTargetSlug.current
    if (!slug) return
    setCharRefUploading(prev => ({ ...prev, [slug]: true }))
    const fd = new FormData()
    fd.append('file', file)
    await fetch(`${API}/api/projects/${projectId}/characters/${slug}/ref-image`, { method: 'POST', body: fd })
    setCharRefUploading(prev => ({ ...prev, [slug]: false }))
    setRefBusters(prev => ({ ...prev, [slug]: (prev[slug] ?? 0) + 1 }))
    onManifestChange()
  }

  async function assignCharRef(slug: string, url: string) {
    await fetch(`${API}/api/projects/${projectId}/characters/${slug}/ref`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    setRefBusters(prev => ({ ...prev, [slug]: (prev[slug] ?? 0) + 1 }))
    onManifestChange()
  }

  async function assignBgRef(pageNum: number, url: string) {
    await fetch(`${API}/api/projects/${projectId}/pages/${pageNum}/ref`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref_image: url }),
    })
    onPageUpdated()
  }

  async function updateCharStateOnPage(slug: string, newState: string) {
    const state = newState.trim().toLowerCase().replace(/\s+/g, '_')
    if (!state) return
    const updated = page.character_states.map(cs =>
      charSlug(cs.character) === slug ? { ...cs, state } : cs
    )
    await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { character_states: updated } }),
    })
    const charData = characters.find(c => charSlug(c.name) === slug)
    if (charData && !charData.sprite_states.includes(state)) {
      await fetch(`${API}/api/projects/${projectId}/characters/${slug}/sprite-states`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      })
    }
    setCharStateDraft(prev => { const n = { ...prev }; delete n[slug]; return n })
    onPageUpdated()
  }

  async function removeCharFromPage(slug: string) {
    const updated = page.character_states.filter(cs => charSlug(cs.character) !== slug)
    await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { character_states: updated } }),
    })
    onPageUpdated()
  }

  async function addCharToPage() {
    const name = addCharForm.name.trim()
    const state = addCharForm.state.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name || !state) return
    setAddingChar(true)
    setAddCharError('')
    try {
      const slug = name.toLowerCase().replace(/\s+/g, '_')
      const charExists = characters.some(c => charSlug(c.name) === slug)
      if (!charExists) {
        const res = await fetch(`${API}/api/projects/${projectId}/characters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, visual_description: addCharForm.visDesc.trim(), sprite_states: [state] }),
        })
        if (!res.ok) {
          const err = await res.json()
          setAddCharError(err.detail ?? 'Failed to create character')
          return
        }
        if (addCharRefUrl) {
          await fetch(`${API}/api/projects/${projectId}/characters/${slug}/ref`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: addCharRefUrl }),
          })
          setRefBusters(prev => ({ ...prev, [slug]: (prev[slug] ?? 0) + 1 }))
        }
      } else {
        const charData = characters.find(c => charSlug(c.name) === slug)
        if (charData && !charData.sprite_states.includes(state)) {
          await fetch(`${API}/api/projects/${projectId}/characters/${slug}/sprite-states`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
          })
        }
      }
      const alreadyOnPage = page.character_states.some(cs => charSlug(cs.character) === slug)
      if (!alreadyOnPage) {
        const updated = [...page.character_states, { character: name, state }]
        await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { character_states: updated } }),
        })
      }
      setAddCharForm({ name: '', visDesc: '', state: '' })
      setAddCharRefUrl('')
      setShowAddChar(false)
      onPageUpdated()
    } finally {
      setAddingChar(false)
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

  // All bg inputs combined for prompt preview
  const bgPromptDraft: Record<string, string> = {}
  if ('setting' in headerDraft) bgPromptDraft.setting = headerDraft.setting
  if ('foreground_characters' in headerDraft) bgPromptDraft.foreground_characters = headerDraft.foreground_characters
  if ('background_characters' in headerDraft) bgPromptDraft.background_characters = headerDraft.background_characters
  if (bgDraft !== null) bgPromptDraft.scene_motion = bgDraft

  return (
    <div>
      {/* Hidden file input for character ref upload */}
      <input
        ref={charRefInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleCharRefFile}
      />
      {/* ── Page title ── */}
      <h2 style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 16 }}>
        Page {page.page}
        {page.actual_page !== undefined && page.actual_page !== page.page && (
          <span style={{ color: '#6b7280', fontWeight: 'normal', fontSize: 11 }}> (PDF p.{page.actual_page})</span>
        )}
      </h2>

      {/* ─────────────────────────────────────────────────────────────────────
          SECTION: CHARACTERS
      ───────────────────────────────────────────────────────────────────── */}
      <SectionHeader title="Characters" expanded={charExpanded} onToggle={() => setCharExpanded(e => !e)} />
      {charExpanded && (
        <div style={{ marginBottom: 16 }}>
          {page.character_states.length === 0 && !showAddChar && (
            <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 10 }}>No characters on this page yet.</div>
          )}

          {page.character_states.map(cs => {
            const slug = charSlug(cs.character)
            const charData = characters.find(c => charSlug(c.name) === slug)
            const allStates = charData?.sprite_states ?? []
            const stateDraft = charStateDraft[slug]
            const activeState = stateDraft !== undefined ? stateDraft : cs.state
            const itemKey = `sprite:${slug}/${activeState}`
            const done = completedSprites.has(`${slug}/${activeState}`)
            const entry = done ? getSpriteEntry(cs.character, activeState) : null
            const spriteUrl = entryUrl(entry)
            const isRunning = runningItems.has(itemKey)
            const currentVisDesc = charDrafts[slug] !== undefined ? charDrafts[slug] : (charData?.visual_description ?? '')
            const hasCharDraft = slug in charDrafts

            return (
              <div key={slug} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1f2937' }}>
                {/* Name + role + remove */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 12, color: '#e5e7eb', fontWeight: 'bold' }}>{cs.character}</span>
                    {charData?.role && <span style={{ marginLeft: 6, fontSize: 10, color: '#6b7280' }}>{charData.role}</span>}
                  </div>
                  <button onClick={() => removeCharFromPage(slug)} title="Remove from page"
                    style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>

                {/* Ref image + upload/library */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>Reference Image</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <img
                        src={`${assetUrl(`refs/${slug}_ref.png`)}?v=${refBusters[slug] ?? 0}`}
                        alt="ref"
                        style={{ height: 52, width: 52, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4, display: 'block' }}
                        onError={e => {
                          const img = e.target as HTMLImageElement
                          img.style.display = 'none'
                          const ph = img.nextElementSibling as HTMLElement | null
                          if (ph) ph.style.display = 'flex'
                        }}
                      />
                      <div style={{ height: 52, width: 52, background: '#1f2937', borderRadius: 4, display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#4b5563' }}>No ref</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button
                        onClick={() => { charRefTargetSlug.current = slug; charRefInputRef.current?.click() }}
                        disabled={charRefUploading[slug]}
                        style={{ background: '#1f2937', border: '1px solid #374151', color: charRefUploading[slug] ? '#6b7280' : '#9ca3af', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: charRefUploading[slug] ? 'not-allowed' : 'pointer' }}
                      >
                        {charRefUploading[slug] ? '...' : '↑ Upload Ref'}
                      </button>
                      <button
                        onClick={() => setLibraryTarget({ type: 'charRef', slug, charName: cs.character })}
                        style={{ background: '#1f2937', border: '1px solid #374151', color: '#9ca3af', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
                      >
                        📚 From Library
                      </button>
                    </div>
                  </div>
                </div>

                {/* Visual description */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Visual Description</div>
                  <textarea
                    value={currentVisDesc}
                    onChange={e => setCharDrafts(prev => ({ ...prev, [slug]: e.target.value }))}
                    rows={3}
                    style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'vertical', boxSizing: 'border-box', outline: hasCharDraft ? '1px solid #f59e0b' : 'none' }}
                  />
                </div>
                {hasCharDraft && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <button onClick={() => saveCharDesc(slug)} disabled={!!charSaving[slug]}
                      style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: charSaving[slug] ? 'not-allowed' : 'pointer', opacity: charSaving[slug] ? 0.7 : 1 }}>
                      {charSaving[slug] ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => discardCharDesc(slug)} disabled={!!charSaving[slug]}
                      style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
                      Discard
                    </button>
                  </div>
                )}

                {/* Sprite state for THIS page */}
                <div style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Sprite State (this page)</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        list={`states-${slug}`}
                        value={activeState}
                        onChange={e => setCharStateDraft(prev => ({ ...prev, [slug]: e.target.value }))}
                        style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '3px 6px', boxSizing: 'border-box', outline: stateDraft !== undefined ? '1px solid #f59e0b' : 'none' }}
                      />
                      <datalist id={`states-${slug}`}>
                        {allStates.map(s => <option key={s} value={s} />)}
                      </datalist>
                    </div>
                    {spriteUrl
                      ? <img src={spriteUrl} alt={activeState} style={{ height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.1' }} />
                      : <div style={{ height: 36, width: 28, background: '#1f2937', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#4b5563', flexShrink: 0 }}>–</div>
                    }
                    <VersionPicker entry={entry} onSelect={v => setCurrent({ type: 'sprite', char: slug, state: activeState, version: v })} />
                    <button
                      onClick={() => regenerateSprite(slug, activeState)}
                      disabled={isRunning}
                      style={{ background: isRunning ? '#92400e' : '#374151', color: isRunning ? '#fde68a' : '#d1d5db', border: 'none', borderRadius: 4, padding: '1px 5px', fontSize: 10, cursor: isRunning ? 'not-allowed' : 'pointer', lineHeight: 1.4, flexShrink: 0 }}
                    >
                      {isRunning ? '...' : '↻'}
                    </button>
                  </div>
                  {stateDraft !== undefined && stateDraft !== cs.state && stateDraft.trim() && (
                    <button
                      onClick={() => updateCharStateOnPage(slug, stateDraft)}
                      style={{ marginTop: 5, width: '100%', background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}
                    >
                      Save State Change
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Add Character to Page */}
          {showAddChar ? (
            <div style={{ background: '#0f172a', border: '1px solid #4338ca', borderRadius: 6, padding: 10, marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#818cf8', marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Add Character to Page</div>

              {/* Name — datalist shows existing chars for autocomplete */}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Name *</div>
                <input
                  autoFocus
                  list="add-char-names"
                  value={addCharForm.name}
                  onChange={e => setAddCharForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Character name"
                  style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box', outline: 'none' }}
                />
                <datalist id="add-char-names">
                  {characters.map(c => <option key={c.name} value={c.name} />)}
                </datalist>
              </div>

              {/* Ref image + visual desc — only shown for new (not existing) characters */}
              {addCharForm.name.trim() && !characters.some(c => charSlug(c.name) === charSlug(addCharForm.name)) && (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Reference Image</div>
                    {addCharRefUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, padding: '3px 8px' }}>
                        <span style={{ fontSize: 10, color: '#9ca3af', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addCharRefUrl.split('/').pop()}</span>
                        <button onClick={() => setAddCharRefUrl('')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                      </div>
                    ) : (
                      <button onClick={() => setLibraryTarget({ type: 'addCharRef' })}
                        style={{ width: '100%', background: '#1f2937', border: '1px dashed #374151', color: '#6b7280', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
                        📚 Choose from Library
                      </button>
                    )}
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Visual Description</div>
                    <textarea
                      value={addCharForm.visDesc}
                      onChange={e => setAddCharForm(prev => ({ ...prev, visDesc: e.target.value }))}
                      rows={2}
                      placeholder="Describe appearance..."
                      style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'none', boxSizing: 'border-box', outline: 'none' }}
                    />
                  </div>
                </>
              )}

              {/* Sprite state — datalist shows existing states if char exists */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Sprite State for this page *</div>
                <input
                  list="add-char-states"
                  value={addCharForm.state}
                  onChange={e => setAddCharForm(prev => ({ ...prev, state: e.target.value }))}
                  placeholder="e.g. idle"
                  style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box', outline: 'none' }}
                />
                <datalist id="add-char-states">
                  {(characters.find(c => charSlug(c.name) === charSlug(addCharForm.name))?.sprite_states ?? []).map(s => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {addCharError && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 6 }}>{addCharError}</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={addCharToPage}
                  disabled={addingChar || !addCharForm.name.trim() || !addCharForm.state.trim()}
                  style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: addingChar || !addCharForm.name.trim() || !addCharForm.state.trim() ? 'not-allowed' : 'pointer', opacity: addingChar || !addCharForm.name.trim() || !addCharForm.state.trim() ? 0.5 : 1 }}
                >
                  {addingChar ? 'Adding...' : 'Add to Page'}
                </button>
                <button
                  onClick={() => { setShowAddChar(false); setAddCharError(''); setAddCharForm({ name: '', visDesc: '', state: '' }); setAddCharRefUrl('') }}
                  style={{ background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddChar(true)}
              style={{ marginTop: 8, width: '100%', background: 'transparent', border: '1px dashed #4338ca', color: '#6366f1', borderRadius: 6, padding: '6px 0', fontSize: 11, cursor: 'pointer' }}>
              + Add Character to Page
            </button>
          )}
        </div>
      )}

      <div style={{ height: 1, background: '#374151', marginBottom: 16 }} />

      {/* ─────────────────────────────────────────────────────────────────────
          SECTION: BACKGROUND
      ───────────────────────────────────────────────────────────────────── */}
      <SectionHeader title="Background" expanded={bgExpanded} onToggle={() => setBgExpanded(e => !e)} />
      {bgExpanded && (
        <div style={{ marginBottom: 16 }}>
          {/* Scene inputs: mood, setting, fg/bg chars, scene_motion */}
          {(
            [
              { key: 'mood', label: 'Mood', source: 'header' },
              { key: 'setting', label: 'Setting', source: 'header' },
              { key: 'foreground_characters', label: 'Foreground Characters', source: 'header' },
              { key: 'background_characters', label: 'Background Characters', source: 'header' },
              { key: 'scene_motion', label: 'Scene Motion', source: 'bg' },
            ] as Array<{ key: string; label: string; source: 'header' | 'bg' }>
          ).map(({ key, label, source }) => {
            const isDirty = source === 'header' ? key in headerDraft : bgDraft !== null
            const value = source === 'header'
              ? headerFieldValue(key)
              : (bgDraft !== null ? bgDraft : (page.scene_motion ?? ''))
            const onChange = source === 'header'
              ? (v: string) => handleHeaderChange(key, v)
              : (v: string) => setBgDraft(v)
            return (
              <div key={key} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{label}</div>
                <input
                  type="text"
                  value={value}
                  onChange={e => onChange(e.target.value)}
                  style={{
                    width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                    color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box',
                    outline: isDirty ? '1px solid #f59e0b' : 'none',
                  }}
                />
              </div>
            )
          })}
          {(hasHeaderDraft || bgDraft !== null) && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button
                onClick={async () => { await saveHeader(); await saveBgMotion() }}
                disabled={headerSaving || bgSaving}
                style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer', opacity: (headerSaving || bgSaving) ? 0.7 : 1 }}
              >
                {(headerSaving || bgSaving) ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { discardHeader(); setBgDraft(null) }}
                style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}
              >
                Discard
              </button>
            </div>
          )}

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
              <button
                onClick={() => setLibraryTarget({ type: 'bgRef', pageNum: actualPage })}
                style={{ width: '100%', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: 'pointer', marginTop: 4 }}
              >
                📚 From Library
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

      {/* Asset library picker */}
      {libraryTarget && (
        <AssetLibraryPicker
          projectId={projectId}
          title={
            libraryTarget.type === 'charRef'
              ? `Select Ref for ${libraryTarget.charName}`
              : `Select Ref for Page ${actualPage}`
          }
          defaultTab="library"
          onSelect={url => {
            if (libraryTarget.type === 'charRef') assignCharRef(libraryTarget.slug, url)
            else if (libraryTarget.type === 'bgRef') assignBgRef(libraryTarget.pageNum, url)
            else if (libraryTarget.type === 'addCharRef') setAddCharRefUrl(url)
          }}
          onClose={() => setLibraryTarget(null)}
        />
      )}
    </div>
  )
}

function Pending() {
  return <div style={{ height: 36, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#4b5563' }}>Not generated yet</div>
}


function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#d1d5db', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
