import type { SceneManager } from './SceneManager';

let current: SceneManager | null = null;
let readyResolve!: (manager: SceneManager) => void;
const readyPromise = new Promise<SceneManager>((resolve) => {
  readyResolve = resolve;
});

export function setSceneManager(manager: SceneManager | null): void {
  current = manager;
  if (manager) readyResolve(manager);
}

export function getSceneManager(): SceneManager | null {
  return current;
}

/** Resolves once the viewer's SceneManager has finished its async init. */
export function whenSceneReady(): Promise<SceneManager> {
  return readyPromise;
}
