#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ENGINE_COMMAND = {
  cursor: "cursor",
  claude: "claude",
  gemini: "gemini",
  opencode: "opencode",
  codex: "codex",
};

const DEFAULT_MODEL_FLAG = "--model";
const STATE_DIR = path.join(process.cwd(), ".bmad-cli");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_DIR = path.join(STATE_DIR, "logs");
const RUN_RECORDS_FILE = path.join(STATE_DIR, "run-records.jsonl");

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return {
        last_sessions: {},
        sessions: {},
      };
    }
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {
        last_sessions: {},
        sessions: {},
      };
    }
    return {
      last_sessions:
        parsed.last_sessions && typeof parsed.last_sessions === "object"
          ? parsed.last_sessions
          : {},
      sessions:
        parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
    };
  } catch {
    return {
      last_sessions: {},
      sessions: {},
    };
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function appendRunRecord(record) {
  ensureStateDir();
  fs.appendFileSync(RUN_RECORDS_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

function loadRunRecords() {
  try {
    if (!fs.existsSync(RUN_RECORDS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(RUN_RECORDS_FILE, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveRunRecords(records) {
  ensureStateDir();
  const text = records.map((item) => JSON.stringify(item)).join("\n");
  fs.writeFileSync(RUN_RECORDS_FILE, text ? `${text}\n` : "", "utf8");
}

/**
 * 解析形如 --key value / --key=value / --flag 的参数。
 * 同时保留位置参数，便于子命令路由。
 */
function parseArgv(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      options[key] = value;
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  return { positional, options };
}

function printHelp() {
  process.stdout.write(
    [
      "BMAD CLI（最小可用版）",
      "",
      "用法：",
      "  pnpm bmad doctor [--engine <id>] [--json]",
      "  pnpm bmad task run --engine <id> --prompt <text> [--model <id>] [--cwd <dir>] [--timeout-ms <n>] [--command <bin>]",
      "  pnpm bmad task send --engine <id> [--session <id>|--id <id>] --content <text> [--model <id>] [--cwd <dir>] [--timeout-ms <n>]",
      "  pnpm bmad task stop --engine <id> [--session <id>|--id <id>]",
      "  pnpm bmad task logs --engine <id> [--session <id>|--id <id>] [--limit <n>]",
      "  pnpm bmad task list [--engine <id>] [--json]",
      "  pnpm bmad task prune [--engine <id>] [--status <stopped|error|active>] [--older-than-hours <n>] [--yes]",
      "",
      "示例：",
      "  pnpm bmad doctor",
      "  pnpm bmad doctor --engine opencode --json",
      "  pnpm bmad task run --engine opencode --prompt \"请输出 hello\"",
      "  pnpm bmad task send --engine opencode --content \"继续执行这个任务\"",
      "  pnpm bmad task stop --engine opencode",
      "  pnpm bmad task logs --engine opencode --limit 200",
      "  pnpm bmad task list --engine opencode",
      "  pnpm bmad task prune --status stopped --older-than-hours 24 --yes",
      "  pnpm bmad task run --engine gemini --prompt \"解释下当前目录项目\" --cwd /Users/zhaole/code/bmad-client",
      "",
    ].join("\n"),
  );
}

function spawnText(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timeoutTimer = null;
    let killedByTimeout = false;

    if (options.timeoutMs && Number(options.timeoutMs) > 0) {
      timeoutTimer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGTERM");
      }, Number(options.timeoutMs));
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (options.stream) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (options.stream) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", (error) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      resolve({
        ok: false,
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        timeout: false,
      });
    });
    child.on("close", (code, signal) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      resolve({
        ok: code === 0 && !killedByTimeout,
        code,
        signal,
        stdout,
        stderr,
        timeout: killedByTimeout,
      });
    });
  });
}

async function checkCommandExists(command) {
  const result = await spawnText("zsh", ["-lc", `command -v ${shellEscape(command)}`], {
    timeoutMs: 3000,
  });
  return result.ok && result.stdout.trim().length > 0;
}

function shellEscape(input) {
  return `'${String(input).replace(/'/g, `'\"'\"'`)}'`;
}

function buildAuthCheck(engineId, command) {
  if (engineId === "cursor") {
    return `${shellEscape(command)} agent status`;
  }
  if (engineId === "claude") {
    return `${shellEscape(command)} auth status`;
  }
  if (engineId === "opencode") {
    return `${shellEscape(command)} auth`;
  }
  if (engineId === "gemini") {
    return `${shellEscape(command)} --help`;
  }
  if (engineId === "codex") {
    return `${shellEscape(command)} --help`;
  }
  return `${shellEscape(command)} --help`;
}

async function runDoctor(options) {
  const targetEngine = typeof options.engine === "string" ? options.engine : null;
  const engineIds = targetEngine ? [targetEngine] : Object.keys(DEFAULT_ENGINE_COMMAND);
  const rows = [];

  for (const engineId of engineIds) {
    const command = DEFAULT_ENGINE_COMMAND[engineId];
    if (!command) {
      rows.push({
        engine: engineId,
        command: "",
        command_exists: false,
        auth_ok: false,
        notes: "未知引擎 ID",
      });
      continue;
    }

    const commandExists = await checkCommandExists(command);
    if (!commandExists) {
      rows.push({
        engine: engineId,
        command,
        command_exists: false,
        auth_ok: false,
        notes: `命令不存在: ${command}`,
      });
      continue;
    }

    const checkLine = buildAuthCheck(engineId, command);
    const checkResult = await spawnText("zsh", ["-lc", checkLine], { timeoutMs: 8000 });
    rows.push({
      engine: engineId,
      command,
      command_exists: true,
      auth_ok: checkResult.ok,
      notes: checkResult.ok
        ? "ready"
        : (checkResult.stderr || checkResult.stdout || "认证检查失败").trim().slice(0, 200),
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ results: rows }, null, 2)}\n`);
  } else {
    for (const row of rows) {
      process.stdout.write(
        `[${row.engine}] command=${row.command} exists=${row.command_exists ? "yes" : "no"} auth=${row.auth_ok ? "ok" : "fail"}\n`,
      );
      if (row.notes) {
        process.stdout.write(`  - ${row.notes}\n`);
      }
    }
  }

  const hasFail = rows.some((row) => !row.command_exists || !row.auth_ok);
  process.exitCode = hasFail ? 1 : 0;
}

function hasModelArgs(args) {
  return args.some((arg) => {
    const t = String(arg).trim();
    return t === "--model" || t === "-m" || t.startsWith("--model=") || t.startsWith("-m=");
  });
}

function buildTaskRunArgs(engineId, prompt, model) {
  const args = [];

  if (model && !hasModelArgs(args)) {
    if (engineId === "opencode") {
      args.push("-m", model);
    } else {
      args.push(DEFAULT_MODEL_FLAG, model);
    }
  }

  if (engineId === "cursor") {
    args.push("agent", "-p", prompt);
    return args;
  }
  if (engineId === "opencode") {
    args.push("run", prompt);
    return args;
  }
  if (engineId === "gemini") {
    args.push("-p", prompt);
    return args;
  }
  if (engineId === "claude") {
    args.push("-p", prompt);
    return args;
  }
  if (engineId === "codex") {
    args.push("-p", prompt);
    return args;
  }

  args.push("-p", prompt);
  return args;
}

function createPseudoSessionId(engineId) {
  return `${engineId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSessionId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getSessionLogPath(sessionId) {
  return path.join(LOG_DIR, `${normalizeSessionId(sessionId)}.log`);
}

function appendSessionLog(sessionId, title, content) {
  ensureStateDir();
  const file = getSessionLogPath(sessionId);
  const now = new Date().toISOString();
  const text = [
    `\n[${now}] ${title}`,
    "------------------------------------------------------------",
    content?.trim() ? content : "(empty)",
    "",
  ].join("\n");
  fs.appendFileSync(file, text, "utf8");
}

function setActiveSession(state, engineId, sessionRecord) {
  state.sessions[sessionRecord.session_id] = {
    ...sessionRecord,
    updated_at: Date.now(),
  };
  state.last_sessions[engineId] = sessionRecord.session_id;
}

function resolveSession(state, engineId, sessionArg) {
  const sessionId =
    (typeof sessionArg === "string" && sessionArg.trim()) || state.last_sessions[engineId];
  if (!sessionId) {
    return null;
  }
  const session = state.sessions[sessionId];
  if (!session) {
    return null;
  }
  return session;
}

function getSessionLogSize(sessionId) {
  const file = getSessionLogPath(sessionId);
  if (!fs.existsSync(file)) {
    return 0;
  }
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function extractOpencodeSessionIds(text) {
  const ids = new Set();
  const patterns = [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    /\bsess_[A-Za-z0-9_-]{8,}\b/g,
  ];
  for (const re of patterns) {
    const matches = text.match(re);
    if (!matches) continue;
    for (const item of matches) {
      ids.add(item);
    }
  }
  return [...ids];
}

async function listOpencodeSessions(command, cwd) {
  const result = await spawnText(command, ["session", "list"], {
    cwd,
    timeoutMs: 10_000,
  });
  if (!result.ok) {
    return [];
  }
  return extractOpencodeSessionIds(`${result.stdout}\n${result.stderr}`);
}

async function runTaskRun(options) {
  const engineId = typeof options.engine === "string" ? options.engine : "";
  const prompt = typeof options.prompt === "string" ? options.prompt : "";
  if (!engineId || !prompt.trim()) {
    process.stderr.write("缺少必要参数：--engine 与 --prompt\n");
    process.exitCode = 2;
    return;
  }

  const command =
    (typeof options.command === "string" && options.command.trim()) ||
    DEFAULT_ENGINE_COMMAND[engineId];
  if (!command) {
    process.stderr.write(`未知引擎: ${engineId}\n`);
    process.exitCode = 2;
    return;
  }

  const exists = await checkCommandExists(command);
  if (!exists) {
    process.stderr.write(`命令不存在: ${command}\n`);
    process.exitCode = 1;
    return;
  }

  const model = typeof options.model === "string" ? options.model : "";
  const args = buildTaskRunArgs(engineId, prompt, model);
  const runCwd = typeof options.cwd === "string" ? options.cwd : process.cwd();
  const state = loadState();
  let beforeSessionIds = [];
  if (engineId === "opencode") {
    beforeSessionIds = await listOpencodeSessions(command, runCwd);
  }
  process.stdout.write(`启动任务: ${command} ${args.join(" ")}\n`);

  const timeoutMs = Number(options["timeout-ms"] || 0);
  const result = await spawnText(command, args, {
    cwd: runCwd,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 0,
    stream: true,
  });

  if (result.timeout) {
    const timeoutSessionId = createPseudoSessionId(engineId);
    setActiveSession(state, engineId, {
      session_id: timeoutSessionId,
      engine_id: engineId,
      command,
      cwd: runCwd,
      model,
      status: "error",
      native_session_id: null,
      mode: "pseudo",
      created_at: Date.now(),
      run_count: 1,
      send_count: 0,
    });
    saveState(state);
    appendSessionLog(
      timeoutSessionId,
      "run-timeout",
      `args: ${args.join(" ")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
    appendRunRecord({
      run_id: timeoutSessionId,
      engine_id: engineId,
      task_id: "",
      source: "bmad-cli",
      mode: "cli",
      status: "error",
      command,
      cwd: runCwd,
      model,
      created_at: Date.now(),
      updated_at: Date.now(),
      output_preview: (result.stderr || result.stdout || "").slice(0, 300),
      verification: null,
    });
    process.stderr.write(`\n任务超时，已尝试终止进程。会话已记录: ${timeoutSessionId}\n`);
    process.exitCode = 124;
    return;
  }

  if (!result.ok) {
    const failedSessionId = createPseudoSessionId(engineId);
    setActiveSession(state, engineId, {
      session_id: failedSessionId,
      engine_id: engineId,
      command,
      cwd: runCwd,
      model,
      status: "error",
      native_session_id: null,
      mode: "pseudo",
      created_at: Date.now(),
      run_count: 1,
      send_count: 0,
    });
    saveState(state);
    appendSessionLog(
      failedSessionId,
      "run-error",
      `args: ${args.join(" ")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
    appendRunRecord({
      run_id: failedSessionId,
      engine_id: engineId,
      task_id: "",
      source: "bmad-cli",
      mode: "cli",
      status: "error",
      command,
      cwd: runCwd,
      model,
      created_at: Date.now(),
      updated_at: Date.now(),
      output_preview: (result.stderr || result.stdout || "").slice(0, 300),
      verification: null,
    });
    process.stderr.write("\n任务执行失败。\n");
    process.exitCode = result.code ?? 1;
    return;
  }

  let sessionId = createPseudoSessionId(engineId);
  let nativeSessionId = null;
  let mode = "pseudo";
  if (engineId === "opencode") {
    const afterSessionIds = await listOpencodeSessions(command, runCwd);
    const createdSessionId =
      afterSessionIds.find((id) => !beforeSessionIds.includes(id)) ?? null;
    if (createdSessionId) {
      nativeSessionId = createdSessionId;
      sessionId = `opencode:${createdSessionId}`;
      mode = "native";
    }
  }

  setActiveSession(state, engineId, {
    session_id: sessionId,
    engine_id: engineId,
    command,
    cwd: runCwd,
    model,
    status: "active",
    native_session_id: nativeSessionId,
    mode,
    created_at: Date.now(),
    run_count: 1,
    send_count: 0,
  });
  saveState(state);
  appendSessionLog(
    sessionId,
    "run",
    `args: ${args.join(" ")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
  );
  appendRunRecord({
    run_id: sessionId,
    engine_id: engineId,
    task_id: "",
    source: "bmad-cli",
    mode: "cli",
    status: "done",
    command,
    cwd: runCwd,
    model,
    created_at: Date.now(),
    updated_at: Date.now(),
    output_preview: (result.stdout || result.stderr || "").slice(0, 300),
    verification: null,
  });
  process.stdout.write(`会话已记录: ${sessionId}\n`);
  process.stdout.write("\n任务执行完成。\n");
  process.exitCode = 0;
}

async function runTaskSend(options) {
  const engineId = typeof options.engine === "string" ? options.engine : "";
  if (!engineId) {
    process.stderr.write("缺少必要参数：--engine\n");
    process.exitCode = 2;
    return;
  }
  const content = typeof options.content === "string" ? options.content : "";
  if (!content.trim()) {
    process.stderr.write("缺少必要参数：--content\n");
    process.exitCode = 2;
    return;
  }

  const state = loadState();
  const sessionArg =
    (typeof options.session === "string" && options.session) ||
    (typeof options.id === "string" && options.id) ||
    "";
  const session = resolveSession(state, engineId, sessionArg);
  if (!session) {
    process.stderr.write("未找到会话，请先执行 task run 或显式传入 --session。\n");
    process.exitCode = 2;
    return;
  }

  const command =
    (typeof options.command === "string" && options.command.trim()) ||
    session.command ||
    DEFAULT_ENGINE_COMMAND[engineId];
  if (!command) {
    process.stderr.write(`未知引擎: ${engineId}\n`);
    process.exitCode = 2;
    return;
  }
  const exists = await checkCommandExists(command);
  if (!exists) {
    process.stderr.write(`命令不存在: ${command}\n`);
    process.exitCode = 1;
    return;
  }

  const model = typeof options.model === "string" ? options.model : session.model || "";
  let args = [];
  if (engineId === "opencode" && session.native_session_id) {
    args = ["run", "--session", session.native_session_id];
    if (model.trim()) {
      args.push("-m", model.trim());
    }
    args.push(content);
  } else {
    args = buildTaskRunArgs(engineId, content, model);
  }

  process.stdout.write(`发送到会话 ${session.session_id}\n`);

  const timeoutMs = Number(options["timeout-ms"] || 0);
  const result = await spawnText(command, args, {
    cwd: typeof options.cwd === "string" ? options.cwd : session.cwd || process.cwd(),
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 0,
    stream: true,
  });

  if (result.timeout) {
    session.status = "error";
    session.updated_at = Date.now();
    state.sessions[session.session_id] = session;
    saveState(state);
    appendSessionLog(
      session.session_id,
      "send-timeout",
      `args: ${args.join(" ")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
    appendRunRecord({
      run_id: `${session.session_id}-send-${Date.now()}`,
      engine_id: engineId,
      task_id: "",
      source: "bmad-cli",
      mode: "cli",
      status: "error",
      command,
      cwd: typeof options.cwd === "string" ? options.cwd : session.cwd || process.cwd(),
      model,
      created_at: Date.now(),
      updated_at: Date.now(),
      output_preview: (result.stderr || result.stdout || "").slice(0, 300),
      verification: null,
    });
    process.stderr.write("\n发送超时，已尝试终止进程。\n");
    process.exitCode = 124;
    return;
  }
  if (!result.ok) {
    session.status = "error";
    session.updated_at = Date.now();
    state.sessions[session.session_id] = session;
    saveState(state);
    appendSessionLog(
      session.session_id,
      "send-error",
      `args: ${args.join(" ")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
    appendRunRecord({
      run_id: `${session.session_id}-send-${Date.now()}`,
      engine_id: engineId,
      task_id: "",
      source: "bmad-cli",
      mode: "cli",
      status: "error",
      command,
      cwd: typeof options.cwd === "string" ? options.cwd : session.cwd || process.cwd(),
      model,
      created_at: Date.now(),
      updated_at: Date.now(),
      output_preview: (result.stderr || result.stdout || "").slice(0, 300),
      verification: null,
    });
    process.stderr.write("\n发送失败。\n");
    process.exitCode = result.code ?? 1;
    return;
  }

  session.status = "active";
  session.send_count = Number(session.send_count || 0) + 1;
  session.updated_at = Date.now();
  state.sessions[session.session_id] = session;
  state.last_sessions[engineId] = session.session_id;
  saveState(state);
  appendSessionLog(
    session.session_id,
    "send",
    `args: ${args.join(" ")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
  );
  appendRunRecord({
    run_id: `${session.session_id}-send-${Date.now()}`,
    engine_id: engineId,
    task_id: "",
    source: "bmad-cli",
    mode: "cli",
    status: "done",
    command,
    cwd: typeof options.cwd === "string" ? options.cwd : session.cwd || process.cwd(),
    model,
    created_at: Date.now(),
    updated_at: Date.now(),
    output_preview: (result.stdout || result.stderr || "").slice(0, 300),
    verification: null,
  });
  process.stdout.write("\n发送完成。\n");
  process.exitCode = 0;
}

async function runTaskStop(options) {
  const engineId = typeof options.engine === "string" ? options.engine : "";
  if (!engineId) {
    process.stderr.write("缺少必要参数：--engine\n");
    process.exitCode = 2;
    return;
  }
  const state = loadState();
  const sessionArg =
    (typeof options.session === "string" && options.session) ||
    (typeof options.id === "string" && options.id) ||
    "";
  const session = resolveSession(state, engineId, sessionArg);
  if (!session) {
    process.stderr.write("未找到会话，请显式传入 --session。\n");
    process.exitCode = 2;
    return;
  }

  const command =
    (typeof options.command === "string" && options.command.trim()) ||
    session.command ||
    DEFAULT_ENGINE_COMMAND[engineId];
  if (!command) {
    process.stderr.write(`未知引擎: ${engineId}\n`);
    process.exitCode = 2;
    return;
  }
  const exists = await checkCommandExists(command);
  if (!exists) {
    process.stderr.write(`命令不存在: ${command}\n`);
    process.exitCode = 1;
    return;
  }

  if (engineId === "opencode" && session.native_session_id) {
    const result = await spawnText(command, ["session", "delete", session.native_session_id], {
      cwd: typeof options.cwd === "string" ? options.cwd : session.cwd || process.cwd(),
      timeoutMs: 10_000,
      stream: true,
    });

    if (!result.ok) {
      appendSessionLog(
        session.session_id,
        "stop-error",
        `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
      );
      process.stderr.write("\n停止（删除会话）失败。\n");
      process.exitCode = result.code ?? 1;
      return;
    }
    appendSessionLog(
      session.session_id,
      "stop",
      `native_session_id=${session.native_session_id}\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
  } else {
    appendSessionLog(
      session.session_id,
      "stop",
      "当前引擎不支持原生命令会话中断，已在 CLI 状态中标记为 stopped。",
    );
  }

  session.status = "stopped";
  session.updated_at = Date.now();
  state.sessions[session.session_id] = session;
  if (state.last_sessions[engineId] === session.session_id) {
    delete state.last_sessions[engineId];
  }
  saveState(state);
  appendRunRecord({
    run_id: `${session.session_id}-stop-${Date.now()}`,
    engine_id: engineId,
    task_id: "",
    source: "bmad-cli",
    mode: "cli",
    status: "stopped",
    command,
    cwd: typeof options.cwd === "string" ? options.cwd : session.cwd || process.cwd(),
    model: session.model || "",
    created_at: Date.now(),
    updated_at: Date.now(),
    output_preview: "会话已停止",
    verification: null,
  });
  process.stdout.write(`\n会话已停止: ${session.session_id}\n`);
  process.exitCode = 0;
}

/**
 * 从文件尾部回溯读取最近若干行，避免大日志全量载入内存。
 * @param {string} filePath 日志文件路径
 * @param {number} limit 需要返回的行数
 * @param {number} maxBytes 最大读取字节数（兜底，避免极端场景无限回溯）
 * @returns {string}
 */
function readLastLinesFromFile(filePath, limit, maxBytes = 256 * 1024) {
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    return "";
  }

  const targetLines = Math.max(1, Math.floor(limit));
  const fd = fs.openSync(filePath, "r");
  try {
    const chunkSize = 8192;
    let position = stats.size;
    let bytesReadTotal = 0;
    let bufferParts = [];
    let newlineCount = 0;

    while (position > 0 && bytesReadTotal < maxBytes && newlineCount <= targetLines + 1) {
      const size = Math.min(chunkSize, position);
      position -= size;
      const buf = Buffer.allocUnsafe(size);
      const bytes = fs.readSync(fd, buf, 0, size, position);
      if (bytes <= 0) {
        break;
      }
      bytesReadTotal += bytes;
      const slice = buf.subarray(0, bytes).toString("utf8");
      bufferParts.unshift(slice);
      newlineCount += (slice.match(/\n/g) || []).length;
    }

    const text = bufferParts.join("");
    const lines = text.split(/\r?\n/);
    if (lines.length <= targetLines) {
      return lines.join("\n");
    }
    return lines.slice(lines.length - targetLines).join("\n");
  } finally {
    fs.closeSync(fd);
  }
}

async function runTaskLogs(options) {
  const engineId = typeof options.engine === "string" ? options.engine : "";
  if (!engineId) {
    process.stderr.write("缺少必要参数：--engine\n");
    process.exitCode = 2;
    return;
  }
  const state = loadState();
  const sessionArg =
    (typeof options.session === "string" && options.session) ||
    (typeof options.id === "string" && options.id) ||
    "";
  const session = resolveSession(state, engineId, sessionArg);
  if (!session) {
    process.stderr.write("未找到会话，请先执行 task run 或显式传入 --session。\n");
    process.exitCode = 2;
    return;
  }

  const logPath = getSessionLogPath(session.session_id);
  if (!fs.existsSync(logPath)) {
    const records = loadRunRecords();
    const matched = records.find((item) => item.run_id === session.session_id);
    if (matched && matched.output_preview) {
      process.stdout.write(`${matched.output_preview}\n`);
      process.exitCode = 0;
      return;
    }
    process.stderr.write(`未找到日志文件: ${logPath}\n`);
    process.exitCode = 1;
    return;
  }

  const limit = Number(options.limit || 200);
  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
  const output = readLastLinesFromFile(logPath, effectiveLimit);
  process.stdout.write(`${output}\n`);
  process.exitCode = 0;
}

async function runTaskList(options) {
  const engineFilter = typeof options.engine === "string" ? options.engine : "";
  const runRecords = loadRunRecords();
  if (runRecords.length > 0) {
    const rows = runRecords
      .filter((item) => (engineFilter ? item.engine_id === engineFilter : true))
      .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
      .map((item) => ({
        session_id: String(item.run_id || ""),
        engine_id: String(item.engine_id || ""),
        task_id: String(item.task_id || ""),
        status: String(item.status || "unknown"),
        mode: String(item.mode || "cli"),
        command: String(item.command || ""),
        cwd: String(item.cwd || ""),
        model: String(item.model || ""),
        run_count: 1,
        send_count: 0,
        created_at: Number(item.created_at || 0),
        updated_at: Number(item.updated_at || 0),
        log_size: getSessionLogSize(String(item.run_id || "")),
      }));
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ sessions: rows }, null, 2)}\n`);
      process.exitCode = 0;
      return;
    }
    if (rows.length === 0) {
      process.stdout.write("暂无会话记录。\n");
      process.exitCode = 0;
      return;
    }
    const lastByEngine = {};
    for (const row of rows) {
      if (!lastByEngine[row.engine_id]) {
        lastByEngine[row.engine_id] = row.session_id;
      }
    }
    for (const row of rows) {
      const isLast = lastByEngine[row.engine_id] === row.session_id;
      process.stdout.write(
        `[${row.engine_id}] ${row.session_id} status=${row.status} mode=${row.mode} run=${row.run_count} send=${row.send_count} log=${row.log_size}B${isLast ? " (last)" : ""}\n`,
      );
      process.stdout.write(`  - cwd=${row.cwd || "-"} model=${row.model || "-"}\n`);
    }
    process.exitCode = 0;
    return;
  }
  const state = loadState();
  const rows = Object.values(state.sessions)
    .filter((session) => {
      if (!engineFilter) return true;
      return session.engine_id === engineFilter;
    })
    .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
    .map((session) => ({
      session_id: session.session_id,
      engine_id: session.engine_id,
      status: session.status || "unknown",
      mode: session.mode || "pseudo",
      command: session.command || "",
      cwd: session.cwd || "",
      model: session.model || "",
      run_count: Number(session.run_count || 0),
      send_count: Number(session.send_count || 0),
      created_at: Number(session.created_at || 0),
      updated_at: Number(session.updated_at || 0),
      log_size: getSessionLogSize(session.session_id),
      is_last:
        state.last_sessions &&
        session.engine_id &&
        state.last_sessions[session.engine_id] === session.session_id,
    }));

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ sessions: rows }, null, 2)}\n`);
    process.exitCode = 0;
    return;
  }

  if (rows.length === 0) {
    process.stdout.write("暂无会话记录。\n");
    process.exitCode = 0;
    return;
  }

  for (const row of rows) {
    process.stdout.write(
      `[${row.engine_id}] ${row.session_id} status=${row.status} mode=${row.mode} run=${row.run_count} send=${row.send_count} log=${row.log_size}B${row.is_last ? " (last)" : ""}\n`,
    );
    process.stdout.write(`  - cwd=${row.cwd || "-"} model=${row.model || "-"}\n`);
  }
  process.exitCode = 0;
}

async function runTaskPrune(options) {
  const runRecords = loadRunRecords();
  if (runRecords.length > 0) {
    const engineFilter = typeof options.engine === "string" ? options.engine : "";
    const statusFilter = typeof options.status === "string" ? options.status : "";
    const olderThanHours = Number(options["older-than-hours"] || 0);
    const requireYes = !options.yes;
    if (requireYes) {
      process.stderr.write("该操作会删除会话和日志，请加 --yes 确认执行。\n");
      process.exitCode = 2;
      return;
    }
    const now = Date.now();
    const threshold =
      Number.isFinite(olderThanHours) && olderThanHours > 0
        ? now - olderThanHours * 60 * 60 * 1000
        : 0;
    const keep = [];
    const remove = [];
    for (const item of runRecords) {
      const passEngine = engineFilter ? item.engine_id === engineFilter : true;
      const passStatus = statusFilter ? item.status === statusFilter : true;
      const passTime = threshold > 0 ? Number(item.updated_at || 0) < threshold : true;
      if (passEngine && passStatus && passTime) {
        remove.push(item);
      } else {
        keep.push(item);
      }
    }
    saveRunRecords(keep);
    let deletedLogs = 0;
    for (const item of remove) {
      const logPath = getSessionLogPath(String(item.run_id || ""));
      if (fs.existsSync(logPath)) {
        try {
          fs.unlinkSync(logPath);
          deletedLogs += 1;
        } catch {
          // ignore
        }
      }
    }
    process.stdout.write(`已清理会话 ${remove.length} 条，删除日志 ${deletedLogs} 个。\n`);
    process.exitCode = 0;
    return;
  }
  const engineFilter = typeof options.engine === "string" ? options.engine : "";
  const statusFilter = typeof options.status === "string" ? options.status : "";
  const olderThanHours = Number(options["older-than-hours"] || 0);
  const requireYes = !options.yes;
  if (requireYes) {
    process.stderr.write("该操作会删除会话和日志，请加 --yes 确认执行。\n");
    process.exitCode = 2;
    return;
  }

  const state = loadState();
  const now = Date.now();
  const threshold =
    Number.isFinite(olderThanHours) && olderThanHours > 0
      ? now - olderThanHours * 60 * 60 * 1000
      : 0;

  const allSessions = Object.values(state.sessions);
  const toDelete = allSessions.filter((session) => {
    if (engineFilter && session.engine_id !== engineFilter) {
      return false;
    }
    if (statusFilter && session.status !== statusFilter) {
      return false;
    }
    if (threshold > 0 && Number(session.updated_at || 0) >= threshold) {
      return false;
    }
    return true;
  });

  if (toDelete.length === 0) {
    process.stdout.write("没有符合条件的会话可清理。\n");
    process.exitCode = 0;
    return;
  }

  let deletedLogs = 0;
  for (const session of toDelete) {
    const logPath = getSessionLogPath(session.session_id);
    if (fs.existsSync(logPath)) {
      try {
        fs.unlinkSync(logPath);
        deletedLogs += 1;
      } catch {
        // 忽略单个日志删除失败，保持尽量清理
      }
    }
    delete state.sessions[session.session_id];
    if (
      session.engine_id &&
      state.last_sessions &&
      state.last_sessions[session.engine_id] === session.session_id
    ) {
      delete state.last_sessions[session.engine_id];
    }
  }
  saveState(state);
  process.stdout.write(
    `已清理会话 ${toDelete.length} 条，删除日志 ${deletedLogs} 个。\n`,
  );
  process.exitCode = 0;
}

async function main() {
  const { positional, options } = parseArgv(process.argv.slice(2));
  if (positional.length === 0 || options.help || options.h) {
    printHelp();
    return;
  }

  if (positional[0] === "doctor") {
    await runDoctor(options);
    return;
  }

  if (positional[0] === "task" && positional[1] === "run") {
    await runTaskRun(options);
    return;
  }
  if (positional[0] === "task" && positional[1] === "send") {
    await runTaskSend(options);
    return;
  }
  if (positional[0] === "task" && positional[1] === "stop") {
    await runTaskStop(options);
    return;
  }
  if (positional[0] === "task" && positional[1] === "logs") {
    await runTaskLogs(options);
    return;
  }
  if (positional[0] === "task" && positional[1] === "list") {
    await runTaskList(options);
    return;
  }
  if (positional[0] === "task" && positional[1] === "prune") {
    await runTaskPrune(options);
    return;
  }

  process.stderr.write(`未知子命令: ${positional.join(" ")}\n\n`);
  printHelp();
  process.exitCode = 2;
}

void main();
