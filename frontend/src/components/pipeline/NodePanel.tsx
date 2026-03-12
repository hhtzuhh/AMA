import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type { Page, Character, LiveNodeData } from '../../types'
import { charSlug } from './PageNode'
import { AssetLibraryPicker } from './AssetLibraryPicker'

const API = 'http://localhost:8000'

export interface StageInfo {
  label: string; script: string; inputLabel: string; outputLabel: string; description: string
}

type SelectedNode =
  | { type: 'pipelineStage'; data: StageInfo }
  | { type: 'page'; data: { page: Page } }
  | { type: 'live'; data: { node: LiveNodeData } }
  | { type: 'edge'; data: { edgeId: string; label: string } }

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
  onLiveNodeDeleted?: (nodeId: string) => void
  onLiveNodeUpdated?: (node: LiveNodeData) => void
  onEdgeLabelSaved?: (edgeId: string, label: string) => void
}

export default function NodePanel({ selected, onClose, manifest, completedSprites, doneBackgrounds, doneNarrations, onManifestChange, onPageDeleted, onPageUpdated, characters, onLiveNodeDeleted, onLiveNodeUpdated, onEdgeLabelSaved }: Props) {
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

  function getAllNarrationVersions(): Array<{ pageNum: number; version: any }> {
    const result: Array<{ pageNum: number; version: any }> = []
    for (const [pageNum, page] of Object.entries(manifest?.pages ?? {})) {
      const entry = (page as any)?.narration
      if (entry?.versions?.length) {
        for (const v of entry.versions) result.push({ pageNum: Number(pageNum), version: v })
      }
    }
    return result
  }

  async function setCurrent(body: Record<string, any>) {
    await fetch(`${API}/api/projects/${projectId}/manifest/set-current`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    onManifestChange()
    // bg/nar active URL lives in story_data.json (page.bg_url / page.nar_url), so reload page data too
    if (body.type === 'background' || body.type === 'narration') {
      onPageUpdated()
    }
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
          allNarrationVersions={getAllNarrationVersions()}
        />
      )}
      {selected.type === 'live' && (
        <LiveNodePanel
          node={selected.data.node}
          projectId={projectId!}
          characters={characters}
          onDeleted={onLiveNodeDeleted ?? (() => {})}
          onUpdated={onLiveNodeUpdated ?? (() => {})}
        />
      )}
      {selected.type === 'edge' && (
        <EdgeLabelPanel
          key={selected.data.edgeId}
          edgeId={selected.data.edgeId}
          initialLabel={selected.data.label}
          onSave={(label) => onEdgeLabelSaved?.(selected.data.edgeId, label)}
        />
      )}
    </div>
  )
}

function EdgeLabelPanel({ edgeId, initialLabel, onSave }: { edgeId: string; initialLabel: string; onSave: (label: string) => void }) {
  const [label, setLabel] = useState(initialLabel)
  return (
    <div>
      <h2 style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 12 }}>Edge Condition</h2>
      <p style={{ color: '#9ca3af', fontSize: 11, marginBottom: 10 }}>
        Describe when the AI should follow this path. The AI uses this to decide which edge to take.
      </p>
      <label style={{ color: '#9ca3af', fontSize: 11 }}>Condition label</label>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder='e.g. "child roared loudly"'
        style={{ display: 'block', width: '100%', background: '#1e1e3f', color: 'white', border: '1px solid #374151', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginTop: 4, marginBottom: 10, boxSizing: 'border-box' }}
      />
      <button
        onClick={() => onSave(label)}
        style={{ background: '#4f46e5', color: 'white', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
      >
        Save
      </button>
      <p style={{ color: '#6b7280', fontSize: 10, marginTop: 8 }}>Edge: {edgeId}</p>
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

function VersionPicker({ entry, activeUrl, onSelect }: { entry: any; activeUrl: string | null | undefined; onSelect: (v: number) => void }) {
  if (!entry || !entry.versions?.length) return null
  const count = entry.versions.length
  if (count <= 1) return <span style={{ fontSize: 10, color: '#4b5563' }}>v1</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
      {entry.versions.map((v: any, i: number) => {
        const isActive = activeUrl ? v.url === activeUrl : i === count - 1
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', border: 'none',
              background: isActive ? '#4338ca' : '#1f2937',
              color: isActive ? 'white' : '#6b7280',
            }}
          >
            v{i + 1}
          </button>
        )
      })}
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

function PagePanel({ page, projectId, characters, completedSprites, doneBackgrounds, doneNarrations, getSpriteEntry, getBackgroundEntry, getNarrationEntry, assetUrl, setCurrent, onPageDeleted, onPageUpdated, onManifestChange, allNarrationVersions }: {
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
  allNarrationVersions: Array<{ pageNum: number; version: any }>
}) {
  const [headerDraft, setHeaderDraft] = useState<Record<string, string>>({})
  const [narDraft, setNarDraft] = useState<string | null>(null)
  const [narMoodDraft, setNarMoodDraft] = useState<string | null>(null)
  const [bgDraft, setBgDraft] = useState<string | null>(null)
  const [showBgCreate, setShowBgCreate] = useState(false)
  const [bgCreateMode, setBgCreateMode] = useState<'new' | 'pick'>('new')
  const [showNarCreate, setShowNarCreate] = useState(false)
  const [narCreateMode, setNarCreateMode] = useState<'new' | 'pick'>('new')
  const [showNarPicker, setShowNarPicker] = useState(false)
  const [bgCreateError, setBgCreateError] = useState('')
  const [narCreateError, setNarCreateError] = useState('')
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
    | { type: 'bgPick' }
    | { type: 'addCharRef' }
    | null
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget>(null)

  // Add character to page form
  const [showAddChar, setShowAddChar] = useState(false)
  const [addCharMode, setAddCharMode] = useState<'existing' | 'new'>('existing')
  const [addExisting, setAddExisting] = useState({ slug: '', state: '' })
  const [addNew, setAddNew] = useState({ name: '', state: '', visDesc: '' })
  const [addCharRefUrl, setAddCharRefUrl] = useState('')
  const [addingChar, setAddingChar] = useState(false)
  const [addCharError, setAddCharError] = useState('')

  // Per-character sprite state draft for this page (slug → edited state)
  const [charStateDraft, setCharStateDraft] = useState<Record<string, string>>({})

  // Section collapse
  const [charExpanded, setCharExpanded] = useState(true)
  const [bgExpanded, setBgExpanded] = useState(true)
  const [narExpanded, setNarExpanded] = useState(true)

  function startItemJob(jobId: string, key: string, onDone: (status: string, error?: string) => void) {
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
          onDone(data.status, data.error ?? undefined)
          onManifestChange()
        }
      } catch {
        // ignore transient fetch errors
      }
    }, 2000)
    activeJobsRef.current[key] = interval
    setRunningItems(prev => new Set(prev).add(key))
  }

  function jobErrorMsg(error?: string): string {
    if (!error) return 'Generation failed'
    // Extract the last meaningful line (exception type + message, not full traceback)
    const lines = error.split('\n').map(l => l.trim()).filter(Boolean)
    const last = lines[lines.length - 1] ?? error
    return last.length > 120 ? last.slice(0, 120) + '…' : last
  }

  async function regenerateBackground() {
    const key = 'bg'
    if (runningItems.has(key)) return
    setBgCreateError('')
    // Save any drafted fields before generating
    const fields: Record<string, any> = {}
    for (const [k, v] of Object.entries(headerDraft)) {
      if (k === 'foreground_characters' || k === 'background_characters') {
        fields[k] = v.split(',').map((s: string) => s.trim()).filter(Boolean)
      } else {
        fields[k] = v
      }
    }
    if (bgDraft !== null) fields.scene_motion = bgDraft
    if (Object.keys(fields).length > 0) {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      setHeaderDraft({})
      setBgDraft(null)
      onPageUpdated()
    }
    const res = await fetch(`${API}/api/projects/${projectId}/pipeline/background/${actualPage}`, { method: 'POST' })
    if (!res.ok) { setBgCreateError('Failed to start generation'); return }
    const { job_id } = await res.json()
    startItemJob(job_id, key, (status, error) => {
      if (status === 'failed') {
        setBgCreateError(jobErrorMsg(error))
      } else {
        setShowBgCreate(false)
        setBgCreateError('')
        onPageUpdated()
      }
    })
  }

  async function regenerateNarration() {
    const key = 'nar'
    if (runningItems.has(key)) return
    setNarCreateError('')
    // Save text + mood before generating
    const fields: Record<string, any> = {}
    if (narDraft !== null) fields.text = narDraft
    if (narMoodDraft !== null) fields.mood = narMoodDraft
    if (Object.keys(fields).length > 0) {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      setNarDraft(null)
      setNarMoodDraft(null)
      onPageUpdated()
    }
    const res = await fetch(`${API}/api/projects/${projectId}/pipeline/narration/${actualPage}`, { method: 'POST' })
    if (!res.ok) { setNarCreateError('Failed to start generation'); return }
    const { job_id } = await res.json()
    startItemJob(job_id, key, (status, error) => {
      if (status === 'failed') {
        setNarCreateError(jobErrorMsg(error))
      } else {
        setShowNarCreate(false)
        setNarCreateError('')
        onPageUpdated()
      }
    })
  }

  async function regenerateSprite(slug: string, state: string) {
    const key = `sprite:${slug}/${state}`
    if (runningItems.has(key)) return
    const res = await fetch(`${API}/api/projects/${projectId}/pipeline/sprite/${slug}/${state}`, { method: 'POST' })
    if (!res.ok) return
    const { job_id } = await res.json()
    startItemJob(job_id, key, () => {})
  }

  const actualPage = page.actual_page ?? page.page
  const bgEntry = getBackgroundEntry(actualPage)
  const narEntry = getNarrationEntry(actualPage)

  // Active URL comes from page (source of truth); fall back to latest version for display
  const bgActiveUrl = page.bg_url ?? bgEntry?.versions?.[bgEntry.versions.length - 1]?.url ?? null
  const narActiveUrl = page.nar_url ?? narEntry?.versions?.[narEntry.versions.length - 1]?.url ?? null
  const bgGenInputs = bgEntry?.versions?.find((v: any) => v.url === bgActiveUrl)?.generation_inputs ?? null
  const narGenInputs = narEntry?.versions?.find((v: any) => v.url === narActiveUrl)?.generation_inputs ?? null

  // ── Page Header helpers ──────────────────────────────────────────────────
function headerFieldValue(key: string): string {
    if (key in headerDraft) return headerDraft[key]
    if (key === 'foreground_characters') return page.foreground_characters?.join(', ') ?? ''
    if (key === 'background_characters') return page.background_characters?.join(', ') ?? ''
    return (page as any)[key] ?? ''
  }

  function handleHeaderChange(key: string, value: string) {
    setHeaderDraft(prev => ({ ...prev, [key]: value }))
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

  async function setPageSpriteVersion(slug: string, state: string, spriteUrl: string) {
    await fetch(`${API}/api/projects/${projectId}/pages/${page.page}/sprite-version`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ char: slug, state, sprite_url: spriteUrl }),
    })
    onPageUpdated()
  }

  async function addExistingCharToPage(slug: string, state: string) {
    setAddingChar(true)
    setAddCharError('')
    try {
      const charData = characters.find(c => charSlug(c.name) === slug)
      if (!charData) { setAddCharError('Character not found'); return }
      if (!charData.sprite_states.includes(state)) {
        await fetch(`${API}/api/projects/${projectId}/characters/${slug}/sprite-states`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        })
      }
      const alreadyOnPage = page.character_states.some(cs => charSlug(cs.character) === slug)
      if (!alreadyOnPage) {
        const updated = [...page.character_states, { character: charData.name, state }]
        await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { character_states: updated } }),
        })
      }
      resetAddForm()
      onPageUpdated()
    } finally {
      setAddingChar(false)
    }
  }

  async function generateExistingChar(slug: string, state: string) {
    const key = `sprite:${slug}/${state}`
    if (runningItems.has(key)) return
    setAddingChar(true)
    setAddCharError('')
    try {
      const charData = characters.find(c => charSlug(c.name) === slug)
      if (charData && !charData.sprite_states.includes(state)) {
        await fetch(`${API}/api/projects/${projectId}/characters/${slug}/sprite-states`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        })
      }
      const res = await fetch(`${API}/api/projects/${projectId}/pipeline/sprite/${slug}/${state}`, { method: 'POST' })
      if (!res.ok) {
        setAddCharError('Failed to start generation')
        return
      }
      const { job_id } = await res.json()
      // Keep form open — spinner via runningItems; close on completion
      startItemJob(job_id, key, (status, error) => {
        if (status === 'failed') {
          setAddCharError(jobErrorMsg(error))
        } else {
          resetAddForm()
        }
      })
    } catch {
      setAddCharError('Error starting generation')
    } finally {
      setAddingChar(false)
    }
  }

  async function addNewCharToPage() {
    const { name, state, visDesc } = addNew
    if (!name.trim() || !state.trim()) return
    const trimmedState = state.trim()
    const slug = charSlug(name)
    const key = `sprite:${slug}/${trimmedState}`
    if (runningItems.has(key)) return
    setAddingChar(true)
    setAddCharError('')
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, visual_description: visDesc.trim(), sprite_states: [trimmedState] }),
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
      }
      const updated = [...page.character_states, { character: name, state: trimmedState }]
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { character_states: updated } }),
      })
      onPageUpdated()
      // Start sprite generation — keep form open to show spinner
      const genRes = await fetch(`${API}/api/projects/${projectId}/pipeline/sprite/${slug}/${trimmedState}`, { method: 'POST' })
      if (!genRes.ok) {
        setAddCharError('Character created, but failed to start generation')
        return
      }
      const { job_id } = await genRes.json()
      startItemJob(job_id, key, (status, error) => {
        if (status === 'failed') {
          setAddCharError(jobErrorMsg(error))
        } else {
          resetAddForm()
        }
      })
    } catch {
      setAddCharError('Error creating character')
    } finally {
      setAddingChar(false)
    }
  }

  function resetAddForm() {
    setShowAddChar(false)
    setAddCharError('')
    setAddExisting({ slug: '', state: '' })
    setAddNew({ name: '', state: '', visDesc: '' })
    setAddCharRefUrl('')
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
            const entry = getSpriteEntry(cs.character, activeState)
            const versions: any[] = entry?.versions ?? []

            // Per-page selection: cs.sprite_url if set, else latest version
            const selectedIdx = cs.sprite_url
              ? versions.findIndex((v: any) => v.url === cs.sprite_url)
              : versions.length - 1
            const selectedVersion = selectedIdx >= 0 ? versions[selectedIdx] : null
            const spriteUrl = selectedVersion ? assetUrl(selectedVersion.url) : null
            const genInputs = selectedVersion?.generation_inputs ?? null

            return (
              <div key={slug} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1f2937' }}>
                {/* Name + role + remove */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: 12, color: '#e5e7eb', fontWeight: 'bold' }}>{cs.character}</span>
                    {charData?.role && <span style={{ marginLeft: 6, fontSize: 10, color: '#6b7280' }}>{charData.role}</span>}
                  </div>
                  <button onClick={() => removeCharFromPage(slug)} title="Remove from page"
                    style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>

                {/* State (page-level, still editable) */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>State</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      list={`states-${slug}`}
                      value={activeState}
                      onChange={e => setCharStateDraft(prev => ({ ...prev, [slug]: e.target.value }))}
                      style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '3px 6px', boxSizing: 'border-box' as const, outline: stateDraft !== undefined ? '1px solid #f59e0b' : 'none' }}
                    />
                    <datalist id={`states-${slug}`}>
                      {allStates.map(s => <option key={s} value={s} />)}
                    </datalist>
                    {stateDraft !== undefined && stateDraft !== cs.state && stateDraft.trim() && (
                      <button onClick={() => updateCharStateOnPage(slug, stateDraft)}
                        style={{ background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                        Save
                      </button>
                    )}
                  </div>
                </div>

                {/* Sprite display */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Sprite</div>
                  {spriteUrl ? (
                    <img src={spriteUrl} alt={activeState}
                      style={{ height: 72, objectFit: 'contain', display: 'block', marginBottom: 6, borderRadius: 3 }}
                      onError={e => { (e.target as HTMLImageElement).style.opacity = '0.1' }} />
                  ) : (
                    <div style={{ height: 48, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#4b5563', marginBottom: 6 }}>
                      {versions.length === 0 ? 'Not generated' : 'No sprite'}
                    </div>
                  )}

                  {/* Version thumbnails — click to set per-page sprite_url */}
                  {versions.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                      {versions.map((v: any, i: number) => (
                        <button
                          key={i}
                          onClick={() => setPageSpriteVersion(slug, activeState, v.url)}
                          title={v.generation_inputs?.visual_description ?? ''}
                          style={{
                            padding: 2, border: selectedIdx === i ? '2px solid #6366f1' : '1px solid #374151',
                            borderRadius: 4, background: 'transparent', cursor: 'pointer',
                          }}
                        >
                          <img src={assetUrl(v.url)} alt={`v${i + 1}`}
                            style={{ height: 36, width: 36, objectFit: 'contain', display: 'block' }}
                            onError={e => { (e.target as HTMLImageElement).style.opacity = '0.1' }} />
                          <div style={{ fontSize: 9, color: selectedIdx === i ? '#a5b4fc' : '#6b7280', textAlign: 'center' as const }}>v{i + 1}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected version's generation inputs (read-only) */}
                {genInputs && (
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: '6px 8px' }}>
                    <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>v{selectedIdx + 1} generation inputs</div>
                    {genInputs.visual_description && (
                      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, lineHeight: 1.4 }}>
                        <span style={{ color: '#4b5563' }}>Viz: </span>{genInputs.visual_description}
                      </div>
                    )}
                    {genInputs.ref_image && (
                      <div>
                        <span style={{ fontSize: 10, color: '#4b5563' }}>Ref: </span>
                        <img src={`${assetUrl(genInputs.ref_image)}?v=${refBusters[slug] ?? 0}`}
                          alt="ref"
                          style={{ height: 36, objectFit: 'contain', marginTop: 2, display: 'block', borderRadius: 2 }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add Character form */}
          {showAddChar ? (
            <div style={{ background: '#0f172a', border: '1px solid #4338ca', borderRadius: 6, padding: 10, marginTop: 8 }}>
              {/* Hidden file input for ref upload in existing mode */}
              <input
                ref={charRefInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleCharRefFile}
              />
              <div style={{ fontSize: 10, color: '#818cf8', marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Add Character</div>

              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['existing', 'new'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { setAddCharMode(mode); setAddCharError('') }}
                    style={{ flex: 1, background: addCharMode === mode ? '#4338ca' : '#1f2937', color: addCharMode === mode ? 'white' : '#6b7280', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}
                  >
                    {mode === 'existing' ? 'Pick Existing' : 'New Character'}
                  </button>
                ))}
              </div>

              {addCharMode === 'existing' ? (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Character</div>
                    <select
                      value={addExisting.slug}
                      onChange={e => setAddExisting({ slug: e.target.value, state: '' })}
                      style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px' }}
                    >
                      <option value="">Select character...</option>
                      {characters.map(c => (
                        <option key={c.name} value={charSlug(c.name)}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {addExisting.slug && (
                    <>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>State</div>
                        <input
                          list="existing-char-states"
                          value={addExisting.state}
                          onChange={e => setAddExisting(prev => ({ ...prev, state: e.target.value }))}
                          placeholder="e.g. idle"
                          style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box' as const }}
                        />
                        <datalist id="existing-char-states">
                          {(characters.find(c => charSlug(c.name) === addExisting.slug)?.sprite_states ?? []).map(s => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </div>

                      {/* Current ref image + upload */}
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>Reference Image</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <div>
                            <img
                              src={`${assetUrl(`refs/${addExisting.slug}_ref.png`)}?v=${refBusters[addExisting.slug] ?? 0}`}
                              alt="ref"
                              style={{ height: 44, width: 44, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4, display: 'block' }}
                              onError={e => { (e.target as HTMLImageElement).style.opacity = '0.1' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <button
                              onClick={() => { charRefTargetSlug.current = addExisting.slug; charRefInputRef.current?.click() }}
                              disabled={!!charRefUploading[addExisting.slug]}
                              style={{ background: '#1f2937', border: '1px solid #374151', color: '#9ca3af', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
                            >
                              {charRefUploading[addExisting.slug] ? '...' : '↑ Upload'}
                            </button>
                            <button
                              onClick={() => setLibraryTarget({ type: 'charRef', slug: addExisting.slug, charName: characters.find(c => charSlug(c.name) === addExisting.slug)?.name ?? addExisting.slug })}
                              style={{ background: '#1f2937', border: '1px solid #374151', color: '#9ca3af', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
                            >
                              📚 Library
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {addCharError && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 6 }}>{addCharError}</div>}

                  {addExisting.slug && addExisting.state.trim() && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      <button
                        onClick={() => addExistingCharToPage(addExisting.slug, addExisting.state.trim())}
                        disabled={addingChar}
                        style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 10, cursor: addingChar ? 'not-allowed' : 'pointer' }}
                      >
                        Add to Page
                      </button>
                      <button
                        onClick={() => generateExistingChar(addExisting.slug, addExisting.state.trim())}
                        disabled={addingChar || runningItems.has(`sprite:${addExisting.slug}/${addExisting.state.trim()}`)}
                        style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 10, cursor: (addingChar || runningItems.has(`sprite:${addExisting.slug}/${addExisting.state.trim()}`)) ? 'not-allowed' : 'pointer' }}
                      >
                        {runningItems.has(`sprite:${addExisting.slug}/${addExisting.state.trim()}`) ? '⟳ Generating...' : addingChar ? '...' : '↻ Generate New'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Name *</div>
                    <input
                      autoFocus
                      value={addNew.name}
                      onChange={e => setAddNew(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Character name"
                      style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box' as const }}
                    />
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>State for this page *</div>
                    <input
                      value={addNew.state}
                      onChange={e => setAddNew(prev => ({ ...prev, state: e.target.value }))}
                      placeholder="e.g. idle"
                      style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box' as const }}
                    />
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Visual Description</div>
                    <textarea
                      value={addNew.visDesc}
                      onChange={e => setAddNew(prev => ({ ...prev, visDesc: e.target.value }))}
                      rows={2}
                      placeholder="Describe appearance..."
                      style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'none' as const, boxSizing: 'border-box' as const }}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Reference Image</div>
                    {addCharRefUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, padding: '3px 8px' }}>
                        <span style={{ fontSize: 10, color: '#9ca3af', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{addCharRefUrl.split('/').pop()}</span>
                        <button onClick={() => setAddCharRefUrl('')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                      </div>
                    ) : (
                      <button onClick={() => setLibraryTarget({ type: 'addCharRef' })}
                        style={{ width: '100%', background: '#1f2937', border: '1px dashed #374151', color: '#6b7280', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
                        📚 Choose from Library
                      </button>
                    )}
                  </div>

                  {addCharError && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 6 }}>{addCharError}</div>}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={addNewCharToPage}
                      disabled={addingChar || runningItems.has(`sprite:${charSlug(addNew.name)}/${addNew.state.trim()}`) || !addNew.name.trim() || !addNew.state.trim()}
                      style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: 'pointer', opacity: (!addNew.name.trim() || !addNew.state.trim()) ? 0.5 : 1 }}
                    >
                      {runningItems.has(`sprite:${charSlug(addNew.name)}/${addNew.state.trim()}`) ? '⟳ Generating...' : addingChar ? 'Creating...' : 'Create & Add'}
                    </button>
                  </div>
                </>
              )}

              <button
                onClick={resetAddForm}
                style={{ width: '100%', background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer', marginTop: 6 }}
              >
                Cancel
              </button>
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
          {/* Display: video player + version picker + selected version's generation_inputs */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Video</span>
              <VersionPicker
                entry={bgEntry}
                activeUrl={bgActiveUrl}
                onSelect={v => setCurrent({ type: 'background', page: actualPage, version: v })}
              />
            </div>
            {bgActiveUrl
              ? <video key={bgActiveUrl} src={assetUrl(bgActiveUrl)} style={{ width: '100%', borderRadius: 4, background: 'black' }} controls muted preload="metadata" />
              : <Pending />
            }
            {bgGenInputs && (
              <div style={{ background: '#0f172a', borderRadius: 4, padding: '6px 8px', marginTop: 6 }}>
                <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>
                  v{(bgEntry?.versions?.findIndex((v: any) => v.url === bgActiveUrl) ?? 0) + 1} generation inputs
                </div>
                {bgGenInputs.prompt && (
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, lineHeight: 1.4 }}>
                    <span style={{ color: '#4b5563' }}>Prompt: </span>{bgGenInputs.prompt}
                  </div>
                )}
                {bgGenInputs.ref_image && (
                  <div>
                    <span style={{ fontSize: 10, color: '#4b5563' }}>Ref: </span>
                    <img src={assetUrl(bgGenInputs.ref_image)} alt="ref"
                      style={{ height: 36, objectFit: 'contain', marginTop: 2, display: 'block', borderRadius: 2 }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Create / Pick accordion */}
          <button
            onClick={() => setShowBgCreate(e => !e)}
            style={{
              width: '100%', background: showBgCreate ? '#0e1e2a' : 'transparent',
              border: '1px solid #164e63', borderRadius: 4,
              padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              marginBottom: showBgCreate ? 8 : 0, color: '#67e8f9', fontSize: 10,
            }}
          >
            <span>{showBgCreate ? '▼' : '▶'}</span>
            <span style={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>Add Background</span>
          </button>
          {showBgCreate && (
            <div style={{ paddingTop: 4 }}>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['pick', 'new'] as const).map(mode => (
                  <button key={mode} onClick={() => { setBgCreateMode(mode); setBgCreateError('') }}
                    style={{ flex: 1, background: bgCreateMode === mode ? '#164e63' : '#1f2937', color: bgCreateMode === mode ? '#67e8f9' : '#6b7280', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
                    {mode === 'pick' ? 'Pick Existing' : 'Generate New'}
                  </button>
                ))}
              </div>

              {bgCreateMode === 'pick' && (
                <div>
                  <button
                    onClick={() => setLibraryTarget({ type: 'bgPick' })}
                    style={{ width: '100%', background: '#1f2937', border: '1px dashed #164e63', color: '#67e8f9', borderRadius: 4, padding: '8px 0', fontSize: 11, cursor: 'pointer' }}
                  >
                    📂 Browse Scene Videos
                  </button>
                  {bgCreateError && <div style={{ fontSize: 10, color: '#f87171', marginTop: 6 }}>{bgCreateError}</div>}
                </div>
              )}

              {bgCreateMode === 'new' && (<>
              {/* Editable fields */}
              {(
                [
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

              {/* Prompt preview */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Prompt Preview</div>
                <textarea
                  readOnly
                  rows={4}
                  value={buildBgPrompt(page, bgPromptDraft)}
                  style={{
                    width: '100%', background: '#0f172a', border: '1px solid #374151', borderRadius: 4,
                    color: '#6b7280', fontSize: 10, padding: '4px 6px', resize: 'vertical' as const, boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Reference image */}
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
                    style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box' }}
                  />
                  <button
                    onClick={setRefByPage}
                    disabled={settingRef || !refPageInput}
                    style={{ background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: settingRef ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' as const }}
                  >
                    Set
                  </button>
                </div>
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

              {bgCreateError && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 6 }}>{bgCreateError}</div>}
              <button
                onClick={regenerateBackground}
                disabled={runningItems.has('bg')}
                style={{
                  width: '100%',
                  background: runningItems.has('bg') ? '#92400e' : '#164e63',
                  color: runningItems.has('bg') ? '#fde68a' : '#67e8f9',
                  border: 'none', borderRadius: 4, padding: '6px 0', fontSize: 11,
                  cursor: runningItems.has('bg') ? 'not-allowed' : 'pointer',
                }}
              >
                {runningItems.has('bg') ? '⟳ Generating...' : '⟳ Generate'}
              </button>
              </>)}
            </div>
          )}
        </div>
      )}

      <div style={{ height: 1, background: '#374151', marginBottom: 16 }} />

      {/* ─────────────────────────────────────────────────────────────────────
          SECTION: NARRATION
      ───────────────────────────────────────────────────────────────────── */}
      <SectionHeader title="Narration" expanded={narExpanded} onToggle={() => setNarExpanded(e => !e)} />
      {narExpanded && (
        <div style={{ marginBottom: 16 }}>
          {/* Display: audio player + version picker + selected version's generation_inputs */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Audio</span>
              <VersionPicker
                entry={narEntry}
                activeUrl={narActiveUrl}
                onSelect={v => setCurrent({ type: 'narration', page: actualPage, version: v })}
              />
            </div>
            {narActiveUrl
              ? <audio key={narActiveUrl} src={assetUrl(narActiveUrl)} controls style={{ width: '100%' }} />
              : <Pending />
            }
            {narGenInputs && (
              <div style={{ background: '#0f172a', borderRadius: 4, padding: '6px 8px', marginTop: 6 }}>
                <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>
                  v{(narEntry?.versions?.findIndex((v: any) => v.url === narActiveUrl) ?? 0) + 1} generation inputs
                </div>
                {narGenInputs.text && (
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, lineHeight: 1.4 }}>
                    <span style={{ color: '#4b5563' }}>Text: </span>{narGenInputs.text}
                  </div>
                )}
                {narGenInputs.mood && (
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>
                    <span style={{ color: '#4b5563' }}>Mood: </span>{narGenInputs.mood}
                  </div>
                )}
                {narGenInputs.voice && (
                  <div style={{ fontSize: 10, color: '#6b7280' }}>
                    <span style={{ color: '#4b5563' }}>Voice: </span>{narGenInputs.voice}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Create / Pick accordion */}
          <button
            onClick={() => setShowNarCreate(e => !e)}
            style={{
              width: '100%', background: showNarCreate ? '#1c1a10' : 'transparent',
              border: '1px solid #78350f', borderRadius: 4,
              padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              marginBottom: showNarCreate ? 8 : 0, color: '#fcd34d', fontSize: 10,
            }}
          >
            <span>{showNarCreate ? '▼' : '▶'}</span>
            <span style={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>Add Narration</span>
          </button>
          {showNarCreate && (
            <div style={{ paddingTop: 4 }}>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['pick', 'new'] as const).map(mode => (
                  <button key={mode} onClick={() => { setNarCreateMode(mode); setNarCreateError('') }}
                    style={{ flex: 1, background: narCreateMode === mode ? '#78350f' : '#1f2937', color: narCreateMode === mode ? '#fcd34d' : '#6b7280', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
                    {mode === 'pick' ? 'Pick Existing' : 'Generate New'}
                  </button>
                ))}
              </div>

              {narCreateMode === 'pick' && (
                <div>
                  <button
                    onClick={() => setShowNarPicker(true)}
                    style={{ width: '100%', background: '#1f2937', border: '1px dashed #78350f', color: '#fcd34d', borderRadius: 4, padding: '8px 0', fontSize: 11, cursor: 'pointer' }}
                  >
                    🎙 Browse Voice Library
                  </button>
                  {narCreateError && <div style={{ fontSize: 10, color: '#f87171', marginTop: 6 }}>{narCreateError}</div>}
                </div>
              )}

              {narCreateMode === 'new' && (<>
              {/* Text */}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Text</div>
                <textarea
                  value={narDraft !== null ? narDraft : page.text}
                  onChange={e => setNarDraft(e.target.value)}
                  rows={4}
                  style={{
                    width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                    color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'vertical' as const, boxSizing: 'border-box',
                    outline: narDraft !== null ? '1px solid #f59e0b' : 'none',
                  }}
                />
              </div>
              {/* Mood */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Mood</div>
                <input
                  type="text"
                  value={narMoodDraft !== null ? narMoodDraft : (page.mood ?? '')}
                  onChange={e => setNarMoodDraft(e.target.value)}
                  style={{
                    width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                    color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box',
                    outline: narMoodDraft !== null ? '1px solid #f59e0b' : 'none',
                  }}
                />
              </div>
              {narCreateError && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 6 }}>{narCreateError}</div>}
              <button
                onClick={regenerateNarration}
                disabled={runningItems.has('nar')}
                style={{
                  width: '100%',
                  background: runningItems.has('nar') ? '#92400e' : '#78350f',
                  color: runningItems.has('nar') ? '#fde68a' : '#fcd34d',
                  border: 'none', borderRadius: 4, padding: '6px 0', fontSize: 11,
                  cursor: runningItems.has('nar') ? 'not-allowed' : 'pointer',
                }}
              >
                {runningItems.has('nar') ? '⟳ Generating...' : '⟳ Generate'}
              </button>
              </>)}
            </div>
          )}

          {showNarPicker && (
            <NarrationLibraryPicker
              versions={allNarrationVersions}
              assetUrl={assetUrl}
              onSelect={async url => {
                await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fields: { nar_url: url } }),
                })
                setShowNarPicker(false)
                setShowNarCreate(false)
                setNarCreateError('')
                onPageUpdated()
                onManifestChange()
              }}
              onClose={() => setShowNarPicker(false)}
            />
          )}
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
            libraryTarget.type === 'charRef' ? `Select Ref for ${libraryTarget.charName}`
            : libraryTarget.type === 'bgPick' ? `Pick Background for Page ${actualPage}`
            : `Select Ref for Page ${actualPage}`
          }
          defaultTab={libraryTarget.type === 'bgPick' ? 'scenes' : 'library'}
          onSelect={async url => {
            if (libraryTarget.type === 'charRef') assignCharRef(libraryTarget.slug, url)
            else if (libraryTarget.type === 'bgRef') assignBgRef(libraryTarget.pageNum, url)
            else if (libraryTarget.type === 'addCharRef') setAddCharRefUrl(url)
            else if (libraryTarget.type === 'bgPick') {
              await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { bg_url: url } }),
              })
              setShowBgCreate(false)
              setBgCreateError('')
              setLibraryTarget(null)
              onPageUpdated()
              onManifestChange()
              return
            }
            setLibraryTarget(null)
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

function NarrationLibraryPicker({ versions, assetUrl, onSelect, onClose }: {
  versions: Array<{ pageNum: number; version: any }>
  assetUrl: (url: string) => string
  onSelect: (url: string) => Promise<void>
  onClose: () => void
}) {
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  function togglePlay(url: string) {
    const audio = audioRef.current
    if (!audio) return
    if (playingUrl === url) {
      audio.pause()
      setPlayingUrl(null)
    } else {
      audio.src = assetUrl(url)
      audio.play().catch(() => {})
      setPlayingUrl(url)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <audio ref={audioRef} onEnded={() => setPlayingUrl(null)} style={{ display: 'none' }} />
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'white', fontWeight: 'bold', fontSize: 13, flex: 1 }}>🎙 Voice Library</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {/* List */}
        <div style={{ overflowY: 'auto', padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {versions.length === 0 ? (
            <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 40 }}>No narrations generated yet.</div>
          ) : versions.map(({ pageNum, version }) => {
            const gi = version.generation_inputs ?? {}
            const isPlaying = playingUrl === version.url
            return (
              <div
                key={version.url}
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '10px 12px' }}
              >
                {/* Top: page badge + voice */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: '#6366f1', background: '#1e1b2e', border: '1px solid #4c1d95', borderRadius: 3, padding: '1px 5px' }}>p.{pageNum}</span>
                  {gi.mood && <span style={{ fontSize: 9, color: '#fcd34d', background: '#1c1a10', border: '1px solid #78350f', borderRadius: 3, padding: '1px 5px' }}>{gi.mood}</span>}
                  {gi.voice && <span style={{ fontSize: 9, color: '#67e8f9', background: '#0e1e2a', border: '1px solid #164e63', borderRadius: 3, padding: '1px 5px' }}>🎤 {gi.voice}</span>}
                </div>
                {/* Text preview */}
                {gi.text && (
                  <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {gi.text}
                  </div>
                )}
                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => togglePlay(version.url)}
                    style={{
                      background: isPlaying ? '#7c3aed' : '#374151', color: isPlaying ? 'white' : '#d1d5db',
                      border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    {isPlaying ? '⏸ Pause' : '▶ Preview'}
                  </button>
                  <button
                    onClick={() => onSelect(version.url)}
                    style={{ marginLeft: 'auto', background: '#78350f', color: '#fcd34d', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 10, cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    Use
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#d1d5db', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}


function LiveNodePanel({
  node,
  projectId,
  characters,
  onDeleted,
  onUpdated,
}: {
  node: LiveNodeData
  projectId: string
  characters: Character[]
  onDeleted: (nodeId: string) => void
  onUpdated: (node: LiveNodeData) => void
}) {
  const [label, setLabel] = useState(node.label)
  const [character, setCharacter] = useState(node.character)
  const [bgUrl, setBgUrl] = useState(node.bg_url)
  const [systemPrompt, setSystemPrompt] = useState(node.system_prompt)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    const updated: LiveNodeData = { id: node.id, label, character, bg_url: bgUrl, system_prompt: systemPrompt }
    await fetch(`${API}/api/projects/${projectId}/live-nodes/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onUpdated(updated)
  }

  async function deleteNode() {
    if (!confirm(`Delete live node "${node.label || node.id}"? This cannot be undone.`)) return
    await fetch(`${API}/api/projects/${projectId}/live-nodes/${node.id}`, { method: 'DELETE' })
    onDeleted(node.id)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    color: '#d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 12,
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1,
    display: 'block', marginBottom: 3, marginTop: 10,
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>🎤</span>
        <h2 style={{ color: '#c084fc', fontWeight: 'bold', fontSize: 13, margin: 0 }}>Live Interaction Node</h2>
      </div>

      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 12, fontFamily: 'monospace' }}>{node.id}</div>

      <label style={labelStyle}>Label</label>
      <input
        style={inputStyle}
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Live Interaction"
      />

      <label style={labelStyle}>Character</label>
      <select
        style={{ ...inputStyle, cursor: 'pointer' }}
        value={character}
        onChange={e => setCharacter(e.target.value)}
      >
        <option value="">— none —</option>
        {characters.map(c => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>

      <label style={labelStyle}>Background URL</label>
      <input
        style={inputStyle}
        value={bgUrl}
        onChange={e => setBgUrl(e.target.value)}
        placeholder="scenes/my_bg.mp4"
      />

      <label style={labelStyle}>System Prompt</label>
      <textarea
        style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
        value={systemPrompt}
        onChange={e => setSystemPrompt(e.target.value)}
        placeholder="You are a character in a children's story..."
      />

      <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            flex: 1, background: saving ? '#374151' : '#7c3aed', color: 'white', border: 'none',
            borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
        <button
          onClick={deleteNode}
          style={{
            background: '#1f2937', color: '#ef4444', border: '1px solid #374151',
            borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
