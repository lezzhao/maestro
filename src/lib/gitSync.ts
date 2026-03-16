import { Command } from '@tauri-apps/plugin-shell';

/**
 * Utility to take a git snapshot before a task transitions its state.
 * @param taskId the ID of the task
 * @param toState the state the task is transitioning into
 * @returns the commit hash or a stash ref if successful, otherwise null
 */
export async function takeGitSnapshot(taskId: string, toState: string): Promise<string | null> {
  try {
    // We create a commit instead of a stash, or a lightweight tag if needed
    // Assuming the user has a local initialized git repository.
    // For simplicity, we are staging ALL changes and making an auto-commit with bmad-bot.
    
    // First stage all changes
    const stageCmd = Command.create('git', ['add', '.']);
    await stageCmd.execute();

    // Check if there's anything to commit
    const statusCmd = Command.create('git', ['status', '--porcelain']);
    const statusResult = await statusCmd.execute();
    
    if (!statusResult.stdout.trim()) {
      return null; // nothing to commit
    }

    // Commit
    const message = `[bmad auto-snapshot] Task ${taskId} -> ${toState}`;
    const commitCmd = Command.create('git', ['commit', '-m', message]);
    const commitResult = await commitCmd.execute();

    if (commitResult.code !== 0) {
      console.warn('Git snapshot failed', commitResult.stderr);
      return null;
    }

    // Get the commit hash
    const hashCmd = Command.create('git', ['rev-parse', 'HEAD']);
    const hashResult = await hashCmd.execute();
    return hashResult.stdout.trim();
  } catch (error) {
    console.warn('Failed to take git snapshot', error);
    return null;
  }
}

/**
 * Reverts the workspace to a specific git hash
 */
export async function revertToSnapshot(hash: string): Promise<boolean> {
  try {
    const cmd = Command.create('git', ['reset', '--hard', hash]);
    const result = await cmd.execute();
    return result.code === 0;
  } catch (error) {
    console.error('Failed to revert to snapshot', error);
    return false;
  }
}
