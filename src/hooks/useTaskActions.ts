import { useTaskStoreState } from "./use-app-store-selectors";
import { useAsyncCallback } from "./use-async-callback";

export function useTaskActions() {
  const { addTask } = useTaskStoreState();

  const { execute: handleAddTask, isLoading: isAddingTask, error: addTaskError } = useAsyncCallback(
    async (name: string = "", workspaceId?: string | null) => {
      await addTask(name, workspaceId);
    },
    { 
      onSuccessMessage: "task_created_success",
      showSuccessToast: false,
      errorMessagePrefix: "task_create_failed" 
    }
  );

  return {
    handleAddTask,
    isAddingTask,
    addTaskError,
  };
}
