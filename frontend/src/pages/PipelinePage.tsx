import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { StoryData } from '../types'
import PipelineStageNode from '../components/pipeline/PipelineStageNode'
import PageNode, { charSlug } from '../components/pipeline/PageNode'
import NodePanel, { type StageInfo } from '../components/pipeline/NodePanel'

const nodeTypes = { pipelineStage: PipelineStageNode, page: PageNode }

const STAGE_GAP = 280
const STAGE_Y = 0
const PAGE_Y = 280
const PAGES_PER_ROW = 10
const PAGE_GAP_X = 165
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
  const [pagesCollapsed, setPagesCollapsed] = useState(false)
  const [totalPages, setTotalPages] = useState(0)
  const [pipelineStatus, setPipelineStatus] = useState<Record<string, string>>({})
  const [manifest, setManifest] = useState<Record<string, any>>({})

  // Sprite completion: "max/sailing" → true
  const [completedSprites, setCompletedSprites] = useState<Set<string>>(new Set())
  // Currently generating sprite key "max/sailing" or null
  const [currentSprite, setCurrentSprite] = useState<string | null>(null)
  // Page-level background/narration done sets
  const [doneBackgrounds, setDoneBackgrounds] = useState<Set<number>>(new Set())
  const [doneNarrations, setDoneNarrations] = useState<Set<number>>(new Set())

  // spriteUsers: built from story data
  const spriteUsersRef = useRef<SpriteUserMap>({})
  // active job id per step
  const activeJobsRef = useRef<Record<string, string>>({})
  // job polling intervals
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges],
  )

  // Poll project metadata every 3s
  useEffect(() => {
    if (!projectId) return
    const interval = setInterval(() => {
      fetch(`${API}/api/projects/${projectId}`)
        .then(r => r.ok ? r.json() : null)
        .then(meta => { if (meta?.pipeline) setPipelineStatus(meta.pipeline) })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [projectId])

  // Fetch manifest on mount and after each step completes
  const fetchManifest = useCallback(() => {
    if (!projectId) return
    fetch(`${API}/api/projects/${projectId}/manifest`)
      .then(r => r.ok ? r.json() : null)
      .then(m => { if (m) setManifest(m) })
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
          // After story step → load pages
          if (step === 'story') {
            const r = await fetch(`${API}/api/projects/${projectId}/story`)
            if (r.ok) addPageNodes(await r.json())
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
    const newNodes: Node[] = []
    const newEdges: Edge[] = []
    const initStatuses: Record<string, string> = {}

    STAGES.forEach((stage, i) => {
      initStatuses[stage.id] = 'Pending'
      newNodes.push({
        id: stage.id,
        type: 'pipelineStage',
        position: { x: i * STAGE_GAP, y: STAGE_Y },
        data: {
          ...stage,
          status: 'Pending',
          onRun: () => runStage(stage.id, stage.step),
          onClick: () => setSelected({ type: 'pipelineStage', data: stage }),
        },
      })
      if (i > 0) {
        newEdges.push({
          id: `e_stage_${i - 1}_${i}`,
          source: STAGES[i - 1].id,
          target: stage.id,
          style: { stroke: '#6366f1', strokeWidth: 2 },
        })
      }
    })

    setNodeStatuses(initStatuses)
    setNodes(newNodes)
    setEdges(newEdges)
  }

  function addPageNodes(data: StoryData) {
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
    const pageEdges: Edge[] = []

    data.pages.forEach((page, pi) => {
      const pageId = `page_${page.page}`
      const row = Math.floor(pi / PAGES_PER_ROW)
      const col = pi % PAGES_PER_ROW

      pageNodes.push({
        id: pageId,
        type: 'page',
        position: { x: col * PAGE_GAP_X, y: PAGE_Y + row * PAGE_GAP_Y },
        data: {
          page,
          status: 'Pending',
          onClick: () => setSelected({ type: 'page', data: { page } }),
        },
      })

      if (pi > 0) {
        const prevId = `page_${data.pages[pi - 1].page}`
        pageEdges.push({
          id: `e_${prevId}_${pageId}`,
          source: prevId,
          target: pageId,
          style: { stroke: '#374151', strokeWidth: 1 },
        })
      }
    })

    pageEdges.push({
      id: 'e_story_pages',
      source: 'stage_story',
      sourceHandle: 'bottom',
      target: `page_${data.pages[0].page}`,
      animated: true,
      style: { stroke: '#6366f1', strokeDasharray: '5 3' },
    })

    setTotalPages(data.pages.length)
    setNodeStatuses(s => ({ ...s, stage_story: 'Generated' }))
    setNodes(prev => [...prev.filter(n => n.id.startsWith('stage_')), ...pageNodes])
    setEdges(prev => [...prev.filter(e => e.id.startsWith('e_stage')), ...pageEdges])
  }

  useEffect(() => {
    if (!projectId) return
    fetch(`${API}/api/projects/${projectId}/story`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        buildStageNodes()
        if (data) addPageNodes(data)
      })
      .catch(() => buildStageNodes())
  }, [projectId])

  // Compute per-node display data
  const nodesWithStatus = nodes.map(n => {
    const isPageNode = n.id.startsWith('page_')
    if (!isPageNode) {
      return {
        ...n,
        hidden: false,
        data: { ...n.data, status: nodeStatuses[n.id] ?? (n.data.status as string) },
      }
    }

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
      hidden: pagesCollapsed,
      data: {
        ...n.data,
        status: nodeStatuses[n.id] ?? (n.data.status as string),
        charSpriteStatus,
        bgStatus,
        audioStatus,
      },
    }
  })

  const edgesWithVisibility = edges.map(e => ({
    ...e,
    hidden: (e.source.startsWith('page_') || e.target.startsWith('page_')) ? pagesCollapsed : false,
  }))

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 41px)' }}>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodesWithStatus}
          edges={edgesWithVisibility}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          style={{ background: '#0f0f1a' }}
        >
          <Background color="#1e1e3f" gap={20} />
          <Controls />
          <MiniMap nodeColor="#6366f1" style={{ background: '#1a1a2e' }} />
          {totalPages > 0 && (
            <Panel position="top-right">
              <button
                onClick={() => setPagesCollapsed(c => !c)}
                style={{ background: '#1e1e3f', border: '1px solid #4b5563', color: '#d1d5db', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
              >
                {pagesCollapsed ? `▶ Show Pages (${totalPages})` : `▼ Collapse Pages`}
              </button>
            </Panel>
          )}
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
      />
    </div>
  )
}
