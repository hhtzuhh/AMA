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
}

export default function NodePanel({ selected, onClose, manifest, completedSprites, doneBackgrounds, doneNarrations }: Props) {
  const { projectId } = useParams<{ projectId: string }>()

  function assetUrl(path: string) {
    return `${API}/api/projects/${projectId}/assets/${path}`
  }

  // Get current versioned URL for a sprite from manifest
  function getSpriteUrl(charName: string, state: string): string | null {
    const slug = charSlug(charName)
    const entry = manifest?.characters?.[slug]?.sprites?.[state]
    if (!entry || entry.current < 0 || !entry.versions?.length) return null
    return assetUrl(entry.versions[entry.current].url)
  }

  function getBackgroundUrl(pageNum: number): string | null {
    const entry = manifest?.pages?.[String(pageNum)]?.background
    if (!entry || entry.current < 0 || !entry.versions?.length) return null
    return assetUrl(entry.versions[entry.current].url)
  }

  function getNarrationUrl(pageNum: number): string | null {
    const entry = manifest?.pages?.[String(pageNum)]?.narration
    if (!entry || entry.current < 0 || !entry.versions?.length) return null
    return assetUrl(entry.versions[entry.current].url)
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
          getSpriteUrl={getSpriteUrl}
          getBackgroundUrl={getBackgroundUrl}
          getNarrationUrl={getNarrationUrl}
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

function PagePanel({ page, completedSprites, doneBackgrounds, doneNarrations, getSpriteUrl, getBackgroundUrl, getNarrationUrl }: {
  page: Page
  completedSprites: Set<string>
  doneBackgrounds: Set<number>
  doneNarrations: Set<number>
  getSpriteUrl: (char: string, state: string) => string | null
  getBackgroundUrl: (page: number) => string | null
  getNarrationUrl: (page: number) => string | null
}) {
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
            const url = done ? getSpriteUrl(cs.character, cs.state) : null
            return (
              <div key={cs.character} style={{ textAlign: 'center' }}>
                {url
                  ? <img src={url} alt={cs.state} style={{ height: 80, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.15' }} />
                  : <div style={{ height: 80, width: 60, background: '#1f2937', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#4b5563' }}>Pending</div>
                }
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'capitalize', marginTop: 2 }}>{cs.character.split(' ')[0]}</div>
                <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'capitalize' }}>{cs.state}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Background video */}
      <div style={{ marginBottom: 12 }}>
        <Label>Background Video</Label>
        {doneBackgrounds.has(page.page) && getBackgroundUrl(page.page)
          ? <video src={getBackgroundUrl(page.page)!} style={{ width: '100%', borderRadius: 4, background: 'black' }} controls muted preload="metadata" />
          : <Pending />
        }
      </div>

      {/* Narration */}
      <div style={{ marginBottom: 8 }}>
        <Label>Narration Audio</Label>
        {doneNarrations.has(page.page) && getNarrationUrl(page.page)
          ? <audio src={getNarrationUrl(page.page)!} controls style={{ width: '100%' }} />
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
  return <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{children}</div>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#d1d5db', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
