import { Box, FileDown, FolderOpen, Save } from 'lucide-react';
import { exportCurrentReport, openProjectPackage, pickFile, saveCurrentProject } from '../project/actions';
import { useAppStore } from '../state/store';
import { PROJECT_EXTENSION } from '../types/project';

export function TopBar() {
  const projectName = useAppStore((s) => s.projectName);
  const unit = useAppStore((s) => s.unit);
  const hasModel = useAppStore((s) => s.hasModel);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const setUnit = useAppStore((s) => s.setUnit);

  const run = (fn: () => Promise<unknown>) => () => {
    fn().catch((err: unknown) => window.alert(err instanceof Error ? err.message : String(err)));
  };

  const onOpenProject = run(async () => {
    const file = await pickFile(`${PROJECT_EXTENSION},.zip`);
    if (file) await openProjectPackage(file);
  });

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Box size={18} />
        <span>3D Artwork Annotator</span>
      </div>
      <input
        className="project-name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder="Project name"
        aria-label="Project name"
      />
      <div className="topbar-unit">
        <label htmlFor="unit-input">Unit</label>
        <input id="unit-input" value={unit} onChange={(e) => setUnit(e.target.value)} title="Unit label used in measurements and reports (e.g. m, cm, mm)" />
      </div>
      <div className="topbar-actions">
        <button className="btn" onClick={onOpenProject}>
          <FolderOpen size={16} /> Open project
        </button>
        <button className="btn" onClick={run(saveCurrentProject)} disabled={!hasModel}>
          <Save size={16} /> Save project
        </button>
        <button className="btn primary" onClick={() => exportCurrentReport()} disabled={!hasModel}>
          <FileDown size={16} /> Export report
        </button>
      </div>
    </header>
  );
}
