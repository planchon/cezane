import { useRef, useState } from "react";
import { importFiles } from "../ui/actions";
import { ViewSwitcher } from "../ui/Pickers";
import { useMedias } from "./context";
import { FilePanel } from "./FilePanel";
import { FileBrowser, FolderSidebar } from "./FileViewer";
import "./medias.css";

const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * The Médias tab shows the project's files as the Finder does, generated ones included: the
 * folders (left), the open folder (centre), the selected file (right). Nothing is generated
 * here: that is the Canvas tab. Files dropped from the Finder are imported into Rushes/.
 */
export function MediasView() {
  const m = useMedias();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const importHere = (list: File[]) => {
    if (!list.length) return;
    importFiles(list);
    m.setFolder("Rushes");
  };
  return (
    // display: contents; the whole tab takes Finder files.
    <div
      className="md-root"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        depth.current = 0;
        setOver(false);
        if (!hasFiles(e)) return;
        e.preventDefault();
        importHere(Array.from(e.dataTransfer.files));
      }}
    >
      <FolderSidebar />
      <div className="mid md-browser">
        <FileBrowser onImport={importHere} />
        <ViewSwitcher />
        {over && <div className="md-drop">Déposer pour importer dans Rushes</div>}
      </div>
      <FilePanel view="medias" />
    </div>
  );
}
