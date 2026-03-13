/**
 * CameraPage — opens on the phone.
 * Captures camera frames and streams them to the backend relay.
 *
 * URL: /camera/:projectId
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { WS_URL } from '../config'

const FPS = 2           // frames per second sent to backend
const QUALITY = 0.6     // JPEG quality
const WIDTH = 640
const HEIGHT = 480

type Status = 'idle' | 'connecting' | 'streaming' | 'error'

export default function CameraPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [frameCount, setFrameCount] = useState(0)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')

  async function startCamera(facing: 'user' | 'environment') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: WIDTH }, height: { ideal: HEIGHT } },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (e) {
      setStatus('error')
      console.error('Camera error:', e)
    }
  }

  function stopCamera() {
    const video = videoRef.current
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
  }

  function connect() {
    if (!projectId) return
    setStatus('connecting')

    const ws = new WebSocket(`${WS_URL}/api/projects/${projectId}/camera/send`)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('streaming')
      // Start capturing frames
      intervalRef.current = setInterval(() => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas || video.readyState < 2) return
        const ctx = canvas.getContext('2d')!
        canvas.width = video.videoWidth || WIDTH
        canvas.height = video.videoHeight || HEIGHT
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => {
          if (blob && ws.readyState === WebSocket.OPEN) {
            blob.arrayBuffer().then(buf => {
              ws.send(buf)
              setFrameCount(c => c + 1)
            })
          }
        }, 'image/jpeg', QUALITY)
      }, 1000 / FPS)
    }

    ws.onclose = () => {
      setStatus('idle')
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }

    ws.onerror = () => setStatus('error')
  }

  function disconnect() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    wsRef.current?.close()
    wsRef.current = null
    setStatus('idle')
    setFrameCount(0)
  }

  function flipCamera() {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    stopCamera()
    startCamera(next)
  }

  useEffect(() => {
    startCamera(facingMode)
    return () => {
      disconnect()
      stopCamera()
    }
  }, [])

  const statusColor: Record<Status, string> = {
    idle: '#6b7280',
    connecting: '#f59e0b',
    streaming: '#22c55e',
    error: '#ef4444',
  }

  const statusLabel: Record<Status, string> = {
    idle: 'Not streaming',
    connecting: 'Connecting…',
    streaming: `Streaming • ${frameCount} frames`,
    error: 'Error — check console',
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#000', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 16, gap: 16, fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Camera preview */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, borderRadius: 12, overflow: 'hidden', background: '#111' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', display: 'block', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Status badge */}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '4px 10px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor[status] }} />
          <span style={{ color: 'white', fontSize: 11 }}>{statusLabel[status]}</span>
        </div>

        {/* Flip button */}
        <button
          onClick={flipCamera}
          style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 20,
            color: 'white', fontSize: 18, padding: '4px 10px', cursor: 'pointer',
          }}
        >
          🔄
        </button>
      </div>

      {/* Project ID */}
      <div style={{ color: '#4b5563', fontSize: 11, fontFamily: 'monospace' }}>
        project: {projectId}
      </div>

      {/* Connect / Disconnect */}
      {status === 'idle' || status === 'error' ? (
        <button
          onClick={connect}
          style={{
            background: '#22c55e', color: 'white', border: 'none',
            borderRadius: 8, padding: '14px 40px', fontSize: 16,
            fontWeight: 'bold', cursor: 'pointer', width: '100%', maxWidth: 300,
          }}
        >
          ▶ Start Streaming
        </button>
      ) : (
        <button
          onClick={disconnect}
          style={{
            background: '#ef4444', color: 'white', border: 'none',
            borderRadius: 8, padding: '14px 40px', fontSize: 16,
            fontWeight: 'bold', cursor: 'pointer', width: '100%', maxWidth: 300,
          }}
        >
          ■ Stop
        </button>
      )}

      <div style={{ color: '#374151', fontSize: 11, textAlign: 'center' }}>
        Open this page on your phone to stream to the display
      </div>
    </div>
  )
}
