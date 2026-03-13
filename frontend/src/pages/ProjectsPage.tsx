import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { API_URL as API } from '../config'

interface Project {
  project_id: string
  pdf_name: string
  pipeline: Record<string, string>
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [mockMode, setMockMode] = useState<boolean | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => r.json())
      .then(data => setMockMode(data.mock_mode))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`${API}/api/projects`)
      .then(r => r.json())
      .then(data => { setProjects(data); setLoading(false) })
      .catch(() => { setError('Backend not running — start it on :8000'); setLoading(false) })
  }, [])

  async function createProject() {
    setCreating(true)
    try {
      const res = await fetch(`${API}/api/projects`, { method: 'POST' })
      const project = await res.json()
      navigate(`/pipeline/${project.project_id}`)
    } catch {
      setError('Failed to create project')
      setCreating(false)
    }
  }

  function pipelineProgress(pipeline: Record<string, string>) {
    const steps = ['story', 'assets', 'background', 'tts']
    const done = steps.filter(s => pipeline[s] === 'done').length
    return { done, total: steps.length }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center py-16 px-4">
      <h1 className="text-3xl font-bold mb-2">AMA</h1>
      <p className="text-gray-400 mb-4 text-sm">AI-powered interactive projection theater</p>

      {/* Backend mode badge */}
      {mockMode !== null && (
        <div className={`mb-8 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 ${
          mockMode
            ? 'bg-yellow-900/50 border border-yellow-700 text-yellow-300'
            : 'bg-green-900/50 border border-green-700 text-green-300'
        }`}>
          <span className={`w-2 h-2 rounded-full ${mockMode ? 'bg-yellow-400' : 'bg-green-400'}`} />
          {mockMode ? 'Mock Mode — no real AI calls' : 'Live Mode — real AI generation'}
        </div>
      )}

      {/* New project */}
      <div
        onClick={() => !creating && createProject()}
        className="w-full max-w-lg border-2 border-dashed border-indigo-600 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-950/30 transition-colors mb-10"
      >
        <p className="text-2xl mb-2">＋</p>
        <p className="text-indigo-300 font-medium">{creating ? 'Creating...' : 'New Project'}</p>
        <p className="text-gray-500 text-xs mt-1">Opens a blank canvas — upload a PDF or build manually</p>
      </div>

      {/* Error */}
      {error && <p className="text-red-400 text-sm mb-6">{error}</p>}

      {/* Existing projects */}
      {loading
        ? <p className="text-gray-500 text-sm">Loading projects...</p>
        : projects.length === 0
          ? <p className="text-gray-600 text-sm">No projects yet — upload a PDF to get started.</p>
          : (
            <div className="w-full max-w-lg space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Previous Projects</p>
              {projects.map(p => {
                const { done, total } = pipelineProgress(p.pipeline)
                return (
                  <div
                    key={p.project_id}
                    onClick={() => navigate(`/pipeline/${p.project_id}`)}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 cursor-pointer hover:border-indigo-500 hover:bg-gray-800 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{p.pdf_name}</p>
                      <p className="text-xs text-gray-500 font-mono mt-0.5">{p.project_id}</p>
                    </div>
                    <div className="text-right">
                      <PipelineDots pipeline={p.pipeline} />
                      <p className="text-xs text-gray-500 mt-1">{done}/{total} steps</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )
      }
    </div>
  )
}

function PipelineDots({ pipeline }: { pipeline: Record<string, string> }) {
  const steps = ['story', 'assets', 'background', 'tts']
  const colors: Record<string, string> = {
    done: 'bg-green-500',
    running: 'bg-yellow-400 animate-pulse',
    pending: 'bg-gray-600',
  }
  return (
    <div className="flex gap-1 justify-end">
      {steps.map(s => (
        <span key={s} className={`w-2 h-2 rounded-full ${colors[pipeline[s]] ?? 'bg-gray-600'}`} title={s} />
      ))}
    </div>
  )
}
