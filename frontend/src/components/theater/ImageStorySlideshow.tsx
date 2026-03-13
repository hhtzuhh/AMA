import { useEffect, useRef, useState } from 'react'
import type { ImageStoryNodeData } from '../../types'

const API = 'http://localhost:8000'
const FALLBACK_DURATION_MS = 5000   // used when no audio or metadata fails to load

interface Props {
  projectId: string
  node: ImageStoryNodeData
  onDone: () => void
  triggerReplay?: number
}

const KB_ANIMATIONS = ['kenBurns_0', 'kenBurns_1', 'kenBurns_2', 'kenBurns_3']

export default function ImageStorySlideshow({ projectId, node, onDone }: Props) {
  const shots = node.shots ?? []
  const kenBurns = node.ken_burns

  const [shotIndex, setShotIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const [shotDuration, setShotDuration] = useState(FALLBACK_DURATION_MS)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function clearTimer() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }

  useEffect(() => {
    if (shots.length === 0) return

    const numShots = shots.length
    const shot = shots[shotIndex]

    function advance() {
      stopAudio()
      if (shotIndex < numShots - 1) {
        setVisible(false)
        timerRef.current = setTimeout(() => {
          setShotIndex(i => i + 1)
          setVisible(true)
        }, 400)
      } else {
        onDone()
      }
    }

    let cancelled = false

    if (shot?.nar_url) {
      const url = `${API}/api/projects/${projectId}/assets/${shot.nar_url}`
      const audio = new Audio(url)
      audioRef.current = audio

      const metaFallbackId = setTimeout(() => {
        if (cancelled) return
        audio.play().catch(() => {})
        setShotDuration(FALLBACK_DURATION_MS)
        timerRef.current = setTimeout(advance, FALLBACK_DURATION_MS)
      }, 3000)

      audio.addEventListener('loadedmetadata', () => {
        if (cancelled) return
        clearTimeout(metaFallbackId)
        const durationMs = Math.ceil(audio.duration * 1000)
        setShotDuration(durationMs)
        audio.play().catch(() => {})
        timerRef.current = setTimeout(advance, durationMs + 300)
      })

      audio.addEventListener('error', () => {
        if (cancelled) return
        clearTimeout(metaFallbackId)
        setShotDuration(FALLBACK_DURATION_MS)
        timerRef.current = setTimeout(advance, FALLBACK_DURATION_MS)
      })

      audio.load()
    } else {
      setShotDuration(FALLBACK_DURATION_MS)
      timerRef.current = setTimeout(advance, FALLBACK_DURATION_MS)
    }

    return () => {
      cancelled = true
      clearTimer()
      stopAudio()
    }
  }, [shotIndex])

  if (shots.length === 0) {
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#0f0800',
        color: '#78716c', fontFamily: 'monospace', fontSize: 13,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
        <div>{node.label || 'Image Story'}</div>
        <div style={{ fontSize: 11, color: '#57534e', marginTop: 6 }}>No shots generated yet</div>
      </div>
    )
  }

  const shot = shots[shotIndex]
  const imgUrl = `${API}/api/projects/${projectId}/assets/${shot.image_url}`
  const kbAnim = KB_ANIMATIONS[shotIndex % KB_ANIMATIONS.length]

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' }}>
      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes kenBurns_0 { from { transform: scale(1) translate(0%,0%) } to { transform: scale(1.15) translate(-3%,-2%) } }
        @keyframes kenBurns_1 { from { transform: scale(1.1) translate(-2%,0%) } to { transform: scale(1) translate(0%,0%) } }
        @keyframes kenBurns_2 { from { transform: scale(1) translate(0%,-1%) } to { transform: scale(1.15) translate(3%,1%) } }
        @keyframes kenBurns_3 { from { transform: scale(1.1) translate(2%,0%) } to { transform: scale(1) translate(0%,2%) } }
      `}</style>

      {/* Key on both shotIndex AND shotDuration so animation restarts with correct duration once metadata loads */}
      <img
        key={`shot_${shotIndex}_${shotDuration}`}
        src={imgUrl}
        alt={shot.prompt}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          opacity: visible ? 1 : 0,
          transition: visible ? 'none' : 'opacity 0.4s ease',
          animation: kenBurns
            ? `${kbAnim} ${shotDuration}ms ease-in-out forwards`
            : 'fadeIn 0.5s ease forwards',
        }}
        onError={e => { (e.target as HTMLImageElement).style.opacity = '0.1' }}
      />

      {shot.prompt && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '28px 24px 14px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)',
          color: 'rgba(255,255,255,0.88)', fontSize: 13, fontStyle: 'italic',
          fontFamily: 'Georgia, serif', lineHeight: 1.5,
          pointerEvents: 'none',
        }}>
          {shot.prompt}
        </div>
      )}

      {shots.length > 1 && (
        <div style={{ position: 'absolute', bottom: 10, right: 14, display: 'flex', gap: 5 }}>
          {shots.map((_, i) => (
            <div
              key={i}
              onClick={() => { clearTimer(); stopAudio(); setShotIndex(i); setVisible(true) }}
              style={{
                width: i === shotIndex ? 18 : 6, height: 6, borderRadius: 3,
                background: i === shotIndex ? '#fbbf24' : 'rgba(255,255,255,0.3)',
                cursor: 'pointer', transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
