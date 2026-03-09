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
}

export default function NodePanel({ selected, onClose, manifest, completedSprites, doneBackgrounds, doneNarrations, onManifestChange }: Props) {
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
    <div style={{ width: 288, background: '#111827', borderLeft: '1px solid #374151', padding: 16, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>Details</span>
        <button onClick={onClose} style={{ color: '#6b7280', background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      {selected.type === 'pipelineStage' && <StagePanel info={selected.data} />}
      {selected.type === 'page' && (
        <PagePanel
          page={selected.data.page}
          completedSprites={completedSprites}
          doneBackgrounds={doneBackgrounds}
          doneNarrations={doneNarrations}
          getSpriteEntry={getSpriteEntry}
          getBackgroundEntry={getBackgroundEntry}
          getNarrationEntry={getNarrationEntry}
          assetUrl={assetUrl}
          setCurrent={setCurrent}
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

function PagePanel({ page, completedSprites, doneBackgrounds, doneNarrations, getSpriteEntry, getBackgroundEntry, getNarrationEntry, assetUrl, setCurrent }: {
  page: Page
  completedSprites: Set<string>
  doneBackgrounds: Set<number>
  doneNarrations: Set<number>
  getSpriteEntry: (char: string, state: string) => any
  getBackgroundEntry: (page: number) => any
  getNarrationEntry: (page: number) => any
  assetUrl: (path: string) => string
  setCurrent: (body: object) => void
}) {
  function entryUrl(entry: any): string | null {
    if (!entry || entry.current < 0 || !entry.versions?.length) return null
    return assetUrl(entry.versions[entry.current].url)
  }

  const bgEntry = getBackgroundEntry(page.page)
  const narEntry = getNarrationEntry(page.page)

  return (
    <div>
      <h2 style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 8 }}>Page {page.page} — {page.mood}</h2>
      {page.text && <Field label="Text" value={page.text} />}
      <Field label="Summary" value={page.summary} />
      <Field label="Setting" value={page.setting} />
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
            const key = `${charSlug(cs.character)}/${cs.state}`
            const done = completedSprites.has(key)
            const entry = done ? getSpriteEntry(cs.character, cs.state) : null
            const url = entryUrl(entry)
            return (
              <div key={cs.character} style={{ textAlign: 'center' }}>
                {url
                  ? <img src={url} alt={cs.state} style={{ height: 80, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.15' }} />
                  : <div style={{ height: 80, width: 60, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#4b5563' }}>Pending</div>
                }
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'capitalize', marginTop: 2 }}>{cs.character.split(' ')[0]}</div>
                <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'capitalize' }}>{cs.state}</div>
                <VersionPicker
                  entry={entry}
                  onSelect={v => setCurrent({ type: 'sprite', char: charSlug(cs.character), state: cs.state, version: v })}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Background video */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Label>Background Video</Label>
          <VersionPicker
            entry={bgEntry}
            onSelect={v => setCurrent({ type: 'background', page: page.page, version: v })}
          />
        </div>
        {doneBackgrounds.has(page.page) && entryUrl(bgEntry)
          ? <video key={entryUrl(bgEntry)!} src={entryUrl(bgEntry)!} style={{ width: '100%', borderRadius: 4, background: 'black' }} controls muted preload="metadata" />
          : <Pending />
        }
      </div>

      {/* Narration */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Label>Narration Audio</Label>
          <VersionPicker
            entry={narEntry}
            onSelect={v => setCurrent({ type: 'narration', page: page.page, version: v })}
          />
        </div>
        {doneNarrations.has(page.page) && entryUrl(narEntry)
          ? <audio key={entryUrl(narEntry)!} src={entryUrl(narEntry)!} controls style={{ width: '100%' }} />
          : <Pending />
        }
      </div>
    </div>
  )
}

function Pending() {
  return <div style={{ height: 36, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#4b5563' }}>Not generated yet</div>
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{children}</div>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#d1d5db', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
