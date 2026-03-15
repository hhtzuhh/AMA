import { useEffect, useRef, useState } from 'react'
import type { LiveNodeData } from '../../types'
import { WS_URL } from '../../config'

interface Props {
  projectId: string
  node: LiveNodeData
  onNavigate: (nodeId: string) => void
}

const API_WS = WS_URL
// Output from Gemini Live is 24kHz PCM
const OUTPUT_SAMPLE_RATE = 24000

export default function LiveSession({ projectId, node, onNavigate }: Props) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle')
  const [transcript, setTranscript] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const audioQueueRef = useRef<ArrayBuffer[]>([])
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const pendingNavRef = useRef<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { startSession() }, 1000)
    return () => { clearTimeout(t); cleanup() }
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
  }

  async function startSession() {
    setStatus('connecting')
    setTranscript('')

    try {
      // Set up WebSocket
      const ws = new WebSocket(`${API_WS}/api/projects/${projectId}/live/${node.id}`)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onopen = async () => {
        setStatus('active')
        await startMic(ws)
      }

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Raw PCM audio from AI — queue and play
          audioQueueRef.current.push(event.data)
          playNextChunk()
        } else {
          const msg = JSON.parse(event.data as string)
          if (msg.type === 'interrupted') {
            // AI was interrupted by child speaking — discard buffered audio immediately
            clearAudioQueue()
          } else if (msg.type === 'navigate') {
            // Store pending nav — execute only once audio queue is fully drained
            pendingNavRef.current = msg.node_id as string
          } else if (msg.type === 'transcript') {
            setTranscript(prev => prev + (msg.text as string))
          } else if (msg.type === 'error') {
            setStatus('error')
            setTranscript(msg.message as string)
          }
        }
      }

      ws.onclose = () => {
        setStatus(prev => (prev !== 'error' ? 'idle' : prev))
      }

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

    // Inline AudioWorklet processor — buffers to ~40ms chunks before sending
    const processorCode = `
      class PcmProcessor extends AudioWorkletProcessor {
        constructor() {
          super()
          this._buf = []
          this._bufLen = 0
          // 40ms @ 16kHz = 640 samples
          this._targetLen = 640
        }
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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(e.data)
      }
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

  const statusColor = { idle: '#6b7280', connecting: '#f59e0b', active: '#22c55e', error: '#ef4444' }[status]

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      {/* Transcript bubble */}
      {transcript && (
        <div style={{
          background: 'rgba(0,0,0,0.7)', color: '#f3f4f6', borderRadius: 10,
          padding: '8px 12px', maxWidth: 260, textAlign: 'right',
          fontSize: 13, lineHeight: 1.5,
          border: '1px solid rgba(168,85,247,0.4)',
        }}>
          {transcript}
        </div>
      )}

      {/* Indicator row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: statusColor, fontFamily: 'monospace' }}>
          {status === 'idle' ? 'tap to talk' : status === 'connecting' ? 'connecting…' : status === 'active' ? 'listening' : 'error'}
        </span>
        <div
          onClick={status === 'idle' ? startSession : stopSession}
          style={{
            width: 28, height: 28, borderRadius: 50,
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}99`,
            cursor: 'pointer',
            animation: status === 'active' ? 'pulse 1.5s infinite' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: 'white',
          }}
        >
          {status === 'idle' ? '🎤' : status === 'connecting' ? '⏳' : status === 'error' ? '✕' : ''}
        </div>
      </div>
    </div>
  )
}
