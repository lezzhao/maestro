# Maestro Constitution (v1.0.0)

本项目遵循“钻石级架构 (Diamond Architecture)”准则，确保核心引擎的健壮性、解耦性和可维护性。

## I. 核心原则 (Core Principles)

1.  **Rust-Centric Core**: 业务逻辑应尽可能在 Rust 层实现，利用其类型安全和多线程并行能力。
2.  **Framework Agnostic**: 核心逻辑（Core Services）严禁直接导入或依赖 `tauri` 或 `electron` 等 UI 框架。
3.  **Structured Event Flow**: 所有的状态更新必须通过结构化的 `AgentStateUpdate` 事件流。
4.  **Security First**: 任何具有副作用、数据删除或网络访问权限的操作，必须通过 `SafetyManager` 进行显式授权。

## II. 开发标准 (Development Standards)

1.  **TypeScript-First (Frontend)**: 前端必须使用严格模式的 TypeScript。
2.  **Modular Rust**: 核心逻辑应按领域拆分。新文件的逻辑代码不应超过 300 行，超过则需重构。
3.  **Complete Event Chain**: 任何新的下行指令或上行状态：
    *   定义 `AgentStateUpdate` 枚举成员。
    *   在前端 `TaskStore` 中增加对应的处理函数。
    *   编写单元测试验证事件到达。
4.  **Immutable Migrations**: 严禁修改已发布的数据库迁移脚本。

## III. 工程流程 (Engineering Workflow)

1.  **Think Before Coding**: 重大重构前必须编写架构建议或实施计划。
2.  **Surgical Changes**: 代码变更应保持最小颗粒度，避免为了修复一个小 Bug 而重写整个模块。
3.  **Pre-Commit Check**: 提交前必须通过 `cargo check` 和前端 `lint`。

---

*Last Updated: 2026-04-09*
