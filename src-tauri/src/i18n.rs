use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Language {
    ZH,
    EN,
}

impl From<&str> for Language {
    fn from(s: &str) -> Self {
        if s.to_lowercase().contains("zh") {
            Language::ZH
        } else {
            Language::EN
        }
    }
}

#[derive(Clone)]
pub struct I18n {
    lang: Language,
    entries: HashMap<&'static str, HashMap<Language, &'static str>>,
}

impl I18n {
    pub fn new(lang_str: &str) -> Self {
        let lang = Language::from(lang_str);
        let mut entries = HashMap::new();

        // System Identity
        entries.insert("system_identity", Self::map(
            r#"<identity>
你是一位顶级全栈工程师与 AI 开发中枢 (Maestro Omni-Agent Orchestrator)。
你不仅具备卓越的代码编写能力，还擅长多步骤任务编排、环境诊断与自主决策。
你的目标是以前瞻性的眼光，高效、安全地解决用户提出的任何开发挑战。
</identity>

<thought_process>
在采取任何行动（特别是调用工具）之前，请务必进行深入思考：
1. **分析现状**：理解当前的上下文、文件结构和用户意图。
2. **制定计划**：将任务分解为逻辑清晰的子目标。
3. **预期结果**：预测每一步操作的影响与可能的异常。
4. **即时修正**：根据工具返回的执行结果（stdout/stderr），实时调整后续方案。
请在内部单色气泡中使用 <think> 标签展示你的思考过程分支。
</thought_process>

<capabilities>
你拥有的核心能力包括但不限于：
- 源码审计与逻辑分析。
- 多语言全栈开发 (Node.js, Rust, Python, Go, etc.)。
- 系统命令执行与 PTY 交互。
- 上下文感知的自动化测试与验证。
</capabilities>

<constraints>
1. **安全性第一**：严禁无故修改系统关键路径（如 /etc）或执行具有破坏性的全局删除命令。
2. **最小侵入原则**：代码修改应精准、优雅，避免多余的重构或格式化。
3. **路径规范**：所有文件操作必须基于当前工作目录，优先使用相对路径。
4. **错误处理**：若工具报错，应分析 stderr 并尝试自我修复或向用户解释原因。
5. **任务终结**：当你确信任务已圆满完成、无后续步骤时，**必须**调用 `finish_task` 工具进行总结。禁止在未调用该工具的情况下直接宣告结束。
</constraints>
"#,
            r#"<identity>
You are a world-class full-stack engineer and AI development hub (Maestro Omni-Agent Orchestrator).
You possess not only exceptional coding skills but also expertise in multi-step task orchestration, environmental diagnostics, and autonomous decision-making.
Your goal is to solve any development challenges presented by the user with foresight, efficiency, and safety.
</identity>

<thought_process>
Before taking any action (especially calling tools), you must think deeply:
1. **Analyze Situation**: Understand the current context, file structure, and user intent.
2. **Formulate Plan**: Break down the task into logically clear sub-goals.
3. **Anticipate Results**: Predict the impact and potential exceptions for each operation.
4. **Instant Correction**: Adjust subsequent plans in real-time based on the execution results returned by tools (stdout/stderr).
Please use the <think> tag within internal monochrome bubbles to exhibit your thought process branches.
</thought_process>

<capabilities>
Your core capabilities include, but are not limited to:
- Source code auditing and logic analysis.
- Multi-language full-stack development (Node.js, Rust, Python, Go, etc.).
- System command execution and PTY interaction.
- Context-aware automated testing and verification.
</capabilities>

<constraints>
1. **Security First**: Strictly prohibited from modifying critical system paths (e.g., /etc) or executing destructive global delete commands without cause.
2. **Minimum Intrusion Principle**: Code modifications should be precise and elegant, avoiding redundant refactoring or formatting.
3. **Path Specification**: All file operations must be based on the current working directory, preferring relative paths.
4. **Error Handling**: If a tool errors, analyze stderr and attempt self-repair or explain the reason to the user.
5. **Task Termination**: When you are certain the task is successfully completed with no further steps, you **MUST** call the `finish_task` tool to summarize. Prohibiting ending directly without calling this tool.
</constraints>
"#,
        ));

        // Context Files
        entries.insert("context_files_header", Self::map(
            "\n\n<context_files>\n以下是用户明确锁定的关键文件内容，请在处理任务时优先考虑这些信息：\n",
            "\n\n<context_files>\nThe following are key file contents explicitly locked by the user. Please prioritize this information when handling the task:\n",
        ));

        // Truncated Buffer
        entries.insert("truncated_buffer", Self::map(
            "\n\n... [已自动截断 {n} 字符以节省上下文窗口。保持了头部与尾部摘要] ...\n\n",
            "\n\n... [Automatically truncated {n} characters to save context window. Kept head and tail summaries] ...\n\n",
        ));

        // History Summary
        entries.insert("history_summary", Self::map(
            "[历史执行摘要：工具调用成功。为节省上下文空间，原始输出（{n} 字符）已被剪除并替换为此摘要。]",
            "[Historical Execution Summary: Tool call successful. To save context space, the original output ({n} characters) has been pruned and replaced with this summary.]",
        ));

        // Backend Choice Notification
        entries.insert("choice_selected", Self::map(
            "已选择“{}”",
            "Selected \"{}\"",
        ));

        // CLI Headless Error
        entries.insert("cli_headless_unsupported", Self::map(
            "当前 CLI Provider 不支持无头执行，无法直接在聊天里运行。",
            "Current CLI Provider does not support headless execution and cannot be run directly in chat.",
        ));
        entries.insert("cli_headless_unsupported_title", Self::map(
            "CLI 不支持当前执行模式",
            "CLI Unsupported Execution Mode",
        ));
        entries.insert("cli_headless_unsupported_desc", Self::map(
            "你可以打开设置调整 Provider 配置，或者切换到支持 API 的模式继续。",
            "Adjust Provider config in settings or switch to an API-supported mode.",
        ));

        // General labels
        entries.insert("open_settings", Self::map("打开设置", "Open Settings"));
        entries.insert("switch_to_api", Self::map("切换到 API", "Switch to API"));
        entries.insert("switch_to_cli", Self::map("切换到 CLI", "Switch to CLI"));
        entries.insert("check_provider_config", Self::map("检查当前 Provider 的执行模式与参数。", "Check the execution mode and parameters of the current Provider."));
        entries.insert("provider_api_hint", Self::map("如果当前 Provider 支持 API，可先改用 API 模式。", "If the current Provider supports API, you can switch to API mode first."));

        // Safety Guard
        entries.insert("safety_blocked", Self::map("当前命令被安全策略拦截，已阻止执行。", "The command was intercepted by a safety policy and execution has been blocked."));
        entries.insert("safety_blocked_title", Self::map("命令被安全策略拦截", "Command Blocked by Safety Policy"));
        entries.insert("safety_blocked_desc", Self::map("通常是命令参数触发了 ActionGuard。你可以先打开设置检查当前 Provider 配置。", "Usually triggered by ActionGuard due to command arguments. Check the current Provider configuration in settings first."));

        // Workspace Trust
        entries.insert("trust_required", Self::map("当前 CLI 环境尚未建立目录信任，继续执行前需要先完成授权。", "Workspace trust has not been established in the current CLI environment. Authorization is required before proceeding."));
        entries.insert("trust_required_title", Self::map("CLI 目录信任未完成", "CLI Workspace Trust Pending"));
        entries.insert("trust_required_desc", Self::map("你可以先查看官方修复说明，或切换到设置页检查当前引擎配置。", "View the official fix documentation or check the current engine configuration in settings."));
        entries.insert("view_fix_docs", Self::map("查看修复文档", "View Fix Documentation"));
        entries.insert("open_fix_docs_desc", Self::map("打开官方说明，按文档完成目录信任。", "Open official instructions to complete workspace trust according to the document."));
        entries.insert("check_engine_config_desc", Self::map("进入设置页检查当前 Provider 和 CLI 配置。", "Go to settings to check current Provider and CLI configurations."));

        // No Spec
        entries.insert("spec_none", Self::map("无规范", "None"));
        entries.insert("spec_custom", Self::map("自定义规范", "Custom Spec"));

        // Preflight Warning
        // Project errors
        entries.insert("err_not_git_repo", Self::map("不是 git 仓库", "Not a git repository"));
        entries.insert("recommend_rust", Self::map("检测到 Rust 项目，推荐使用对系统级语言表现稳定的引擎", "Rust project detected; recommended engine for systems language stability."));
        entries.insert("recommend_node", Self::map("检测到 Node/前端项目，推荐 Cursor Agent 默认配置", "Node/Frontend project detected; recommended Cursor Agent default configuration."));
        entries.insert("recommend_python", Self::map("检测到 Python 项目，推荐通用推理能力较强的引擎", "Python project detected; recommended engine with strong general reasoning."));
        entries.insert("fallback_first_engine", Self::map("回退到第一个可用引擎", "Falling back to the first available engine."));

        // Workflow Run
        entries.insert("test_no_structured", Self::map("检测到测试框架输出，但未解析到结构化计数", "Test framework output detected, but no structured counts parsed."));
        entries.insert("check_raw_output", Self::map("请检查原始输出确认测试结果", "Please check raw output to confirm test results."));

        // Workflow Progress
        entries.insert("workflow_starting_step", Self::map("正在启动步骤", "Starting step"));
        entries.insert("workflow_running_step", Self::map("正在执行步骤 {}，使用 {}", "Running step {} with {}"));
        entries.insert("workflow_step_completed", Self::map("步骤执行完成", "Step completed"));
        entries.insert("workflow_step_not_matched", Self::map("步骤已完成，但未匹配到结束信号", "Step done but completion signal not matched"));
        entries.insert("workflow_step_failed", Self::map("步骤执行失败", "Step failed"));
        entries.insert("workflow_completed", Self::map("工作流执行完毕", "Workflow completed"));

        entries.insert("preflight_no_engines", Self::map(
            "警告: 未检测到任何 Engine 配置。Maestro 可能无法正常工作。",
            "Warning: No Engine configurations detected. Maestro may not function correctly.",
        ));

        Self { lang, entries }
    }

    fn map(zh: &'static str, en: &'static str) -> HashMap<Language, &'static str> {
        let mut m = HashMap::new();
        m.insert(Language::ZH, zh);
        m.insert(Language::EN, en);
        m
    }

    pub fn t(&self, key: &str) -> String {
        self.entries
            .get(key)
            .and_then(|m| m.get(&self.lang).or_else(|| m.get(&Language::EN)))
            .map(|s| s.to_string())
            .unwrap_or_else(|| key.to_string())
    }

    pub fn t_n(&self, key: &str, n: usize) -> String {
        self.t(key).replace("{n}", &n.to_string())
    }
}
