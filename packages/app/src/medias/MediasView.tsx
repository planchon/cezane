import { useApp } from "../store";
import { ViewSwitcher } from "../ui/Pickers";
import { MediasProvider } from "./context";
import { FilePanel } from "./FilePanel";
import { FileViewer } from "./FileViewer";
import { GenCanvas } from "./GenCanvas";
import "./medias.css";

const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * The Médias view, in the work area: the project's files (left), the generation canvas (centre),
 * the selected file and Claude (right). Its own state lives in MediasProvider.
 */
export function MediasView() {
  const { state } = useApp();
  return (
    <MediasProvider>
      {/* display: contents. Finder files dropped where nothing takes them must not open in the window. */}
      <div
        className="md-root"
        onDragOver={(e) => {
          // The file viewer and the canvas accept Finder files (they cancel dragover first); elsewhere: refused.
          if (!hasFiles(e) || e.nativeEvent.defaultPrevented) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "none";
        }}
        onDrop={(e) => {
          if (hasFiles(e)) e.preventDefault();
        }}
      >
        <FileViewer />
        <div className="mid">
          <GenCanvas key={state?.projectId} />
          <ViewSwitcher />
        </div>
        <FilePanel />
      </div>
    </MediasProvider>
  );
}
