import JSZip from 'jszip';
import {
  PROJECT_EXTENSION,
  PROJECT_VERSION,
  type Annotation,
  type DamageLayer,
  type ProjectData,
} from '../types/project';

// ---- in-memory reference to the currently loaded model file ----------------

let modelBlob: Blob | null = null;
let modelFileName: string | null = null;

export function setModelSource(blob: Blob, name: string): void {
  modelBlob = blob;
  modelFileName = name;
}

export function getModelSource(): { blob: Blob | null; name: string | null } {
  return { blob: modelBlob, name: modelFileName };
}

// ---- serialization ----------------------------------------------------------

export interface SerializableState {
  projectName: string;
  unit: string;
  createdAt: string;
  modelName: string | null;
  layers: DamageLayer[];
  annotations: Annotation[];
}

export function serializeProject(state: SerializableState): ProjectData {
  return {
    version: PROJECT_VERSION,
    name: state.projectName,
    unit: state.unit,
    createdAt: state.createdAt,
    modelFile: modelFileName ?? state.modelName,
    layers: state.layers,
    annotations: state.annotations,
  };
}

// ---- save -------------------------------------------------------------------

export async function saveProjectToFile(data: ProjectData): Promise<void> {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(data, null, 2));
  if (modelBlob && modelFileName) {
    zip.file(`model/${modelFileName}`, modelBlob);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(blob, `${sanitizeFileName(data.name)}${PROJECT_EXTENSION}`);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w\- ]+/g, '').trim();
  return cleaned || 'project';
}

// ---- open -------------------------------------------------------------------

export interface OpenedProject {
  data: ProjectData;
  modelBlob: Blob;
  modelName: string;
}

export async function openProjectFile(file: File): Promise<OpenedProject> {
  const zip = await JSZip.loadAsync(file);
  const jsonEntry = zip.file('project.json');
  if (!jsonEntry) throw new Error('Not a valid project file: project.json is missing.');

  const data = JSON.parse(await jsonEntry.async('string')) as ProjectData;
  validateProject(data);

  if (!data.modelFile) throw new Error('Project file does not reference a model.');
  const modelEntry = zip.file(`model/${data.modelFile}`);
  if (!modelEntry) throw new Error(`Model "${data.modelFile}" is missing from the project package.`);
  const blob = await modelEntry.async('blob');

  setModelSource(blob, data.modelFile);
  return { data, modelBlob: blob, modelName: data.modelFile };
}

function validateProject(data: ProjectData): void {
  if (data.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version "${String(data.version)}".`);
  }
  if (!Array.isArray(data.layers) || !Array.isArray(data.annotations)) {
    throw new Error('Corrupt project file: layers or annotations missing.');
  }
}
