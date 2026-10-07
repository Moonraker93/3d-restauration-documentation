import { SidePanel } from './components/SidePanel';
import { ToolBar } from './components/ToolBar';
import { TopBar } from './components/TopBar';
import { WelcomeOverlay } from './components/WelcomeOverlay';
import { useAppStore } from './state/store';
import { Viewer } from './three/Viewer';

export default function App() {
  const hasModel = useAppStore((s) => s.hasModel);
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        <ToolBar />
        <Viewer />
        <SidePanel />
      </div>
      {!hasModel && <WelcomeOverlay />}
    </div>
  );
}
