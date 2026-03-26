import { ChatPanel } from "./ChatPanel";
import type { AppTask } from "../types";

type Props = {
  projectPath: string;
  activeTask: AppTask | null;
  onSetExecutionMode: (mode: "api" | "cli") => Promise<void>;
};

export function TaskWorkspace({
  projectPath,
  activeTask,
  onSetExecutionMode,
}: Props) {
  return (
    <div className="h-full flex flex-col min-h-0 bg-transparent">
      <ChatPanel
        projectPath={projectPath}
        activeTask={activeTask}
        onSetExecutionMode={onSetExecutionMode}
      />
    </div>
  );
}
