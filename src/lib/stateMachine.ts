import { assign, setup } from 'xstate';
import { dbProvider } from './db';
import { takeGitSnapshot } from './gitSync';

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
      // Wait for git snapshot before writing to DB
      const gitHash = await takeGitSnapshot(context.taskId, params.to);
      await dbProvider.logTransition({
        id: crypto.randomUUID(),
        task_id: context.taskId,
        from_state: params.from,
        to_state: params.to,
        triggered_by: 'system', // or passed in event
        git_snapshot_hash: gitHash,
        context_reasoning: `Transitioned via ${event.type}`,
      });
      await dbProvider.updateTaskState(context.taskId, params.to);
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
