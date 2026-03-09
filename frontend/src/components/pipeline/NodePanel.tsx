import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type { Page } from '../../types'
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
}

export default function NodePanel({ selected, onClose, manifest, completedSprites, doneBackgrounds, doneNarrations, onManifestChange, onPageDeleted, onPageUpdated }: Props) {
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

const EDITABLE_FIELDS: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: 'text', label: 'Text', multiline: true },
  { key: 'summary', label: 'Summary', multiline: true },
  { key: 'setting', label: 'Setting' },
  { key: 'mood', label: 'Mood' },
  { key: 'scene_motion', label: 'Scene Motion' },
]

function PagePanel({ page, projectId, completedSprites, doneBackgrounds, doneNarrations, getSpriteEntry, getBackgroundEntry, getNarrationEntry, assetUrl, setCurrent, onPageDeleted, onPageUpdated, onManifestChange }: {
  page: Page
  projectId: string
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
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refPageInput, setRefPageInput] = useState<string>('')
  const [settingRef, setSettingRef] = useState(false)
  const [runningItems, setRunningItems] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeJobsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

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

  const hasDraft = Object.keys(draft).length > 0

  function entryUrl(entry: any): string | null {
    if (!entry || entry.current < 0 || !entry.versions?.length) return null
    return assetUrl(entry.versions[entry.current].url)
  }

  const actualPage = page.actual_page ?? page.page
  const bgEntry = getBackgroundEntry(actualPage)
  const narEntry = getNarrationEntry(actualPage)

  function handleFieldChange(key: string, value: string) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  function discardDraft() {
    setDraft({})
  }

  async function saveDraft() {
    setSaving(true)
    try {
      await fetch(`${API}/api/projects/${projectId}/pages/${page.page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: draft }),
      })
      setDraft({})
      onPageUpdated()
    } finally {
      setSaving(false)
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

  function fieldValue(key: string): string {
    if (key in draft) return draft[key]
    return (page as any)[key] ?? ''
  }

  return (
    <div>
      <h2 style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 8 }}>
        Page {page.page}
        {page.actual_page !== undefined && page.actual_page !== page.page && (
          <span style={{ color: '#6b7280', fontWeight: 'normal', fontSize: 11 }}> (PDF p.{page.actual_page})</span>
        )}
        {' '}— {page.mood}
      </h2>

      {/* Inline editable fields */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Label>Edit Fields</Label>
          {hasDraft && (
            <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 'bold' }}>unsaved changes</span>
          )}
        </div>
        {EDITABLE_FIELDS.map(({ key, label, multiline }) => (
          <div key={key} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{label}</div>
            {multiline ? (
              <textarea
                value={fieldValue(key)}
                onChange={e => handleFieldChange(key, e.target.value)}
                rows={3}
                style={{
                  width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                  color: '#d1d5db', fontSize: 11, padding: '4px 6px', resize: 'vertical', boxSizing: 'border-box',
                  outline: key in draft ? '1px solid #f59e0b' : 'none',
                }}
              />
            ) : (
              <input
                type="text"
                value={fieldValue(key)}
                onChange={e => handleFieldChange(key, e.target.value)}
                style={{
                  width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                  color: '#d1d5db', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box',
                  outline: key in draft ? '1px solid #f59e0b' : 'none',
                }}
              />
            )}
          </div>
        ))}
        {hasDraft && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              onClick={saveDraft}
              disabled={saving}
              style={{ flex: 1, background: '#4338ca', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={discardDraft}
              disabled={saving}
              style={{ flex: 1, background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}
            >
              Discard
            </button>
          </div>
        )}
      </div>

      {page.key_interaction !== 'None' && <Field label="Key Interaction" value={page.key_interaction} />}
      {page.foreground_characters.length > 0 && <Field label="Characters" value={page.foreground_characters.join(', ')} />}

      {page.character_states.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Label>Character States</Label>
          {page.character_states.map(cs => (
            <div key={cs.character} style={{ fontSize: 11, color: '#d1d5db', display: 'flex', gap: 4, marginBottom: 2 }}>
              <span style={{ color: '#6b7280' }}>{cs.character}:</span>
              <span style={{ textTransform: 'capitalize' }}>{cs.state}</span>
            </div>
          ))}
        </div>
      )}

      {/* Per-character sprites */}
      <div style={{ marginBottom: 12 }}>
        <Label>Sprites</Label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {page.character_states.map(cs => {
            const slug = charSlug(cs.character)
            const spriteKey = `${slug}/${cs.state}`
            const itemKey = `sprite:${spriteKey}`
            const done = completedSprites.has(spriteKey)
            const entry = done ? getSpriteEntry(cs.character, cs.state) : null
            const url = entryUrl(entry)
            const isRunning = runningItems.has(itemKey)
            return (
              <div key={`${cs.character}/${cs.state}`} style={{ textAlign: 'center' }}>
                {url
                  ? <img src={url} alt={cs.state} style={{ height: 80, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.15' }} />
                  : <div style={{ height: 80, width: 60, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#4b5563' }}>Pending</div>
                }
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'capitalize', marginTop: 2 }}>{cs.character.split(' ')[0]}</div>
                <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'capitalize' }}>{cs.state}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, justifyContent: 'center' }}>
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
            )
          })}
        </div>
      </div>

      {/* Background Reference */}
      <div style={{ marginBottom: 12 }}>
        <Label>Background Reference</Label>
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

      {/* Background video */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Label>Background Video</Label>
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

      {/* Narration */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Label>Narration Audio</Label>
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

      {/* Delete button */}
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
