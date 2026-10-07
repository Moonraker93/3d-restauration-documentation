import { Box, FolderOpen, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { createProjectFromModel, openProjectPackage, pickFile } from '../project/actions';
import { MODEL_ACCEPT, MODEL_EXTENSIONS } from '../three/loadModel';
import { PROJECT_EXTENSION } from '../types/project';

export function WelcomeOverlay() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (fn: (file: File) => Promise<void>, accept: string) => {
    const file = await pickFile(accept);
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await fn(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <div className="welcome-logo">
          <ScanLine size={40} />
        </div>
        <h1>3D Artwork Annotator</h1>
        <p>
          Document damage and plan restorations directly on 3D digitized artworks: measure point-to-point,
          map damaged areas and keep categorized annotations — then export a PDF report.
        </p>
        <div className="welcome-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void handle(createProjectFromModel, MODEL_ACCEPT)}
          >
            <Box size={18} /> New project from 3D model
          </button>
          <button disabled={busy} onClick={() => void handle(openProjectPackage, `${PROJECT_EXTENSION},.zip`)}>
            <FolderOpen size={18} /> Open project ({PROJECT_EXTENSION})
          </button>
        </div>
        {busy && <p className="welcome-note">Loading…</p>}
        {error && <p className="welcome-error">{error}</p>}
        <p className="welcome-note">
          Supported models: {MODEL_EXTENSIONS.join(', ')}
          <br />
          Renders with WebGPU (WebGL2 fallback) · All data stays on your machine · Open source
        </p>
      </div>
    </div>
  );
}
