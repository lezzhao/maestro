import { assign, setup } from 'xstate';
import { invoke } from '@tauri-apps/api/core';
import { dbProvider } from './db';

export interface TaskContext {
  taskId: string;
  hasTests: boolean;
  rejectReason?: string;
  gitSnapshotHash?: string;
}

export type TaskEvent =
  | { type: 'START_PLANNING' }
  | { type: 'START_EXECUTION' }
  | { type: 'REQUEST_REVIEW' }
  | { type: 'APPROVE' }
  | { type: 'REJECT'; reason: string }
  | { type: 'PAUSE' }
  | { type: 'ADD_TESTS' };

export const taskMachine = setup({
  types: {
    context: {} as TaskContext,
    events: {} as TaskEvent,
  },
  guards: {
    hasTestsGuard: ({ context }) => {
      // Return true if tests have been generated and recorded
      return context.hasTests === true;
    },
  },
  actions: {
    recordTransition: async ({ context, event }, params: { from: string; to: string }) => {
      // Logic to Rust: delegate to backend task_transition command
      const eventType = event.type;
      const eventReason = event.type === 'REJECT' && 'reason' in event ? event.reason : undefined;
      try {
        await invoke<string>('task_transition', {
          request: {
            taskId: context.taskId,
            fromState: params.from,
            eventType,
            eventReason,
          },
        });
      } catch (err) {
        console.error('[taskMachine] task_transition failed:', err);
        // Fallback to legacy frontend DB if Rust command fails (e.g. task not in DB yet)
        const { takeGitSnapshot } = await import('./gitSync');
        const gitHash = await takeGitSnapshot(context.taskId, params.to);
        await dbProvider.logTransition({
          id: crypto.randomUUID(),
          task_id: context.taskId,
          from_state: params.from,
          to_state: params.to,
          triggered_by: 'system',
          git_snapshot_hash: gitHash,
          context_reasoning: `Transitioned via ${event.type}`,
        });
        await dbProvider.updateTaskState(context.taskId, params.to);
      }
    },
    setRejectReason: assign({
      rejectReason: ({ event }) => {
        if (event.type === 'REJECT') return event.reason;
        return undefined;
      }
    }),
    markTestsAdded: assign({
      hasTests: true,
    })
  },
}).createMachine({
  id: 'bmad_task',
  initial: 'BACKLOG',
  context: {
    taskId: '',
    hasTests: false,
  },
  states: {
    BACKLOG: {
      on: {
        START_PLANNING: {
          target: 'PLANNING',
          actions: { type: 'recordTransition', params: { from: 'BACKLOG', to: 'PLANNING' } }
        }
      }
    },
    PLANNING: {
      on: {
        START_EXECUTION: {
          target: 'IN_PROGRESS',
          actions: { type: 'recordTransition', params: { from: 'PLANNING', to: 'IN_PROGRESS' } }
        },
        PAUSE: {
          target: 'BACKLOG',
          actions: { type: 'recordTransition', params: { from: 'PLANNING', to: 'BACKLOG' } }
        }
      }
    },
    IN_PROGRESS: {
      on: {
        REQUEST_REVIEW: {
          target: 'CODE_REVIEW',
          actions: { type: 'recordTransition', params: { from: 'IN_PROGRESS', to: 'CODE_REVIEW' } }
        },
        PAUSE: {
          target: 'BACKLOG',
          actions: { type: 'recordTransition', params: { from: 'IN_PROGRESS', to: 'BACKLOG' } }
        },
        ADD_TESTS: {
          actions: ['markTestsAdded']
        }
      }
    },
    CODE_REVIEW: {
      on: {
        APPROVE: {
          target: 'DONE',
          guard: 'hasTestsGuard',
          actions: { type: 'recordTransition', params: { from: 'CODE_REVIEW', to: 'DONE' } }
        },
        REJECT: {
          target: 'IN_PROGRESS',
          actions: [
            { type: 'recordTransition', params: { from: 'CODE_REVIEW', to: 'IN_PROGRESS' } },
            'setRejectReason'
          ]
        }
      }
    },
    DONE: {
      type: 'final'
    }
  }
});
