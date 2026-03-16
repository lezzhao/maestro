import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface DragDropOptions {
  onDropProject: (path: string) => void;
}

export function useAppDragDrop({ onDropProject }: DragDropOptions) {
  const dragCounterRef = useRef(0);

  useEffect(() => {
    let unlistenFileDrop: (() => void) | undefined;
    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;
    
    async function setupDropTarget() {
      const gWindow = getCurrentWindow() as unknown as {
        onFileDropEvent: (cb: (e: { payload: { type: string; paths: string[] } }) => void) => Promise<() => void>;
      };
      
      unlistenFileDrop = await gWindow.onFileDropEvent((event) => {
        if (event.payload.type === 'drop') {
          dragCounterRef.current = 0;
          document.body.classList.remove("global-drag-over");
          
          const paths = event.payload.paths;
          if (paths && paths.length > 0 && paths[0]) {
             // Basic heuristic: check if it's a directory by not having an extension
             const path = paths[0];
             const isProbablyDir = !path.split('/').pop()?.includes('.');
             if (isProbablyDir) {
               onDropProject(path);
             }
          }
        } else if (event.payload.type === 'hover') {
          dragCounterRef.current++;
          document.body.classList.add("global-drag-over");
        } else if (event.payload.type === 'cancel') {
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) {
            document.body.classList.remove("global-drag-over");
          }
        }
      });
      
      unlistenDragEnter = await listen("tauri://drag-enter", () => {
        dragCounterRef.current++;
        document.body.classList.add("global-drag-over");
      });
      
      unlistenDragLeave = await listen("tauri://drag-leave", () => {
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
          document.body.classList.remove("global-drag-over");
        }
      });
    }
    
    setupDropTarget().catch(console.error);
    
    return () => {
      if (unlistenFileDrop) unlistenFileDrop();
      if (unlistenDragEnter) unlistenDragEnter();
      if (unlistenDragLeave) unlistenDragLeave();
      document.body.classList.remove("global-drag-over");
    };
  }, [onDropProject]);
}
