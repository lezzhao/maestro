# Maestro (Omni-Agent Orchestrator)

Maestro 是一个基于 **Tauri v2 + React + Rust** 构建的 **AI-Native 开发中枢 (Omni-Agent Orchestrator)**。
它旨在为开发者提供一个统一、强大且安全的界面，用于管理和调度多个 AI 编程代理（Agents），如 Cursor、Claude、Gemini 等。

通过 Maestro，你可以无缝地在不同大模型/编程助手之间切换，管理它们的运行环境、环境变量、执行规范（Specs），并通过内置的 PTY 终端或无头编排模式监控和控制它们的执行。

---

## 🌟 核心特性

- **多引擎无缝切换**：内置支持 `cursor`、`claude`、`gemini`、`opencode` 和 `codex` 等主流 AI 编程助手的调度协议。
- **双模运行机制**：
  - **手动模式（交互式 terminal）**：通过内置的 PTY + xterm.js 直接与 Agent 交互。
  - **编排模式（Headless Workflow）**：支持后台无头执行复杂任务流，实时监控执行结果并自动归档。
- **自定义规范注入 (Spec Injection)**：支持在项目目录中动态注入和管理执行规范（如默认支持的 `BMAD` 规范，或自定义 Markdown 规范），强制 AI 生成符合标准的代码。
- **安全的凭据管理**：集成了操作系统的原生 Keyring（钥匙串/凭证管理器），安全存储 API Key，并对本地日志中的敏感凭据进行自动脱敏拦截，防止配置泄漏。
- **进程与生命周期守护**：提供高可用性的孤儿进程检测与会话恢复清理，确保资源的及时回收与状态一致性。

---

## 🛠️ 技术栈

* **核心及系统层 (Backend)**: 
  * Rust + Tauri v2
  * `portable-pty` (用于子进程终端伪装与挂载)
  * `keyring` (系统级安全密钥存储)
* **前端界面 (Frontend)**: 
  * React 18 + TypeScript + Vite
  * Tailwind CSS v4 (原子化样式设计)
  * `@xterm/xterm` (终端渲染引擎)
  * `zustand` (轻量状态管理)

---

## 🚀 极速上手

### 前置依赖
在开始之前，请确保你的开发环境满足以下要求：
- **Node.js**: v20 或更高版本
- **Rust**: Stable 稳定版
- **系统环境**: macOS (需安装 Xcode Command Line Tools) 或 Linux

### 安装依赖
```bash
# 获取项目代码后，安装前端及 Tauri 依赖
pnpm install
```

### 启动开发模式
这将同时启动前端 Vite 热更新服务器和 Rust Tauri 后端：
```bash
pnpm run tauri dev
```

### 生产环境构建
```bash
# 自动执行前端构建并打包生成各端安装包 (macOS 下为 .dmg 和 .app)
pnpm run build

# 或仅构建 Rust 后端可执行文件
cd src-tauri && cargo build --release
```

---

## ⚙️ 核心概念与配置

Maestro 的所有全局行为和引擎定义都依赖于配置文件。启动应用后，默认会在系统的 App Config 目录生成配置。
**macOS 路径示例**: `~/Library/Application Support/com.lezhao.maestro/config.toml`

### 1. 引擎 (Engines) 与 配置模板 (Profiles)
Maestro 采用“强类型结构”来定义每个 AI 助手（Engine）。你可以为 Cursor、Claude 等创建不同的 Profile（如：写码大模型专用的 Profile、代码 Review 专用的 Profile）。

配置包含执行命令 (`command`)、默认参数 (`args`)、退出超时 (`exit_timeout_ms`) 等。对于携带 `api_key` 的配置，Maestro 会在写入此 `.toml` 文件前将其剥离，转存入你电脑系统的安全凭据层中。

示例 `config.toml`：
```toml
[app]
language = "zh-CN"
theme = "dark"
default_mode = "manual"

[project]
path = ""
detected_stack = []

[engines.cursor]
id = "cursor"
display_name = "Cursor Agent"
# 调用的二进制命令及参数
command = "cursor"
args = ["agent"]
env = {}
exit_command = "ctrl-c"
exit_timeout_ms = 3000
supports_headless = true
headless_args = ["agent", "--print"]
ready_signal = ">"
icon = "terminal-square"
```

### 2. 规范注入 (Spec Management)
AI 助手往往需要明确的 prompt 指令或是行为规范（Rule）。Maestro 的 `SpecProviders` 允许你为当前工作区的 AI 强制注入特定规则。

Maestro 支持三种层级的注入：
- `none`: 不注入任何特殊规则。
- `bmad`: 注入项目主推的 **BMAD (Brief -> Model -> Action -> Done)** 工作流规范。
- `custom`: 用户使用自定义规范路径注入。

> 注入发生时，Maestro 提供了 `.bmad-bak` 安全备份机制，用户可以在切换不同 Agent 流派时无缝 `spec_restore` 预先存在的业务 `.cursorrules` 或 `.CLAUDE.md`。

---

## 📁 目录架构导览

```text
.
├── src/                    # 前端 React 源码目录
│   ├── components/         # 通用 UI 组件 / 面板
│   ├── hooks/              # 全局状态管理、Tauri 交互钩子
│   └── App.tsx             # 应用主入口，挂载生命周期任务 (Sessions 回收)
│
├── src-tauri/              # Tauri (Rust) 后端源码目录
│   ├── src/
│   │   ├── config.rs       # TOML 配置解析、数据迁移与 Keyring 结合
│   │   ├── cli_main.rs     # 后端命令行参数处理 (Daemon与IPC通信模式)
│   │   ├── cli_state.rs    # 会话及 Log 记录状态对齐
│   │   ├── engine.rs       # shlex 命令解析与多进程引擎调度
│   │   ├── pty.rs          # portable-pty 实现及孤儿会话检查
│   │   ├── run_persistence.# 日志脱敏 (redactSensitive) 与 JSONL 持久化
│   │   ├── spec.rs         # Prompt / 约定文件的注入器 (Backup/Restore)
│   │   ├── process.rs      # 系统 CPU/RAM 监控功能
│   │   └── workflow.rs     # Headless (自动编排运行) 步骤生成与控制协议
│   ├── Cargo.toml          # Rust 依赖声明
│   └── tauri.conf.json     # Tauri 窗口与安全配置
│
└── package.json            # 前端及包管理配置
```

---

## 🔒 隐私与安全性

- **API 密钥持久化屏蔽**：你在 UI 中填写的任何 `api_key` 均不会被明文保存在 `config.toml`，而是被持久化在安全存储（如 macOS 的 Keychain）中。
- **实时日志脱敏**：Maestro CLI 和后台保存会话状态（位于所选项目路径的 `.maestro-cli/logs/` 目录）时，所有输出内容都会途径基于正则的脱敏清洗，防止意外将 `sk-****` 或 `Bearer ****` 提交至版本管理库。

---

## 🗄️ 数据诊断与工作流归档

每次完成一轮 `workflow_run`（编排测试或全自动代理任务）时，Maestro 会在本地自动生成防丢失归档。

保存格式如下：
`<app_config_dir>/workflow-archives/<workflow-name>-<unix-ts>.json`

通过检查该 JSON 归档，可帮助你追溯每个单步执行时 Agent 给出的 raw output、大模型耗时、拦截的 errors、以及触发 `fallback` 的关键原因。
