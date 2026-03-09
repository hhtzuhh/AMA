import { BrowserRouter, Routes, Route, NavLink, useParams } from 'react-router-dom'
import ProjectsPage from './pages/ProjectsPage'
import PipelinePage from './pages/PipelinePage'
import TheaterPage from './pages/TheaterPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/pipeline/:projectId" element={<ProjectLayout><PipelinePage /></ProjectLayout>} />
        <Route path="/theater/:projectId" element={<ProjectLayout><TheaterPage /></ProjectLayout>} />
      </Routes>
    </BrowserRouter>
  )
}

function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px', background: '#111827', borderBottom: '1px solid #374151', fontSize: 14, flexShrink: 0 }}>
        <NavLink to="/" style={{ fontWeight: 'bold', color: 'white', textDecoration: 'none', marginRight: 8 }}>
          ← AMA
        </NavLink>
        <NavLink
          to={`/pipeline/${projectId}`}
          style={({ isActive }) => ({
            padding: '4px 12px', borderRadius: 4, textDecoration: 'none',
            background: isActive ? '#4338ca' : 'transparent',
            color: isActive ? 'white' : '#9ca3af',
          })}
        >
          Pipeline
        </NavLink>
        <NavLink
          to={`/theater/${projectId}`}
          style={({ isActive }) => ({
            padding: '4px 12px', borderRadius: 4, textDecoration: 'none',
            background: isActive ? '#4338ca' : 'transparent',
            color: isActive ? 'white' : '#9ca3af',
          })}
        >
          Theater
        </NavLink>
        <span style={{ marginLeft: 'auto', color: '#4b5563', fontSize: 11, fontFamily: 'monospace' }}>
          {projectId}
        </span>
      </nav>
      {children}
    </div>
  )
}
