# Omni-Agent Orchestrator

AI-Native 开发中枢，基于 `Tauri v2 + React + Rust`，支持：

- 多引擎切换（`cursor` / `claude` / `gemini` / `opencode` / `codex`）
- 手动模式（PTY + xterm.js）
- 编排模式（headless 优先，PTY 回退）
- 可选规范注入（`none` / `bmad` / `custom`）
- 实时进程监控（CPU / RAM）

## 技术栈

- Shell: Tauri v2 (Rust)
- Frontend: React + TypeScript + Vite + Tailwind CSS v4
- Terminal: `@xterm/xterm`
- PTY: `portable-pty` (自研会话管理)

## 本地开发

前置条件：

- Node.js 20+
- Rust stable
- macOS 需要 Xcode Command Line Tools

安装依赖：

```bash
pnpm install
```

启动开发模式：

```bash
pnpm run tauri dev
```

## 命令行排障（最小 CLI）

为了在不打开 UI 的情况下排查“发送了任务但没有输出”，项目提供了最小命令行入口：

```bash
pnpm bmad doctor
pnpm bmad doctor --engine opencode --json
pnpm bmad task run --engine opencode --prompt "请输出 hello"
pnpm bmad task send --engine opencode --content "继续执行，补充测试"
pnpm bmad task logs --engine opencode --limit 200
pnpm bmad task list --engine opencode
pnpm bmad task prune --status stopped --older-than-hours 24 --yes
pnpm bmad task stop --engine opencode
```

支持参数：

- `--engine`: `cursor | claude | gemini | opencode | codex`
- `--prompt`: 任务指令（`task run` 必填）
- `--model`: 模型 ID（可选）
- `--cwd`: 运行目录（可选）
- `--timeout-ms`: 超时毫秒（可选）
- `--command`: 覆盖默认可执行命令（可选）

说明：

- `task run/send/stop/logs` 支持所有内置引擎（`cursor/claude/gemini/opencode/codex`）。
- 其中 `opencode` 会优先使用原生会话 ID；其他引擎使用 CLI 侧“伪会话”状态管理。
- CLI 会在 `.bmad-cli/state.json` 记录会话状态，在 `.bmad-cli/logs/` 持久化每次 run/send/stop 输出。
- `send/stop/logs` 未传 `--session` 时会自动复用该引擎最近一次活跃会话。
- `task list` 用于查看会话状态、日志大小与最近活跃会话。
- `task prune` 用于按条件批量清理会话与日志（需显式传 `--yes`）。

构建：

```bash
pnpm run build
cd src-tauri && cargo check
```

## 配置文件

应用会在 Tauri app config 目录创建 `config.toml`。典型路径（macOS）：

`~/Library/Application Support/com.lezhao.omniagent/config.toml`

示例：

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
command = "cursor"
args = ["agent"]
env = {}
exit_command = "ctrl-c"
exit_timeout_ms = 3000
supports_headless = true
headless_args = ["agent", "--print"]
ready_signal = ">"
icon = "terminal-square"

[spec]
enabled = false
active_provider = ""

[spec.providers.bmad]
display_name = "BMAD"
version = "6.0.4"
source_path = ""
install_mode = "rules_only"
target_ide = "cursor"

[spec.providers.custom]
display_name = "自定义规范"
source_path = ""
rules_content = ""
```

## 编排结果归档

每次执行 `workflow_run` 会生成 JSON 归档，保存位置：

`<app_config_dir>/workflow-archives/<workflow-name>-<unix-ts>.json`

归档包含：

- 原始请求（steps、completion signal 等）
- 每步执行结果（模式、是否 fallback、输出、耗时）
- 完成状态（是否全部步骤命中 completion signal）

## 目录概览

```text
src-tauri/src/
  config.rs      # config.toml 读写
  pty.rs         # 自研 PTY 会话管理
  engine.rs      # 引擎管理与会话切换
  spec.rs        # 规范注入（可选）
  project.rs     # 技术栈检测与推荐
  process.rs     # CPU/RAM 监控
  workflow.rs    # 编排执行与归档
```
