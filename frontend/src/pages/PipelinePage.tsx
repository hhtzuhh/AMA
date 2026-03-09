import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { StoryData, Character } from '../types'
import PageNode, { charSlug } from '../components/pipeline/PageNode'
import NodePanel, { type StageInfo } from '../components/pipeline/NodePanel'
import PipelineToolbar from '../components/pipeline/PipelineToolbar'

const nodeTypes = { page: PageNode }

const PAGE_Y = 0
const PAGES_PER_ROW = 10
const PAGE_GAP_X = 185
const PAGE_GAP_Y = 220
const API = 'http://localhost:8000'

const STAGES: Array<{ id: string; step: string; label: string; script: string; inputLabel: string; outputLabel: string; description: string }> = [
  { id: 'stage_story', step: 'story', label: 'Story Understanding', script: 'test_story_understanding.py', inputLabel: 'PDF', outputLabel: 'story_data.json', description: 'Reads the book PDF and extracts characters, pages, moods, settings, and character states using Gemini.' },
  { id: 'stage_asset', step: 'assets', label: 'Asset Generation', script: 'test_asset_generation.py', inputLabel: 'story_data.json', outputLabel: 'sprites/{char}/{state}.png', description: 'Generates character sprite images for each sprite state using Imagen, then removes backgrounds with rembg.' },
  { id: 'stage_bg', step: 'background', label: 'Background Generation', script: 'test_background_generation.py', inputLabel: 'story_data.json', outputLabel: 'scenes/page_N_bg.mp4', description: 'Generates looping background video for each page using Veo.' },
  { id: 'stage_tts', step: 'tts', label: 'TTS Narrator', script: 'test_tts_narrator.py', inputLabel: 'story_data.json', outputLabel: 'audio/page_N_narration.wav', description: 'Generates narration audio for each page using Google TTS.' },
]

type AnySelected =
  | { type: 'pipelineStage'; data: StageInfo }
  | { type: 'page'; data: { page: StoryData['pages'][0] } }

// "char/state" → list of page node IDs that use this sprite
type SpriteUserMap = Record<string, string[]>

export default function PipelinePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selected, setSelected] = useState<AnySelected | null>(null)
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, string>>({})
  const [pipelineStatus, setPipelineStatus] = useState<Record<string, string>>({})
  const [pdfName, setPdfName] = useState<string>('')
  const [manifest, setManifest] = useState<Record<string, any>>({})

  // Sprite completion: "max/sailing" → true
  const [completedSprites, setCompletedSprites] = useState<Set<string>>(new Set())
  // Currently generating sprite key "max/sailing" or null
  const [currentSprite, setCurrentSprite] = useState<string | null>(null)
  // Page-level background/narration done sets
  const [doneBackgrounds, setDoneBackgrounds] = useState<Set<number>>(new Set())
  const [doneNarrations, setDoneNarrations] = useState<Set<number>>(new Set())

  const [storyCharacters, setStoryCharacters] = useState<Character[]>([])

  // spriteUsers: built from story data
  const spriteUsersRef = useRef<SpriteUserMap>({})
  // active job id per step
  const activeJobsRef = useRef<Record<string, string>>({})
  // job polling intervals
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  const savePositions = useCallback((currentNodes: Node[]) => {
    if (!projectId) return
    const pos: Record<string, { x: number; y: number }> = {}
    currentNodes.forEach((n: Node) => { if (n.id.startsWith('page_')) pos[n.id] = n.position })
    fetch(`${API}/api/projects/${projectId}/positions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pos),
    }).catch(() => {})
  }, [projectId])

  const handleNodesChange = useCallback((changes: any[]) => {
    onNodesChange(changes)
    const hasDragEnd = changes.some(c => c.type === 'position' && c.dragging === false)
    if (hasDragEnd) {
      setTimeout(() => setNodes((current: Node[]) => { savePositions(current); return current }), 0)
    }
  }, [onNodesChange, savePositions, setNodes])

  const savePageEdges = useCallback((currentEdges: Edge[]) => {
    if (!projectId) return
    const pageEdges = currentEdges
      .filter(e => e.source.startsWith('page_') && e.target.startsWith('page_'))
      .map(e => ({
        from: parseInt(e.source.replace('page_', '')),
        to: parseInt(e.target.replace('page_', '')),
        label: (e.data as any)?.label ?? '',
      }))
    fetch(`${API}/api/projects/${projectId}/edges`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edges: pageEdges }),
    }).catch(() => {})
  }, [projectId])

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => {
        const newEdges = addEdge({ ...params, style: { stroke: '#6366f1', strokeWidth: 2.5 } }, eds)
        savePageEdges(newEdges)
        return newEdges
      })
    },
    [setEdges, savePageEdges],
  )

  const handleEdgesChange = useCallback((changes: any[]) => {
    onEdgesChange(changes)
    const hasRemoval = changes.some(c => c.type === 'remove')
    if (hasRemoval) {
      setTimeout(() => {
        setEdges(current => {
          savePageEdges(current)
          return current
        })
      }, 0)
    }
  }, [onEdgesChange, savePageEdges, setEdges])

  // Poll project metadata every 3s
  useEffect(() => {
    if (!projectId) return
    const fetchMeta = () =>
      fetch(`${API}/api/projects/${projectId}`)
        .then(r => r.ok ? r.json() : null)
        .then(meta => {
          if (meta?.pipeline) setPipelineStatus(meta.pipeline)
          if (meta?.pdf_name !== undefined) setPdfName(meta.pdf_name)
        })
        .catch(() => {})
    fetchMeta() // fetch immediately on mount
    const interval = setInterval(fetchMeta, 3000)
    return () => clearInterval(interval)
  }, [projectId])

  // Sync pipelineStatus → nodeStatuses for stage nodes
  const PIPELINE_STATUS_MAP: Record<string, string> = { done: 'Generated', running: 'Running', pending: 'Pending', failed: 'Failed' }
  useEffect(() => {
    setNodeStatuses(prev => {
      const next = { ...prev }
      STAGES.forEach(stage => {
        const s = pipelineStatus[stage.step]
        if (s) next[stage.id] = PIPELINE_STATUS_MAP[s] ?? prev[stage.id]
      })
      return next
    })
  }, [pipelineStatus])

  // Fetch manifest on mount and after each step completes
  const fetchManifest = useCallback(() => {
    if (!projectId) return
    fetch(`${API}/api/projects/${projectId}/manifest`)
      .then(r => r.ok ? r.json() : null)
      .then(m => {
        if (!m) return
        setManifest(m)

        // Derive completion sets from manifest so existing assets show on load
        const sprites = new Set<string>()
        Object.entries(m.characters ?? {}).forEach(([slug, char]: [string, any]) => {
          Object.entries(char.sprites ?? {}).forEach(([state, entry]: [string, any]) => {
            if (entry.current >= 0 && entry.versions?.length) sprites.add(`${slug}/${state}`)
          })
        })
        const bgs = new Set<number>()
        const nars = new Set<number>()
        Object.entries(m.pages ?? {}).forEach(([pageNum, page]: [string, any]) => {
          const n = Number(pageNum)
          if (page.background?.current >= 0 && page.background?.versions?.length) bgs.add(n)
          if (page.narration?.current >= 0 && page.narration?.versions?.length) nars.add(n)
        })
        setCompletedSprites(sprites)
        setDoneBackgrounds(bgs)
        setDoneNarrations(nars)
      })
      .catch(() => {})
  }, [projectId])

  useEffect(() => { fetchManifest() }, [fetchManifest])

  async function runStage(nodeId: string, step: string) {
    if (!projectId) return
    setNodeStatuses(s => ({ ...s, [nodeId]: 'Running' }))
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/pipeline/${step}`, { method: 'POST' })
      const { job_id } = await res.json()
      activeJobsRef.current[step] = job_id
      startPolling(nodeId, job_id, step)
    } catch {
      setNodeStatuses(s => ({ ...s, [nodeId]: 'Failed' }))
    }
  }

  function startPolling(nodeId: string, jobId: string, step: string) {
    // Clear any existing interval for this step
    if (pollIntervalsRef.current[step]) clearInterval(pollIntervalsRef.current[step])

    const seenEvents = new Set<number>()

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/projects/${projectId}/pipeline/jobs/${jobId}`)
        const job = await res.json()

        // Process new events
        job.events?.forEach((event: any, idx: number) => {
          if (seenEvents.has(idx)) return
          seenEvents.add(idx)

          if (event.type === 'sprite' && event.status === 'done') {
            const key = `${event.character}/${event.state}`
            setCompletedSprites(prev => new Set([...prev, key]))
          } else if (event.type === 'background' && event.status === 'done') {
            setDoneBackgrounds(prev => new Set([...prev, event.page]))
          } else if (event.type === 'narration' && event.status === 'done') {
            setDoneNarrations(prev => new Set([...prev, event.page]))
          }
        })

        // Update current generating item
        if (job.current) {
          if (job.current.character) {
            setCurrentSprite(`${job.current.character}/${job.current.state}`)
          }
        } else {
          setCurrentSprite(null)
        }

        if (job.status === 'done') {
          setNodeStatuses(s => ({ ...s, [nodeId]: 'Generated' }))
          clearInterval(interval)
          delete pollIntervalsRef.current[step]
          fetchManifest()
          // After story step → load pages + positions + auto-generate edges
          if (step === 'story') {
            const [storyRes, posRes] = await Promise.all([
              fetch(`${API}/api/projects/${projectId}/story`),
              fetch(`${API}/api/projects/${projectId}/positions`),
            ])
            if (storyRes.ok) {
              const data = await storyRes.json()
              const savedPositions = posRes.ok ? await posRes.json() : {}
              addPageNodes(data, savedPositions)
              // Auto-generate sequential edges for fresh story
              if (data.pages.length > 1) {
                const edgesToUse = data.pages.slice(0, -1).map((p: StoryData['pages'][0], i: number) => ({
                  from: p.page,
                  to: data.pages[i + 1].page,
                  label: '',
                }))
                fetch(`${API}/api/projects/${projectId}/edges`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ edges: edgesToUse }),
                }).catch(() => {})
                setEdges(edgesToUse.map((e: any) => ({
                  id: `e_page_${e.from}_${e.to}`,
                  source: `page_${e.from}`,
                  target: `page_${e.to}`,
                  style: { stroke: '#6366f1', strokeWidth: 2.5 },
                  data: { label: '' },
                })))
              }
            }
          }
        } else if (job.status === 'failed') {
          setNodeStatuses(s => ({ ...s, [nodeId]: 'Failed' }))
          clearInterval(interval)
          delete pollIntervalsRef.current[step]
        }
      } catch {
        clearInterval(interval)
        delete pollIntervalsRef.current[step]
      }
    }, 2000)

    pollIntervalsRef.current[step] = interval
  }

  function buildStageNodes() {
    const initStatuses: Record<string, string> = {}
    STAGES.forEach(stage => { initStatuses[stage.id] = 'Pending' })
    setNodeStatuses(initStatuses)
    setNodes([])
    setEdges([])
  }

  function addPageNodes(data: StoryData, savedPositions: Record<string, { x: number; y: number }> = {}) {
    setStoryCharacters(data.characters ?? [])

    // Build spriteUsers map: "max/sailing" → ["page_21", ...]
    const spriteUsers: SpriteUserMap = {}
    data.pages.forEach(page => {
      page.character_states.forEach(cs => {
        const key = `${charSlug(cs.character)}/${cs.state}`
        if (!spriteUsers[key]) spriteUsers[key] = []
        spriteUsers[key].push(`page_${page.page}`)
      })
    })
    spriteUsersRef.current = spriteUsers

    const pageNodes: Node[] = []

    data.pages.forEach((page, pi) => {
      const pageId = `page_${page.page}`
      const row = Math.floor(pi / PAGES_PER_ROW)
      const col = pi % PAGES_PER_ROW

      pageNodes.push({
        id: pageId,
        type: 'page',
        position: savedPositions[pageId] ?? { x: col * PAGE_GAP_X, y: PAGE_Y + row * PAGE_GAP_Y },
        data: {
          page,
          status: 'Pending',
          onClick: () => setSelected({ type: 'page', data: { page } }),
        },
      })
    })

    setNodeStatuses(s => ({ ...s, stage_story: 'Generated' }))
    setNodes(pageNodes)
    setEdges([])
  }

  async function createCustomPage() {
    if (!projectId) return
    const res = await fetch(`${API}/api/projects/${projectId}/pages`, { method: 'POST' })
    if (!res.ok) return
    const page = await res.json()
    const pageId = `page_${page.page}`
    setNodes(prev => [...prev, {
      id: pageId,
      type: 'page',
      position: { x: 600, y: -100 }, // floats above main grid — orphan
      data: {
        page,
        status: 'Pending',
        onClick: () => setSelected({ type: 'page', data: { page } }),
      },
    }])
    setSelected({ type: 'page', data: { page } })
  }

  function handlePageDeleted(pageNum: number) {
    setNodes(prev => prev.filter(n => n.id !== `page_${pageNum}`))
    setEdges(prev => prev.filter(e => e.source !== `page_${pageNum}` && e.target !== `page_${pageNum}`))
    setSelected(null)
  }

  async function handlePageUpdated() {
    if (!projectId) return
    const [r, posRes] = await Promise.all([
      fetch(`${API}/api/projects/${projectId}/story`),
      fetch(`${API}/api/projects/${projectId}/positions`),
    ])
    if (r.ok) {
      const data = await r.json()
      const savedPositions = posRes.ok ? await posRes.json() : {}
      addPageNodes(data, savedPositions)
      // Update selected node data if a page is selected
      setSelected(prev => {
        if (prev?.type !== 'page') return prev
        const updatedPage = data.pages.find((p: StoryData['pages'][0]) => p.page === prev.data.page.page)
        if (!updatedPage) return prev
        return { type: 'page', data: { page: updatedPage } }
      })
    }
  }

  async function handleUpload(file: File) {
    if (!projectId) return
    const form = new FormData()
    form.append('pdf', file)
    const res = await fetch(`${API}/api/projects/${projectId}/upload-pdf`, { method: 'POST', body: form })
    if (res.ok) {
      const { pdf_name } = await res.json()
      setPdfName(pdf_name)
    }
    // Auto-run story understanding
    runStage('stage_story', 'story')
  }

  useEffect(() => {
    if (!projectId) return
    fetch(`${API}/api/projects/${projectId}/story`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        buildStageNodes()
        if (data) {
          // Load positions and edges in parallel, then build nodes
          Promise.all([
            fetch(`${API}/api/projects/${projectId}/positions`).then(r => r.ok ? r.json() : {}),
            fetch(`${API}/api/projects/${projectId}/edges`).then(r => r.ok ? r.json() : { edges: [] }),
          ]).then(([savedPositions, { edges: savedEdges }]) => {
            addPageNodes(data, savedPositions)
            // Auto-generate sequential edges if none exist
            let edgesToUse = savedEdges
            if (savedEdges.length === 0 && data.pages.length > 1) {
              edgesToUse = data.pages.slice(0, -1).map((p: StoryData['pages'][0], i: number) => ({
                from: p.page,
                to: data.pages[i + 1].page,
                label: '',
              }))
              fetch(`${API}/api/projects/${projectId}/edges`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edges: edgesToUse }),
              }).catch(() => {})
            }
            const rfEdges: Edge[] = edgesToUse.map((e: any) => ({
              id: `e_page_${e.from}_${e.to}`,
              source: `page_${e.from}`,
              target: `page_${e.to}`,
              label: e.label || undefined,
              style: { stroke: '#6366f1', strokeWidth: 2.5 },
              data: { label: e.label ?? '' },
            }))
            setEdges(rfEdges)
          }).catch(() => {})
        }
      })
      .catch(() => buildStageNodes())
  }, [projectId])

  // Build toolbar stage data
  const toolbarStages = STAGES.map(stage => ({
    ...stage,
    status: nodeStatuses[stage.id] ?? 'Pending',
    onRun: () => runStage(stage.id, stage.step),
    onClick: () => setSelected({ type: 'pipelineStage', data: stage }),
  }))

  // Compute per-node display data (all nodes are page nodes now)
  const nodesWithStatus = nodes.map(n => {
    const page = (n.data as any).page
    // Per-character sprite status for this page
    const charSpriteStatus: Record<string, 'done' | 'running' | 'pending'> = {}
    page?.character_states?.forEach((cs: any) => {
      const key = `${charSlug(cs.character)}/${cs.state}`
      if (completedSprites.has(key)) charSpriteStatus[cs.character] = 'done'
      else if (currentSprite === key) charSpriteStatus[cs.character] = 'running'
      else charSpriteStatus[cs.character] = 'pending'
    })

    const pageNum = page?.page
    const bgStatus = doneBackgrounds.has(pageNum) ? 'done' : 'pending'
    const audioStatus = doneNarrations.has(pageNum) ? 'done' : 'pending'

    return {
      ...n,
      data: {
        ...n.data,
        status: nodeStatuses[n.id] ?? (n.data.status as string),
        charSpriteStatus,
        bgStatus,
        audioStatus,
      },
    }
  })


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 41px)' }}>
      <PipelineToolbar stages={toolbarStages} onUpload={handleUpload} pdfName={pdfName} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodesWithStatus}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.15 }}
          style={{ background: '#0f0f1a' }}
        >
          <Background color="#1e1e3f" gap={20} />
          <Controls />
          <MiniMap nodeColor="#6366f1" style={{ background: '#1a1a2e' }} />
          <Panel position="top-left">
            <button
              onClick={createCustomPage}
              style={{ background: '#1e1e3f', border: '1px solid #4b5563', color: '#d1d5db', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              + New Page
            </button>
          </Panel>
        </ReactFlow>
      </div>
      <NodePanel
        selected={selected}
        onClose={() => setSelected(null)}
        pipelineStatus={pipelineStatus}
        manifest={manifest}
        completedSprites={completedSprites}
        doneBackgrounds={doneBackgrounds}
        doneNarrations={doneNarrations}
        onManifestChange={fetchManifest}
        onPageDeleted={handlePageDeleted}
        onPageUpdated={handlePageUpdated}
        characters={storyCharacters}
      />
      </div>
    </div>
  )
}
