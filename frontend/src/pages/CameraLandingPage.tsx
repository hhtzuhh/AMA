/**
 * CameraLandingPage — phone-friendly project picker.
 * Open on phone: /camera  →  tap a project  →  /camera/:projectId (streaming starts)
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_URL } from '../config'

interface Project {
  project_id: string
  pdf_name: string
}

export default function CameraLandingPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`${API_URL}/api/projects`)
      .then(r => r.json())
      .then(setProjects)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ padding: '32px 24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
        <h1 style={{ color: 'white', fontSize: 22, fontWeight: 'bold', margin: 0 }}>AMA Camera</h1>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>Select a project to start streaming</p>
      </div>

      {/* Project list */}
      <div style={{ flex: 1, padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && (
          <div style={{ color: '#4b5563', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
            Loading projects…
          </div>
        )}
        {!loading && projects.length === 0 && (
          <div style={{ color: '#4b5563', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
            No projects found
          </div>
        )}
        {projects.map(p => (
          <button
            key={p.project_id}
            onClick={() => navigate(`/camera/${p.project_id}`)}
            style={{
              background: '#1e293b', border: '1px solid #334155',
              borderRadius: 12, padding: '18px 20px',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 4, cursor: 'pointer', textAlign: 'left', width: '100%',
            }}
          >
            <span style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>
              {p.pdf_name || 'Untitled'}
            </span>
            <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>
              {p.project_id}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
