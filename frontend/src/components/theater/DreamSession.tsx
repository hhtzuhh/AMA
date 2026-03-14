import { useEffect, useRef, useState } from 'react'
import type { DreamNodeData } from '../../types'
import { WS_URL } from '../../config'

interface Props {
  projectId: string
  node: DreamNodeData
  onNavigate: (nodeId: string) => void
}

interface DreamResult {
  text: string
  imageUrl: string | null   // object URL of the generated image
  description: string
}

const OUTPUT_SAMPLE_RATE = 24000

export default function DreamSession({ projectId, node, onNavigate }: Props) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle')
  const [transcript, setTranscript] = useState('')
  const [dream, setDream] = useState<DreamResult | null>(null)
  const [generating, setGenerating] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const audioQueueRef = useRef<ArrayBuffer[]>([])
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const pendingNavRef = useRef<string | null>(null)
  const dreamImageUrlRef = useRef<string | null>(null)

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
    if (dreamImageUrlRef.current) {
      URL.revokeObjectURL(dreamImageUrlRef.current)
      dreamImageUrlRef.current = null
    }
  }

  async function startSession() {
    setStatus('connecting')
    setTranscript('')
    setDream(null)

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
            setTranscript(prev => prev + (msg.text as string))
          } else if (msg.type === 'dream_start') {
            setGenerating(true)
            setDream({ text: '', imageUrl: null, description: msg.description as string })
          } else if (msg.type === 'dream_text') {
            setDream(prev => prev ? { ...prev, text: prev.text + (msg.text as string) } : null)
          } else if (msg.type === 'dream_image') {
            // Decode base64 → blob URL
            const byteStr = atob(msg.data as string)
            const bytes = new Uint8Array(byteStr.length)
            for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i)
            const blob = new Blob([bytes], { type: msg.mime as string })
            if (dreamImageUrlRef.current) URL.revokeObjectURL(dreamImageUrlRef.current)
            const url = URL.createObjectURL(blob)
            dreamImageUrlRef.current = url
            setDream(prev => prev ? { ...prev, imageUrl: url } : null)
          } else if (msg.type === 'dream_done') {
            setGenerating(false)
          } else if (msg.type === 'dream_error') {
            setGenerating(false)
            console.error('[dream] generation error:', msg.message)
          } else if (msg.type === 'error') {
            setStatus('error')
            setTranscript(msg.message as string)
          }
        }
      }

      ws.onclose = () => {
        setStatus(prev => prev !== 'error' ? 'idle' : prev)
      }
      ws.onerror = () => setStatus('error')
    } catch (_e) {
      setStatus('error')
    }
  }

  async function startMic(ws: WebSocket) {
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioCtxRef.current = ctx
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
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
    pendingNavRef.current = null
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
      if (audioQueueRef.current.length === 0 && pendingNavRef.current) {
        const nodeId = pendingNavRef.current
        pendingNavRef.current = null
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

      {/* Dream overlay — generated image + text */}
      {dream && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)',
          zIndex: 20,
          animation: 'fadeIn 0.5s ease',
        }}>
          {generating && !dream.imageUrl && (
            <div style={{ color: '#2dd4bf', fontSize: 14, marginBottom: 16, fontFamily: 'monospace' }}>
              ✨ Creating your dream…
            </div>
          )}
          {dream.imageUrl && (
            <img
              src={dream.imageUrl}
              alt="dream"
              style={{
                maxWidth: '70%', maxHeight: '65%', borderRadius: 12,
                boxShadow: '0 0 40px #2dd4bf66',
                border: '2px solid #2dd4bf44',
              }}
            />
          )}
          {dream.text && (
            <div style={{
              marginTop: 16, maxWidth: '60%', textAlign: 'center',
              background: 'rgba(0,0,0,0.7)', color: '#f3f4f6',
              borderRadius: 10, padding: '10px 18px', fontSize: 15, lineHeight: 1.5,
              border: '1px solid #2dd4bf44',
            }}>
              {dream.text}
            </div>
          )}
          {!generating && (
            <button
              onClick={() => setDream(null)}
              style={{
                marginTop: 16, background: 'transparent', color: '#9ca3af',
                border: '1px solid #374151', borderRadius: 6,
                padding: '4px 14px', fontSize: 11, cursor: 'pointer',
              }}
            >
              Close
            </button>
          )}
        </div>
      )}

      {/* Transcript */}
      {transcript && !dream && (
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
        {status === 'idle' ? 'Tap to dream' : status === 'connecting' ? 'Connecting…' : status === 'active' ? generating ? 'Dreaming…' : 'Listening…' : 'Error'}
      </div>
    </div>
  )
}
