import { Crosshair, Eye, EyeOff, MapPin, Pentagon, Plus, Ruler, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useAppStore } from '../state/store';
import { getSceneManager } from '../three/sceneHost';
import { formatValue, kindName, type Annotation } from '../types/project';

const KIND_ICONS = { point: MapPin, measure: Ruler, area: Pentagon } as const;

function annotationValueText(a: Annotation, unit: string): string | null {
  if (a.kind === 'measure' && a.distance !== undefined) return `${formatValue(a.distance)} ${unit}`;
  if (a.kind === 'area' && a.area !== undefined) return `${formatValue(a.area)} ${unit}²`;
  return null;
}

export function SidePanel() {
  const layers = useAppStore((s) => s.layers);
  const annotations = useAppStore((s) => s.annotations);
  const selectedId = useAppStore((s) => s.selectedId);
  const unit = useAppStore((s) => s.unit);
  const hasModel = useAppStore((s) => s.hasModel);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const addLayer = useAppStore((s) => s.addLayer);
  const selectAnnotation = useAppStore((s) => s.selectAnnotation);

  const [newLayerName, setNewLayerName] = useState('');

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  const focusAnnotation = (a: Annotation) => {
    selectAnnotation(a.id);
    getSceneManager()?.focusOn(a.points);
  };

  const commitNewLayer = () => {
    if (!newLayerName.trim()) return;
    addLayer(newLayerName);
    setNewLayerName('');
  };

  return (
    <aside className="side-panel">
      <section>
        <h2>Damage layers</h2>
        <ul className="layer-list">
          {layers.map((layer) => {
            const count = annotations.filter((a) => a.layerId === layer.id).length;
            return (
              <li key={layer.id} className="layer-row">
                <input
                  type="color"
                  value={layer.color}
                  onChange={(e) => updateLayer(layer.id, { color: e.target.value })}
                  title="Layer color"
                  aria-label={`Color for ${layer.name}`}
                />
                <input
                  className="layer-name"
                  defaultValue={layer.name}
                  title="Layer name"
                  aria-label="Layer name"
                  onBlur={(e) => updateLayer(layer.id, { name: e.target.value.trim() || layer.name })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <span className="layer-count">{count}</span>
                <button
                  className="icon-btn"
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                >
                  {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button className="icon-btn danger" title="Delete layer" onClick={() => removeLayer(layer.id)}>
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="add-layer">
          <input
            placeholder="New damage layer…"
            value={newLayerName}
            disabled={!hasModel}
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') commitNewLayer();
            }}
          />
          <button className="icon-btn" title="Add layer" disabled={!hasModel} onClick={commitNewLayer}>
            <Plus size={16} />
          </button>
        </div>
      </section>

      <section className="annotations-section">
        <h2>Annotations</h2>
        {annotations.length === 0 && (
          <p className="empty-hint">No annotations yet. Use the measure, area or note tools on the model.</p>
        )}
        <div className="anno-list">
          {layers.map((layer) => {
            const items = annotations.filter((a) => a.layerId === layer.id);
            if (items.length === 0) return null;
            return (
              <div key={layer.id} className="anno-group">
                <div className="anno-group-header">
                  <span className="swatch" style={{ background: layer.color }} />
                  {layer.name}
                </div>
                {items.map((a) => {
                  const Icon = KIND_ICONS[a.kind];
                  const value = annotationValueText(a, unit);
                  return (
                    <button
                      key={a.id}
                      className={`anno-row${a.id === selectedId ? ' selected' : ''}`}
                      onClick={() => focusAnnotation(a)}
                    >
                      <Icon size={14} />
                      <span className="anno-label-text">{a.label}</span>
                      {value && <span className="anno-value">{value}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      {selected && <AnnotationEditor annotation={selected} />}
    </aside>
  );
}

function AnnotationEditor({ annotation }: { annotation: Annotation }) {
  const layers = useAppStore((s) => s.layers);
  const unit = useAppStore((s) => s.unit);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const value = annotationValueText(annotation, unit);

  return (
    <section className="editor">
      <h2>{kindName(annotation.kind)} details</h2>
      {value && <div className="editor-value">{value}</div>}
      <label>
        Label
        <input
          value={annotation.label}
          onChange={(e) => updateAnnotation(annotation.id, { label: e.target.value })}
        />
      </label>
      <label>
        Layer
        <select
          value={annotation.layerId}
          onChange={(e) => updateAnnotation(annotation.id, { layerId: e.target.value })}
        >
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notes
        <textarea
          rows={4}
          placeholder="Condition, material, planned treatment…"
          value={annotation.notes}
          onChange={(e) => updateAnnotation(annotation.id, { notes: e.target.value })}
        />
      </label>
      <div className="editor-meta">Created {new Date(annotation.createdAt).toLocaleString()}</div>
      <div className="editor-actions">
        <button className="btn" onClick={() => getSceneManager()?.focusOn(annotation.points)}>
          <Crosshair size={14} /> Focus
        </button>
        <button className="btn danger" onClick={() => removeAnnotation(annotation.id)}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </section>
  );
}
