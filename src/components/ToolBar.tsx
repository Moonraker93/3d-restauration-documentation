import { Hand, MapPin, Pentagon, Ruler, Spline } from 'lucide-react';
import { useAppStore } from '../state/store';
import type { Tool } from '../types/project';

const TOOLS: Array<{ id: Tool; label: string; shortcut: string; icon: typeof Hand }> = [
  { id: 'navigate', label: 'Navigate (orbit / zoom / pan)', shortcut: 'V', icon: Hand },
  { id: 'measure', label: 'Measure point-to-point distance', shortcut: 'M', icon: Ruler },
  { id: 'path', label: 'Measure along an open line / crack (2+ points, Enter to finish)', shortcut: 'P', icon: Spline },
  { id: 'area', label: 'Map an area (3+ points, Enter to finish)', shortcut: 'A', icon: Pentagon },
  { id: 'annotate', label: 'Add point annotation', shortcut: 'N', icon: MapPin },
];

export function ToolBar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setTool = useAppStore((s) => s.setTool);
  const hasModel = useAppStore((s) => s.hasModel);

  return (
    <nav className="toolbar" aria-label="Annotation tools">
      {TOOLS.map(({ id, label, shortcut, icon: Icon }) => (
        <button
          key={id}
          className={`tool-btn${activeTool === id ? ' active' : ''}`}
          title={`${label} (${shortcut})`}
          aria-label={label}
          aria-pressed={activeTool === id}
          disabled={!hasModel && id !== 'navigate'}
          onClick={() => setTool(id)}
        >
          <Icon size={20} />
        </button>
      ))}
    </nav>
  );
}
