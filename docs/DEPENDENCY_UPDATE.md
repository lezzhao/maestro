# 依赖更新流程

## 概述

本文档定义依赖升级的评估与执行流程，以降低大版本升级带来的兼容性风险。

## 适用范围

- 前端：`package.json` 中的 dependencies 与 devDependencies
- 后端：`src-tauri/Cargo.toml` 中的 dependencies

## 更新流程

### 1. 小版本 / 补丁版本（patch/minor）

- 可直接在开发分支更新
- 运行 `pnpm install`（前端）或 `cargo update`（后端）
- 执行 `pnpm test` 和 `cargo test` 验证
- 提交时在 commit message 中注明更新的包及版本

### 2. 大版本升级（major）

1. **创建升级分支**：`git checkout -b deps/upgrade-<package>-v<version>`
2. **更新依赖**：修改 `package.json` 或 `Cargo.toml`
3. **解决破坏性变更**：
   - 查阅包 changelog / migration guide
   - 修复编译错误与类型错误
   - 更新受影响的调用方
4. **测试**：
   - `pnpm test` / `cargo test`
   - 手动验证关键功能（chat、workflow、task 切换等）
5. **更新 CHANGELOG**：在 `CHANGELOG.md` 中记录升级
6. **合并**：通过 PR 合并，必要时在 CI 中增加兼容性测试

## 重点关注依赖

| 依赖 | 说明 |
|------|------|
| tauri | 核心框架，大版本升级需完整回归 |
| Vite | 构建工具，关注插件兼容性 |
| Zustand | 状态管理，API 相对稳定 |
| Framer Motion | 动画库，大版本可能有 API 变更 |
| keyring | 凭据存储，需验证各平台行为 |

## CI 建议

- 在 CI 中固定 `pnpm-lock.yaml` 和 `Cargo.lock`，避免未预期的依赖解析
- 大版本升级 PR 可增加临时 job 做扩展测试
