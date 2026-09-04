import { useMap, type DrawMode } from '../hooks/useMap'

interface ToolButton {
  mode: DrawMode
  label: string
  title: string
}

const TOOLS: ToolButton[] = [
  { mode: 'bbox', label: '▢', title: 'Draw bounding box' },
  { mode: 'polygon', label: '⬡', title: 'Draw polygon' },
  { mode: 'line', label: '∕', title: 'Draw line (for elevation profile)' },
  { mode: 'weather-pin', label: '🌦', title: 'Drop weather pin (click map to get forecast)' },
]

/**
 * Floating toolbar for area/line selection tools + terrain toggles.
 */
export function DrawTools() {
  const { drawMode, setDrawMode, clearSelection, terrain3d, toggleTerrain3d, hillshade, toggleHillshade } = useMap()

  return (
    <div className="draw-tools">
      {TOOLS.map((tool) => (
        <button
          key={tool.mode}
          className={`draw-tool-btn ${drawMode === tool.mode ? 'active' : ''}`}
          onClick={() => setDrawMode(drawMode === tool.mode ? 'none' : tool.mode)}
          title={tool.title}
        >
          {tool.label}
        </button>
      ))}
      <div className="tool-divider" />
      <button
        className={`draw-tool-btn ${hillshade ? 'active' : ''}`}
        onClick={toggleHillshade}
        title="Toggle hillshade (2D terrain shading)"
      >
        ⛰
      </button>
      <button
        className={`draw-tool-btn ${terrain3d ? 'active' : ''}`}
        onClick={toggleTerrain3d}
        title="Toggle 3D terrain"
      >
        3D
      </button>
      <div className="tool-divider" />
      <button
        className="draw-tool-btn clear"
        onClick={clearSelection}
        title="Clear selection"
      >
        ✕
      </button>
    </div>
  )
}
