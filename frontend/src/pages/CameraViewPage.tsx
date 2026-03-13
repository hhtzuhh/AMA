/**
 * CameraViewPage — standalone test page for the display side.
 * Shows what the phone camera is streaming.
 *
 * URL: /camera-view/:projectId
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_URL, WS_URL } from '../config'

export default function CameraViewPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const imgRef = useRef<HTMLImageElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  const [frameCount, setFrameCount] = useState(0)

  useEffect(() => {
    if (!projectId) return

    const ws = new WebSocket(`${WS_URL}/api/projects/${projectId}/camera/view`)
    wsRef.current = ws

    ws.binaryType = 'blob'

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (evt) => {
      if (!(evt.data instanceof Blob)) return
      const url = URL.createObjectURL(evt.data)
      if (imgRef.current) {
        // Revoke previous URL to avoid memory leak
        const prev = imgRef.current.src
        imgRef.current.src = url
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      }
      setHasCamera(true)
      setFrameCount(c => c + 1)
    }

    return () => { ws.close(); wsRef.current = null }
  }, [projectId])

  // Poll camera status
  useEffect(() => {
    if (!projectId) return
    const t = setInterval(async () => {
      const r = await fetch(`${API_URL}/api/projects/${projectId}/camera/status`)
      const { connected: c } = await r.json()
      if (!c) setHasCamera(false)
    }, 3000)
    return () => clearInterval(t)
  }, [projectId])

  const cameraUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port}/camera/${projectId}`

  return (
    <div style={{
      minHeight: '100vh', background: '#000', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Frame display */}
      <div style={{
        position: 'relative', width: '100%', maxWidth: 720,
        background: '#111', borderRadius: 12, overflow: 'hidden',
        aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasCamera ? (
          <img
            ref={imgRef}
            alt="camera"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div style={{ textAlign: 'center', color: '#4b5563' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 14 }}>Waiting for phone camera…</div>
          </div>
        )}

        {/* Status badges */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
          <div style={{
            background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#22c55e' : '#6b7280' }} />
            <span style={{ color: 'white', fontSize: 11 }}>{connected ? 'Display connected' : 'Disconnected'}</span>
          </div>
          {hasCamera && (
            <div style={{
              background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '4px 10px',
              color: '#fbbf24', fontSize: 11,
            }}>
              📡 {frameCount} frames
            </div>
          )}
        </div>
      </div>

      {/* Camera URL for phone */}
      <div style={{
        background: '#111827', border: '1px solid #374151', borderRadius: 8,
        padding: '12px 16px', maxWidth: 720, width: '100%',
      }}>
        <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>Open this URL on your phone:</div>
        <div style={{
          color: '#60a5fa', fontSize: 13, fontFamily: 'monospace',
          wordBreak: 'break-all', userSelect: 'all',
        }}>
          {cameraUrl}
        </div>
        <div style={{ color: '#4b5563', fontSize: 10, marginTop: 6 }}>
          Phone must be on the same WiFi network
        </div>
      </div>
    </div>
  )
}
