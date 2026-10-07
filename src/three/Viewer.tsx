import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import type { Vec3Tuple } from '../types/project';
import { SceneManager } from './SceneManager';
import { setSceneManager } from './sceneHost';

const TOOL_HINTS: Record<string, string> = {
  navigate: 'Drag to orbit · scroll to zoom · right-drag to pan',
  annotate: 'Click the surface to place a note',
};

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const [backend, setBackend] = useState<string>('initializing…');
  const [initError, setInitError] = useState<string | null>(null);

  const annotations = useAppStore((s) => s.annotations);
  const layers = useAppStore((s) => s.layers);
  const pendingPoints = useAppStore((s) => s.pendingPoints);
  const selectedId = useAppStore((s) => s.selectedId);
  const activeTool = useAppStore((s) => s.activeTool);
  const unit = useAppStore((s) => s.unit);

  // Create and initialize the scene manager once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const manager = new SceneManager(container);
    managerRef.current = manager;
    let cancelled = false;
    manager
      .init()
      .then(() => {
        if (cancelled) return;
        setBackend(manager.backendName);
        setSceneManager(manager);
      })
      .catch((err: unknown) => {
        setInitError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      setSceneManager(null);
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  // Sync 3D annotation visuals with store state.
  useEffect(() => {
    managerRef.current?.syncAnnotations(annotations, layers, selectedId, unit);
  }, [annotations, layers, selectedId, unit]);

  // Sync pending (in-progress) tool visuals.
  useEffect(() => {
    managerRef.current?.setPending(pendingPoints, activeTool === 'area');
  }, [pendingPoints, activeTool]);

  // Pointer + keyboard interaction for the tools.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a camera drag
      const state = useAppStore.getState();
      if (!state.hasModel || state.activeTool === 'navigate') return;
      const hit = managerRef.current?.pick(e.clientX, e.clientY);
      if (!hit) return;
      const point: Vec3Tuple = [hit.point.x, hit.point.y, hit.point.z];
      if (state.activeTool === 'annotate') state.addPointAnnotation(point);
      else state.addPendingPoint(point);
    };

    const onDoubleClick = () => {
      const state = useAppStore.getState();
      if (state.activeTool !== 'area') return;
      // The two clicks of the double-click each added a point — drop them.
      state.undoPendingPoint();
      state.undoPendingPoint();
      state.completeArea();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const state = useAppStore.getState();
      switch (e.key) {
        case 'Escape':
          state.clearPending();
          break;
        case 'Enter':
          if (state.activeTool === 'area') state.completeArea();
          break;
        case 'Backspace':
          if (state.pendingPoints.length > 0) {
            e.preventDefault();
            state.undoPendingPoint();
          }
          break;
        case 'v': case 'V': state.setTool('navigate'); break;
        case 'm': case 'M': state.setTool('measure'); break;
        case 'a': case 'A': state.setTool('area'); break;
        case 'n': case 'N': state.setTool('annotate'); break;
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const hint = useMemo(() => {
    if (activeTool === 'measure') {
      return pendingPoints.length === 0 ? 'Measure: click the first point' : 'Measure: click the second point';
    }
    if (activeTool === 'area') {
      return pendingPoints.length < 3
        ? `Area: click outline points (${pendingPoints.length}/3 minimum)`
        : `Area: ${pendingPoints.length} points — Enter / double-click to finish, Backspace to undo, Esc to cancel`;
    }
    return TOOL_HINTS[activeTool] ?? null;
  }, [activeTool, pendingPoints.length]);

  return (
    <div
      ref={containerRef}
      className="viewer"
      style={{ cursor: activeTool === 'navigate' ? 'grab' : 'crosshair' }}
    >
      <div className="viewer-badge" title="Rendering backend">
        {backend}
      </div>
      {hint && <div className="viewer-hint">{hint}</div>}
      {initError && (
        <div className="viewer-error">
          <strong>Renderer failed to start</strong>
          <span>{initError}</span>
        </div>
      )}
    </div>
  );
}
