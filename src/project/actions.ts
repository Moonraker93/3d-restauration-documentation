import { useAppStore } from '../state/store';
import { getSceneManager, whenSceneReady } from '../three/sceneHost';
import { loadModelFromBlob } from '../three/loadModel';
import { openProjectFile, saveProjectToFile, serializeProject, setModelSource } from './saveLoad';
import { exportReport } from './report';

/** Create a fresh project from a raw 3D model file picked by the user. */
export async function createProjectFromModel(file: File): Promise<void> {
  const manager = await whenSceneReady();
  const object = await loadModelFromBlob(file, file.name);
  setModelSource(file, file.name);
  useAppStore.getState().newProject(file.name.replace(/\.[^.]+$/, ''));
  manager.setModel(object);
  useAppStore.getState().setModelLoaded(file.name);
}

/** Open a .a3d project package (model + layers + annotations). */
export async function openProjectPackage(file: File): Promise<void> {
  const manager = await whenSceneReady();
  const { data, modelBlob, modelName } = await openProjectFile(file);
  const object = await loadModelFromBlob(modelBlob, modelName);
  manager.setModel(object);
  useAppStore.getState().loadProject(data);
}

/** Save the current project (model + all annotation state) as a .a3d file. */
export async function saveCurrentProject(): Promise<void> {
  const state = useAppStore.getState();
  await saveProjectToFile(serializeProject(state));
}

/** Export the PDF condition report with the current viewport as screenshot. */
export function exportCurrentReport(): void {
  const state = useAppStore.getState();
  const screenshot = getSceneManager()?.screenshot() ?? null;
  exportReport({
    projectName: state.projectName,
    unit: state.unit,
    modelName: state.modelName,
    layers: state.layers,
    annotations: state.annotations,
    screenshot,
  });
}

/** Open a file picker and resolve with the chosen file (or null on cancel). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
