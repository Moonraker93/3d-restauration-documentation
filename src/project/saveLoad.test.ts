// @vitest-environment jsdom
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_VERSION, type Annotation, type DamageLayer, type ProjectData } from '../types/project';
import type { SerializableState } from './saveLoad';

type SaveLoadModule = typeof import('./saveLoad');

/**
 * `saveLoad` keeps the packaged model in module-level state, so each test gets a
 * pristine copy of the module instead of leaking the previous test's model.
 */
async function freshModule(): Promise<SaveLoadModule> {
  vi.resetModules();
  return import('./saveLoad');
}

const layer: DamageLayer = { id: 'l1', name: 'Cracks', color: '#ef4444', visible: true };

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    layerId: 'l1',
    kind: 'measure',
    label: 'Measurement 1',
    notes: 'hairline',
    points: [
      [0, 0, 0],
      [3, 4, 0],
    ],
    distance: 5,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseState(overrides: Partial<SerializableState> = {}): SerializableState {
  return {
    projectName: 'Elephant torso',
    unit: 'cm',
    createdAt: '2024-01-01T00:00:00.000Z',
    modelName: 'scan.ply',
    layers: [layer],
    annotations: [annotation()],
    ...overrides,
  };
}

/** Build a `.a3d`-shaped File straight from JSZip (used for the error cases). */
async function projectFile(files: Record<string, string | Blob>): Promise<File> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'broken.a3d');
}

function projectJson(patch: Partial<ProjectData>): string {
  const data: ProjectData = {
    version: PROJECT_VERSION,
    name: 'Broken',
    unit: 'm',
    createdAt: '2024-01-01T00:00:00.000Z',
    modelFile: 'model.ply',
    layers: [layer],
    annotations: [],
    ...patch,
  };
  return JSON.stringify(data);
}

describe('saveLoad', () => {
  let downloads: { blob: Blob; fileName: string }[];

  beforeEach(() => {
    downloads = [];
    // jsdom implements neither createObjectURL nor anchor navigation; capture both.
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (blob) => {
      downloads.push({ blob, fileName: '' });
      return 'blob:mock-object-url';
    };
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (downloads.length > 0) downloads[downloads.length - 1].fileName = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('serializeProject', () => {
    it('packages the serializable state into a versioned project', async () => {
      const { serializeProject } = await freshModule();
      const state = baseState();
      const data = serializeProject(state);

      expect(data.version).toBe(PROJECT_VERSION);
      expect(data.name).toBe('Elephant torso');
      expect(data.unit).toBe('cm');
      expect(data.createdAt).toBe(state.createdAt);
      expect(data.layers).toEqual([layer]);
      expect(data.annotations).toEqual([annotation()]);
    });

    it('falls back to the state model name when no model source is registered', async () => {
      const { serializeProject } = await freshModule();
      expect(serializeProject(baseState()).modelFile).toBe('scan.ply');
    });

    it('prefers the registered model source name over the state model name', async () => {
      const { serializeProject, setModelSource } = await freshModule();
      setModelSource(new Blob(['ply']), 'loaded.ply');
      const data = serializeProject(baseState({ modelName: 'stale-name.ply' }));
      expect(data.modelFile).toBe('loaded.ply');
    });

    it('leaves modelFile null when neither source nor state name is known', async () => {
      const { serializeProject } = await freshModule();
      expect(serializeProject(baseState({ modelName: null })).modelFile).toBeNull();
    });
  });

  describe('saveProjectToFile', () => {
    it('writes project.json plus the model and downloads a sanitized .a3d file', async () => {
      const { saveProjectToFile, serializeProject, setModelSource } = await freshModule();
      setModelSource(new Blob(['model-bytes']), 'scan.ply');

      await saveProjectToFile(serializeProject(baseState({ projectName: 'Torso: front/back?' })));

      expect(downloads).toHaveLength(1);
      expect(downloads[0].fileName).toBe('Torso frontback.a3d');

      const zip = await JSZip.loadAsync(downloads[0].blob);
      // JSZip also emits the implicit "model/" folder entry; ignore directory entries.
      const entries = Object.keys(zip.files).filter((name) => !name.endsWith('/'));
      expect(entries.sort()).toEqual(['model/scan.ply', 'project.json']);
      expect(await zip.file('model/scan.ply')!.async('string')).toBe('model-bytes');
    });

    it('omits the model entry when no model is loaded', async () => {
      const { saveProjectToFile, serializeProject } = await freshModule();
      await saveProjectToFile(serializeProject(baseState()));

      const zip = await JSZip.loadAsync(downloads[0].blob);
      expect(Object.keys(zip.files)).toEqual(['project.json']);
    });

    it('falls back to "project" when the name has no usable characters', async () => {
      const { saveProjectToFile, serializeProject } = await freshModule();
      await saveProjectToFile(serializeProject(baseState({ projectName: '***' })));
      expect(downloads[0].fileName).toBe('project.a3d');
    });
  });

  describe('round trip', () => {
    it('reopens a saved package with identical data and model', async () => {
      const save = await freshModule();
      const state = baseState({
        annotations: [
          annotation(),
          annotation({ id: 'a2', kind: 'path', label: 'Path 1', hidden: true, distance: 8 }),
          annotation({
            id: 'a3',
            kind: 'area',
            label: 'Area 1',
            distance: undefined,
            area: 12.5,
            points: [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ],
          }),
          annotation({ id: 'a4', kind: 'point', label: 'Note 1', distance: undefined, points: [[1, 2, 3]] }),
        ],
      });
      save.setModelSource(new Blob(['model-bytes']), 'scan.ply');

      await save.saveProjectToFile(save.serializeProject(state));
      const savedBlob = downloads[0].blob;

      // Reopen through a fresh module instance so we exercise the real zip read path.
      const open = await freshModule();
      const reopened = await open.openProjectFile(new File([savedBlob], 'Torso.a3d'));

      expect(reopened.data).toEqual(save.serializeProject(state));
      expect(reopened.modelName).toBe('scan.ply');
      expect(await reopened.modelBlob.text()).toBe('model-bytes');
      expect(open.getModelSource()).toEqual({ blob: reopened.modelBlob, name: 'scan.ply' });
    });
  });

  describe('openProjectFile errors', () => {
    it('rejects archives without project.json', async () => {
      const { openProjectFile } = await freshModule();
      await expect(openProjectFile(await projectFile({ 'readme.txt': 'hello' }))).rejects.toThrow(
        /project\.json is missing/,
      );
    });

    it('rejects unsupported project versions', async () => {
      const { openProjectFile } = await freshModule();
      const file = await projectFile({ 'project.json': projectJson({ version: 2 as unknown as 1 }) });
      await expect(openProjectFile(file)).rejects.toThrow(/Unsupported project version/);
    });

    it('rejects projects with corrupt layer or annotation data', async () => {
      const { openProjectFile } = await freshModule();
      const file = await projectFile({ 'project.json': projectJson({ layers: {} as unknown as DamageLayer[] }) });
      await expect(openProjectFile(file)).rejects.toThrow(/Corrupt project file/);
    });

    it('rejects projects that do not reference a model', async () => {
      const { openProjectFile } = await freshModule();
      const file = await projectFile({ 'project.json': projectJson({ modelFile: null }) });
      await expect(openProjectFile(file)).rejects.toThrow(/does not reference a model/);
    });

    it('rejects projects whose model entry is missing from the archive', async () => {
      const { openProjectFile } = await freshModule();
      const file = await projectFile({ 'project.json': projectJson({}) });
      await expect(openProjectFile(file)).rejects.toThrow(/is missing from the project package/);
    });
  });
});
