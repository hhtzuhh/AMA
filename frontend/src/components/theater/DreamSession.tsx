import { useEffect, useRef, useState } from 'react'
import type { DreamNodeData } from '../../types'
import { WS_URL } from '../../config'

interface Props {
  projectId: string
  node: DreamNodeData
  onNavigate: (nodeId: string) => void
}

interface DreamPanel {
  text: string
  imageUrl: string | null
}

const OUTPUT_SAMPLE_RATE = 24000

export default function DreamSession({ projectId, node, onNavigate }: Props) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle')
  const [transcript, setTranscript] = useState('')
  const [panels, setPanels] = useState<DreamPanel[]>([])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [generating, setGenerating] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const audioQueueRef = useRef<ArrayBuffer[]>([])
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const pendingNavRef = useRef<string | null>(null)
  const dreamDoneRef = useRef(false)
  const dreamImageUrlsRef = useRef<string[]>([])
  const slideTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => { cleanup() }
  }, [])

  function cleanup() {
    wsRef.current?.close()
    wsRef.current = null
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current = null
    workletNodeRef.current?.disconnect()
    workletNodeRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    dreamImageUrlsRef.current.forEach(u => URL.revokeObjectURL(u))
    dreamImageUrlsRef.current = []
    if (slideTimerRef.current) { clearInterval(slideTimerRef.current); slideTimerRef.current = null }
    dreamDoneRef.current = false
  }

  async function startSession() {
    setStatus('connecting')
    setTranscript('')
    setPanels([])
    dreamDoneRef.current = false
    dreamImageUrlsRef.current.forEach(u => URL.revokeObjectURL(u))
    dreamImageUrlsRef.current = []
    setGenerating(false)

    try {
      const ws = new WebSocket(`${WS_URL}/api/projects/${projectId}/dream/${node.id}`)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onopen = async () => {
        setStatus('active')
        await startMic(ws)
      }

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          audioQueueRef.current.push(event.data)
          playNextChunk()
        } else {
          const msg = JSON.parse(event.data as string)
          if (msg.type === 'interrupted') {
            clearAudioQueue()
          } else if (msg.type === 'navigate') {
            pendingNavRef.current = msg.node_id as string
          } else if (msg.type === 'transcript') {
            setTranscript(msg.text as string)
          } else if (msg.type === 'dream_start') {
            setGenerating(true)
            setPanels([])
            setCurrentSlide(0)
          } else if (msg.type === 'dream_text') {
            // Each text chunk starts a new panel, auto-advance to it
            setPanels(prev => {
              setCurrentSlide(prev.length)
              return [...prev, { text: msg.text as string, imageUrl: null }]
            })
          } else if (msg.type === 'dream_image') {
            const byteStr = atob(msg.data as string)
            const bytes = new Uint8Array(byteStr.length)
            for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i)
            const blob = new Blob([bytes], { type: msg.mime as string })
            const url = URL.createObjectURL(blob)
            dreamImageUrlsRef.current.push(url)
            // Attach image to the last panel
            setPanels(prev => {
              if (prev.length === 0) return prev
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], imageUrl: url }
              return updated
            })
          } else if (msg.type === 'dream_done') {
            setGenerating(false)
            dreamDoneRef.current = true
            // Navigation fires from playNextChunk when narrator audio finishes
            // Fallback: navigate after 12s in case Gemini doesn't produce audio
            slideTimerRef.current = setTimeout(() => {
              slideTimerRef.current = null
              if (!dreamDoneRef.current) return
              const nodeId = pendingNavRef.current
              pendingNavRef.current = null
              dreamDoneRef.current = false
              setPanels([])
              setCurrentSlide(0)
              if (nodeId) onNavigate(nodeId)
            }, 12000) as unknown as ReturnType<typeof setInterval>
          } else if (msg.type === 'dream_error') {
            setGenerating(false)
            dreamDoneRef.current = false
            if (slideTimerRef.current) { clearTimeout(slideTimerRef.current as unknown as ReturnType<typeof setTimeout>); slideTimerRef.current = null }
          } else if (msg.type === 'error') {
            setStatus('error')
          }
        }
      }

      ws.onclose = () => setStatus(prev => prev !== 'error' ? 'idle' : prev)
      ws.onerror = () => setStatus('error')
    } catch (_e) {
      setStatus('error')
    }
  }

  async function startMic(ws: WebSocket) {
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioCtxRef.current = ctx
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    micStreamRef.current = stream

    const processorCode = `
      class PcmProcessor extends AudioWorkletProcessor {
        constructor() { super(); this._buf = []; this._bufLen = 0; this._targetLen = 640 }
        process(inputs) {
          const input = inputs[0]?.[0]
          if (!input) return true
          for (let i = 0; i < input.length; i++) {
            this._buf.push(Math.max(-32768, Math.min(32767, input[i] * 32768)))
          }
          this._bufLen += input.length
          if (this._bufLen >= this._targetLen) {
            const pcm = new Int16Array(this._buf.splice(0, this._targetLen))
            this._bufLen -= this._targetLen
            this.port.postMessage(pcm.buffer, [pcm.buffer])
          }
          return true
        }
      }
      registerProcessor('pcm-recorder', PcmProcessor)
    `
    const blob = new Blob([processorCode], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    await ctx.audioWorklet.addModule(blobUrl)
    URL.revokeObjectURL(blobUrl)

    const source = ctx.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(ctx, 'pcm-recorder')
    workletNodeRef.current = worklet
    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data)
    }
    source.connect(worklet)
  }

  function clearAudioQueue() {
    audioQueueRef.current = []
    currentSourceRef.current?.stop()
    currentSourceRef.current = null
    isPlayingRef.current = false
    // pendingNavRef is intentionally NOT cleared here — dream slide navigation owns it
  }

  function playNextChunk() {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return
    const ctx = audioCtxRef.current
    if (!ctx) return

    isPlayingRef.current = true
    const buffer = audioQueueRef.current.shift()!
    const pcm = new Int16Array(buffer)
    const float = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768

    const audioBuffer = ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE)
    audioBuffer.copyToChannel(float, 0)
    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)
    currentSourceRef.current = source
    source.onended = () => {
      isPlayingRef.current = false
      currentSourceRef.current = null
      // If narrator finished and no more audio — navigate
      if (audioQueueRef.current.length === 0 && dreamDoneRef.current && pendingNavRef.current) {
        if (slideTimerRef.current) { clearTimeout(slideTimerRef.current as unknown as ReturnType<typeof setTimeout>); slideTimerRef.current = null }
        const nodeId = pendingNavRef.current
        pendingNavRef.current = null
        dreamDoneRef.current = false
        setPanels([])
        setCurrentSlide(0)
        onNavigate(nodeId)
        return
      }
      playNextChunk()
    }
    source.start()
  }

  function stopSession() {
    wsRef.current?.send(JSON.stringify({ type: 'close' }))
    cleanup()
    setStatus('idle')
  }

  const statusColor = { idle: '#6b7280', connecting: '#f59e0b', active: '#2dd4bf', error: '#ef4444' }[status]

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-end" style={{ zIndex: 10, padding: '0 0 80px 0' }}>

      {/* Dream slideshow overlay */}
      {(panels.length > 0 || generating) && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.88)',
          zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '24px 16px',
        }}>
          {generating && panels.length === 0 ? (
            <div style={{ color: '#2dd4bf', fontSize: 14, fontFamily: 'monospace' }}>
              ✨ Creating your dream…
            </div>
          ) : panels.length > 0 && (() => {
            const panel = panels[0]
            return (
              <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                {/* Image or spinner */}
                {panel.imageUrl ? (
                  <img
                    src={panel.imageUrl}
                    alt="dream scene"
                    style={{
                      width: '100%', borderRadius: 12,
                      boxShadow: '0 0 40px #2dd4bf55',
                      border: '2px solid #2dd4bf33',
                    }}
                  />
                ) : (
                  <div style={{
                    width: '100%', aspectRatio: '16/9', borderRadius: 12,
                    background: 'rgba(13,148,136,0.08)', border: '1px dashed #0d9488',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#0d9488', fontSize: 12, fontFamily: 'monospace',
                  }}>
                    ✨ painting…
                  </div>
                )}

                {/* Narration */}
                <div style={{
                  textAlign: 'center', color: '#f3f4f6',
                  background: 'rgba(0,0,0,0.6)', borderRadius: 10,
                  padding: '10px 20px', fontSize: 15, lineHeight: 1.6,
                  border: '1px solid #2dd4bf22', width: '100%',
                }}>
                  {panel.text}
                </div>

                {!generating && (
                  <button
                    onClick={() => { setPanels([]); setCurrentSlide(0) }}
                    style={{
                      background: 'transparent', color: '#6b7280',
                      border: '1px solid #374151', borderRadius: 6,
                      padding: '3px 12px', fontSize: 11, cursor: 'pointer', marginTop: 4,
                    }}
                  >Close</button>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Transcript */}
      {transcript && panels.length === 0 && (
        <div style={{
          background: 'rgba(0,0,0,0.7)', color: '#f3f4f6', borderRadius: 12,
          padding: '10px 18px', maxWidth: '60%', textAlign: 'center',
          fontSize: 15, lineHeight: 1.5, marginBottom: 20,
          border: '1px solid rgba(45,212,191,0.4)',
        }}>
          {transcript}
        </div>
      )}

      {/* Control button */}
      {status === 'idle' ? (
        <button
          onClick={startSession}
          style={{
            background: '#0d9488', color: 'white', border: 'none',
            borderRadius: 50, width: 64, height: 64, fontSize: 28,
            cursor: 'pointer', boxShadow: '0 0 20px #0d948888',
          }}
        >
          ✨
        </button>
      ) : (
        <button
          onClick={stopSession}
          style={{
            background: statusColor, color: 'white', border: 'none',
            borderRadius: 50, width: 64, height: 64, fontSize: 22,
            cursor: 'pointer', boxShadow: `0 0 20px ${statusColor}88`,
            animation: status === 'active' ? 'pulse 1.5s infinite' : 'none',
          }}
        >
          {status === 'connecting' ? '⏳' : status === 'error' ? '✕' : '■'}
        </button>
      )}

      <div style={{ fontSize: 11, color: statusColor, marginTop: 8, fontFamily: 'monospace' }}>
        {status === 'idle' ? 'Tap to dream'
          : status === 'connecting' ? 'Connecting…'
          : status === 'active' ? (generating ? `Dreaming… (${panels.length}/3)` : 'Listening…')
          : 'Error'}
      </div>
    </div>
  )
}
