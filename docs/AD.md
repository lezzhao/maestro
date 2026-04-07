# Maestro Architectural Documentation (AD)

## 1. Execution Lifecycle & Stale State Guard (P2 Remediation)

### 1.1 Context & Problem
Maestro uses an asynchronous, event-driven execution model where the backend (Rust) emits state updates via Tauri IPC to the frontend (React/Zustand). Due to the nature of asynchronous processes, race conditions can occur. For example:
- A user stops and immediately restarts a task.
- Events from the previous execution cycle arrive at the frontend *after* the new cycle has started.
- These stale events overwrite the new cycle's state, leading to "state oscillation" or inconsistent UI.

### 1.2 Solution: State Token Guard
To address this, we implemented a **State Token Guard** (Version-based filtering):

1. **Cycle ID Generation**: Each time a task execution starts, a unique `cycle_id` (UUID or timestamp-based) is generated.
2. **End-to-End Propagation**:
   - The `cycle_id` is sent to the backend as `state_token`.
   - The backend includes this `state_token` in *every* `AgentStateUpdate` event emitted during that specific execution cycle.
   - The frontend stores the "current" `state_token` for each task.
3. **Filtering**:
   - The frontend `AgentStateReducer` (specifically `applyAgentStateUpdate`) checks the incoming event's `state_token` against the stored `current_token`.
   - If the tokens don't match (and the event is task-scoped), the event is silently ignored.

### 1.3 Components
- **`ExecutionClient`**: Manages the `cycle_id` for a single execution stream.
- **`AgentStateReducer`**: Centralized logic for state updates and stale event filtering.
- **`ChatStore`**: Maintains the `taskStateTokens` map.
- **`useAgentExecutor`**: Generates and propagates the initial `cycleId`.

---

## 2. Security Architecture: SafetyManager

### 2.1 Asynchronous Approval Flow
The `SafetyManager` provides a non-blocking gate for sensitive tool executions:
- **Registry**: Processes register a request and receive a `oneshot` channel for the response.
- **Interactive Questions**: Supports complex multi-option questions to resolve ambiguity before proceeding.

### 2.2 Protection Mechanisms
- **Rate Limiting**: Sliding window (60s/120 requests) to prevent resource exhaustion.
- **UI Connectivity Guard**: If `auto_deny_if_no_ui` is enabled, any request arriving when no frontend session is active is automatically denied.
- **Stale Request Cleanup (Reaper)**: A background task cleans up (denies) pending requests older than 300 seconds to prevent memory leaks and "hanging" backends.

---

## 3. Modularization & Type Synchronization

### 3.1 I/O & Logic Separation
The architectural audit established a clear separation between:
- **`infra`**: Raw FS primitives and OS-level interactions.
- **`core`**: Pure business logic and domain services.
- **`workflow`**: High-level orchestration of agent loops.

### 3.2 Frontend/Backend Sync
All state transfer objects (STOs) are synchronized between Rust structs and TypeScript interfaces to ensure "industrial-grade" type safety across the IPC boundary.
