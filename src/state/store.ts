import { create } from 'zustand';
import {
  DEFAULT_LAYERS,
  LAYER_COLOR_PALETTE,
  distance3D,
  kindName,
  polygonArea3D,
  uid,
  type Annotation,
  type AnnotationKind,
  type DamageLayer,
  type ProjectData,
  type Tool,
  type Vec3Tuple,
} from '../types/project';

export interface AppState {
  projectName: string;
  unit: string;
  createdAt: string;
  hasModel: boolean;
  modelName: string | null;
  layers: DamageLayer[];
  annotations: Annotation[];
  activeTool: Tool;
  pendingPoints: Vec3Tuple[];
  selectedId: string | null;

  newProject: (name?: string) => void;
  loadProject: (data: ProjectData) => void;
  setModelLoaded: (name: string) => void;
  setProjectName: (name: string) => void;
  setUnit: (unit: string) => void;
  setTool: (tool: Tool) => void;
  selectAnnotation: (id: string | null) => void;

  addPendingPoint: (p: Vec3Tuple) => void;
  undoPendingPoint: () => void;
  clearPending: () => void;
  completeArea: () => void;
  addPointAnnotation: (p: Vec3Tuple) => void;

  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, 'label' | 'notes' | 'layerId'>>) => void;
  removeAnnotation: (id: string) => void;

  addLayer: (name: string, color?: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<DamageLayer, 'id'>>) => void;
  removeLayer: (id: string) => void;
}

function makeDefaultLayers(): DamageLayer[] {
  return DEFAULT_LAYERS.map((layer) => ({ ...layer, id: uid() }));
}

export const useAppStore = create<AppState>()((set, get) => {
  const createAnnotation = (kind: AnnotationKind, points: Vec3Tuple[]): void => {
    const state = get();
    if (state.layers.length === 0) return;
    const count = state.annotations.filter((a) => a.kind === kind).length + 1;
    const preferredLayer =
      kind === 'point'
        ? (state.layers.find((l) => /general|note/i.test(l.name)) ?? state.layers[0])
        : state.layers[0];
    const annotation: Annotation = {
      id: uid(),
      layerId: preferredLayer.id,
      kind,
      label: `${kindName(kind)} ${count}`,
      notes: '',
      points,
      createdAt: new Date().toISOString(),
    };
    if (kind === 'measure' && points.length >= 2) {
      annotation.distance = distance3D(points[0], points[1]);
    }
    if (kind === 'area') {
      annotation.area = polygonArea3D(points);
    }
    set({ annotations: [...state.annotations, annotation], selectedId: annotation.id });
  };

  return {
    projectName: 'Untitled project',
    unit: 'm',
    createdAt: new Date().toISOString(),
    hasModel: false,
    modelName: null,
    layers: [],
    annotations: [],
    activeTool: 'navigate',
    pendingPoints: [],
    selectedId: null,

    newProject: (name = 'Untitled project') =>
      set({
        projectName: name,
        unit: 'm',
        createdAt: new Date().toISOString(),
        hasModel: false,
        modelName: null,
        layers: makeDefaultLayers(),
        annotations: [],
        activeTool: 'navigate',
        pendingPoints: [],
        selectedId: null,
      }),

    loadProject: (data) =>
      set({
        projectName: data.name,
        unit: data.unit,
        createdAt: data.createdAt,
        hasModel: true,
        modelName: data.modelFile,
        layers: data.layers,
        annotations: data.annotations,
        activeTool: 'navigate',
        pendingPoints: [],
        selectedId: null,
      }),

    setModelLoaded: (name) => set({ hasModel: true, modelName: name }),
    setProjectName: (projectName) => set({ projectName }),
    setUnit: (unit) => set({ unit }),

    setTool: (activeTool) => set({ activeTool, pendingPoints: [] }),
    selectAnnotation: (selectedId) => set({ selectedId }),

    addPendingPoint: (p) => {
      const state = get();
      const points = [...state.pendingPoints, p];
      if (state.activeTool === 'measure' && points.length >= 2) {
        set({ pendingPoints: [] });
        createAnnotation('measure', points.slice(0, 2));
      } else {
        set({ pendingPoints: points });
      }
    },

    undoPendingPoint: () => set((state) => ({ pendingPoints: state.pendingPoints.slice(0, -1) })),
    clearPending: () => set({ pendingPoints: [] }),

    completeArea: () => {
      const state = get();
      if (state.activeTool !== 'area' || state.pendingPoints.length < 3) return;
      createAnnotation('area', state.pendingPoints);
      set({ pendingPoints: [] });
    },

    addPointAnnotation: (p) => createAnnotation('point', [p]),

    updateAnnotation: (id, patch) =>
      set((state) => ({
        annotations: state.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      })),

    removeAnnotation: (id) =>
      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      })),

    addLayer: (name, color) =>
      set((state) => ({
        layers: [
          ...state.layers,
          {
            id: uid(),
            name: name.trim() || `Layer ${state.layers.length + 1}`,
            color: color ?? LAYER_COLOR_PALETTE[state.layers.length % LAYER_COLOR_PALETTE.length],
            visible: true,
          },
        ],
      })),

    updateLayer: (id, patch) =>
      set((state) => ({
        layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })),

    removeLayer: (id) => {
      const state = get();
      const count = state.annotations.filter((a) => a.layerId === id).length;
      if (count > 0 && !window.confirm(`Delete this layer and its ${count} annotation(s)?`)) return;
      const removedSelection = state.annotations.some((a) => a.id === state.selectedId && a.layerId === id);
      set({
        layers: state.layers.filter((l) => l.id !== id),
        annotations: state.annotations.filter((a) => a.layerId !== id),
        selectedId: removedSelection ? null : state.selectedId,
      });
    },
  };
});
