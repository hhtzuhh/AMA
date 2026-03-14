import { useState } from 'react'
import { API_URL as API } from '../../config'

interface Props {
  projectId: string
  onDone: () => void   // called after nodes are created — pipeline reloads
}

type Step = 'input' | 'previewing' | 'preview_done' | 'generating' | 'done'

interface CreatedNode { node_id: string; label: string }
interface CharRef { name: string; slug: string; visual_description?: string }

export default function StudioPanel({ projectId, onDone }: Props) {
  const [step, setStep] = useState<Step>('input')
  const [storyText, setStoryText] = useState('')
  const [styleHints, setStyleHints] = useState('')
  const [styleGuide, setStyleGuide] = useState('')
  const [previewImg, setPreviewImg] = useState<string | null>(null)
  const [previewMime, setPreviewMime] = useState('image/png')
  const [previewB64Raw, setPreviewB64Raw] = useState('')
  const [planNodes, setPlanNodes] = useState<{ label: string }[]>([])
  const [createdNodes, setCreatedNodes] = useState<CreatedNode[]>([])
  const [charRefs, setCharRefs] = useState<CharRef[]>([])
  const [regenSlug, setRegenSlug] = useState<string | null>(null)
  // cache-busting timestamps per slug so img re-fetches after regen
  const [refTimestamps, setRefTimestamps] = useState<Record<string, number>>({})
  const [error, setError] = useState('')

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#111827', border: '1px solid #374151',
    color: '#d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 13,
    boxSizing: 'border-box', resize: 'vertical',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1,
    display: 'block', marginBottom: 4, marginTop: 12,
  }
  const btnStyle = (color: string, disabled = false): React.CSSProperties => ({
    background: disabled ? '#374151' : color, color: 'white', border: 'none',
    borderRadius: 6, padding: '8px 16px', fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer', width: '100%', marginTop: 10,
  })

  async function previewStyle() {
    if (!storyText.trim()) { setError('Paste your story first.'); return }
    setError('')
    setStep('previewing')
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/studio/preview-style`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_text: storyText, style_hints: styleHints }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setStyleGuide(data.style_guide || '')
      setPreviewB64Raw(data.image_b64 || '')
      setPreviewMime(data.image_mime || 'image/png')
      setPreviewImg(data.image_b64 ? `data:${data.image_mime || 'image/png'};base64,${data.image_b64}` : null)
      if (!data.image_b64) setError('Style guide extracted but no image was generated. You can still proceed.')
      setStep('preview_done')
    } catch (e: any) {
      setError(e.message)
      setStep('input')
    }
  }

  async function generateStory() {
    setStep('generating')
    setCreatedNodes([])
    setPlanNodes([])
    setCharRefs([])
    setRefTimestamps({})
    setError('')
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/studio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_text: storyText,
          style_guide: styleGuide,
          preview_b64: previewB64Raw,
          preview_mime: previewMime,
        }),
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()!
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const msg = JSON.parse(line.slice(6))
          if (msg.type === 'plan') {
            setPlanNodes(msg.nodes)
            // stash visual_description per char from plan
            const charMap: Record<string, string> = {}
            for (const c of msg.characters ?? []) charMap[c.name] = c.visual_description ?? ''
            // store temporarily for regen use
            ;(window as any).__studioCharDescs = charMap
          } else if (msg.type === 'char_ref') {
            setCharRefs(prev => [...prev, { name: msg.name, slug: msg.slug }])
            setRefTimestamps(prev => ({ ...prev, [msg.slug]: Date.now() }))
          } else if (msg.type === 'node_created') {
            setCreatedNodes(prev => [...prev, { node_id: msg.node_id, label: msg.label }])
          } else if (msg.type === 'done') {
            setStep('done')
          } else if (msg.type === 'error') {
            setError(msg.message)
            setStep('preview_done')
          }
        }
      }
    } catch (e: any) {
      setError(e.message)
      setStep('preview_done')
    }
  }

  async function regenChar(char: CharRef) {
    setRegenSlug(char.slug)
    try {
      const charDescs: Record<string, string> = (window as any).__studioCharDescs ?? {}
      const res = await fetch(`${API}/api/projects/${projectId}/studio/characters/${char.slug}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style_guide: styleGuide,
          visual_description: charDescs[char.name] ?? char.name,
          preview_b64: previewB64Raw,
          preview_mime: previewMime,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // bump timestamp so the img re-fetches
      setRefTimestamps(prev => ({ ...prev, [char.slug]: Date.now() }))
    } catch (e: any) {
      setError(`Regen failed for ${char.name}: ${e.message}`)
    } finally {
      setRegenSlug(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>🪄</span>
        <h2 style={{ color: '#f9fafb', fontSize: 14, fontWeight: 'bold', margin: 0 }}>AI Story Studio</h2>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>

        {/* Input step */}
        {(step === 'input' || step === 'previewing') && (
          <>
            <label style={labelStyle}>Your Story</label>
            <textarea
              style={{ ...inputStyle, minHeight: 140 }}
              placeholder="Paste or write your story here. Can be a summary, a full text, or even just 'Three Little Pigs, 4 scenes'."
              value={storyText}
              onChange={e => setStoryText(e.target.value)}
            />
            <label style={labelStyle}>Art Style (optional)</label>
            <input
              style={{ ...inputStyle, resize: undefined } as React.CSSProperties}
              placeholder="e.g. Pixar style, warm colors, painterly — or leave blank"
              value={styleHints}
              onChange={e => setStyleHints(e.target.value)}
            />
            <button
              style={btnStyle('#6366f1', step === 'previewing')}
              disabled={step === 'previewing'}
              onClick={previewStyle}
            >
              {step === 'previewing' ? '✨ Generating style preview…' : '✨ Preview Style'}
            </button>
          </>
        )}

        {/* Style preview + generation */}
        {(step === 'preview_done' || step === 'generating' || step === 'done') && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Style Preview</div>
              {previewImg ? (
                <img
                  src={previewImg}
                  alt="style preview"
                  style={{ width: '100%', borderRadius: 8, border: '1px solid #374151', display: 'block' }}
                  onError={() => setError('Image failed to render. The style guide was still extracted.')}
                />
              ) : (
                <div style={{ background: '#1f2937', borderRadius: 8, padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 12, border: '1px dashed #374151' }}>
                  No preview image — style guide was extracted from text only
                </div>
              )}
            </div>
            <label style={labelStyle}>Extracted Style Guide</label>
            <textarea
              style={{ ...inputStyle, minHeight: 72, fontSize: 11 }}
              value={styleGuide}
              onChange={e => setStyleGuide(e.target.value)}
            />
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
              Edit if needed — this gets injected into every scene prompt.
            </div>

            {step === 'preview_done' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button
                  style={{ ...btnStyle('#374151'), width: 'auto', flex: 1 }}
                  onClick={() => setStep('input')}
                >
                  ← Try again
                </button>
                <button
                  style={{ ...btnStyle('#10b981'), flex: 2 }}
                  onClick={generateStory}
                >
                  Generate Story Nodes →
                </button>
              </div>
            )}

            {/* Generation progress */}
            {(step === 'generating' || step === 'done') && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  {step === 'done' ? `✓ ${createdNodes.length} nodes created` : `Creating nodes…`}
                </div>

                {/* Character refs with preview + regen */}
                {charRefs.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Characters</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {charRefs.map(c => {
                        const ts = refTimestamps[c.slug] ?? 0
                        const imgUrl = `${API}/api/projects/${projectId}/assets/refs/${c.slug}_ref.png?t=${ts}`
                        const isRegening = regenSlug === c.slug
                        return (
                          <div key={c.slug} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: '#0d1117', borderRadius: 8, padding: '6px 8px',
                            border: '1px solid #1f2937',
                          }}>
                            <img
                              src={imgUrl}
                              alt={c.name}
                              style={{
                                width: 48, height: 64, objectFit: 'cover',
                                borderRadius: 4, flexShrink: 0,
                                background: '#1f2937',
                              }}
                              onError={e => { (e.target as HTMLImageElement).style.opacity = '0.2' }}
                              onLoad={e => { (e.target as HTMLImageElement).style.opacity = '1' }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: '#f9fafb', fontWeight: 'bold' }}>{c.name}</div>
                              <div style={{ fontSize: 10, color: '#6b7280' }}>{c.slug}</div>
                            </div>
                            <button
                              onClick={() => regenChar(c)}
                              disabled={isRegening || regenSlug !== null}
                              style={{
                                fontSize: 10, padding: '4px 8px', borderRadius: 4,
                                background: isRegening ? '#374151' : '#1e293b',
                                color: isRegening ? '#9ca3af' : '#a78bfa',
                                border: '1px solid #4c1d95',
                                cursor: isRegening || regenSlug !== null ? 'not-allowed' : 'pointer',
                                flexShrink: 0,
                              }}
                            >
                              {isRegening ? '⏳' : '↺ Regen'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Scene nodes progress */}
                {planNodes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {planNodes.map((n, i) => {
                      const created = createdNodes[i]
                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: '#111827', borderRadius: 6, padding: '6px 10px',
                          border: `1px solid ${created ? '#10b981' : '#374151'}`,
                        }}>
                          <span style={{ fontSize: 12 }}>{created ? '✓' : step === 'generating' && i === createdNodes.length ? '⏳' : '○'}</span>
                          <span style={{ fontSize: 12, color: created ? '#10b981' : '#6b7280' }}>{n.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {step === 'done' && (
                  <button style={{ ...btnStyle('#6366f1'), marginTop: 14 }} onClick={onDone}>
                    Open in Pipeline →
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <div style={{ marginTop: 10, color: '#ef4444', fontSize: 12, background: '#1f0a0a', borderRadius: 6, padding: '6px 10px' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
