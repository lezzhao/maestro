import { describe, expect, it } from "vitest";
import {
  stripAnsi,
  decodeTransportEscapes,
  squashCarriageReturns,
  normalizeTerminalChunk,
  extractReadableTerminalChunk,
  extractTokenDelta,
} from "../lib/utils/terminal";

describe("stripAnsi", () => {
  it("移除 ANSI 颜色代码", () => {
    expect(stripAnsi("\x1B[31mhello\x1B[0m")).toBe("hello");
  });

  it("移除多个 ANSI 序列", () => {
    expect(stripAnsi("\x1B[1;32mgreen\x1B[0m \x1B[34mblue\x1B[0m")).toBe("green blue");
  });

  it("纯文本不受影响", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("空字符串返回空字符串", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("decodeTransportEscapes", () => {
  it("解码 JSON 引号包裹的字符串", () => {
    expect(decodeTransportEscapes('"hello world"')).toBe("hello world");
  });

  it("解码 \\n 转义", () => {
    expect(decodeTransportEscapes("line1\\nline2")).toBe("line1\nline2");
  });

  it("解码 \\r 转义", () => {
    expect(decodeTransportEscapes("a\\rb")).toBe("a\rb");
  });

  it("解码 \\t 转义", () => {
    expect(decodeTransportEscapes("a\\tb")).toBe("a\tb");
  });

  it("解码 unicode 转义 \\uXXXX", () => {
    expect(decodeTransportEscapes("\\u0041")).toBe("A");
  });

  it("解码双反斜杠", () => {
    expect(decodeTransportEscapes("a\\\\b")).toBe("a\\b");
  });

  it("不影响普通文本", () => {
    expect(decodeTransportEscapes("hello")).toBe("hello");
  });
});

describe("squashCarriageReturns", () => {
  it("保留 \\r 后的最终内容", () => {
    expect(squashCarriageReturns("old\rnew")).toBe("new");
  });

  it("多行只处理包含 \\r 的行", () => {
    expect(squashCarriageReturns("line1\nold\rnew\nline3")).toBe("line1\nnew\nline3");
  });

  it("无 \\r 则原样返回", () => {
    expect(squashCarriageReturns("hello\nworld")).toBe("hello\nworld");
  });
});

describe("normalizeTerminalChunk", () => {
  it("清理 ANSI + 控制字符", () => {
    const input = "\x1B[32mhello\x1B[0m\x00world";
    const result = normalizeTerminalChunk(input);
    expect(result).toBe("helloworld");
  });

  it("清理 OSC 序列", () => {
    const input = "\x1B]0;title\x07rest";
    expect(normalizeTerminalChunk(input)).toBe("rest");
  });

  it("空字符串返回空字符串", () => {
    expect(normalizeTerminalChunk("")).toBe("");
  });
});

describe("extractReadableTerminalChunk", () => {
  it("在 \\r 场景下保留可读文本", () => {
    const input = "进度 10%\r进度 50%\r完成";
    expect(extractReadableTerminalChunk(input)).toContain("完成");
  });

  it("控制序列为空时返回空字符串", () => {
    const input = "\x1B[2K\r\x1B[0m";
    expect(extractReadableTerminalChunk(input)).toBe("");
  });
});

describe("extractTokenDelta", () => {
  it("提取 input 和 output token 数", () => {
    const result = extractTokenDelta("input tokens: 150, output tokens: 300");
    expect(result.approx_input_tokens).toBe(150);
    expect(result.approx_output_tokens).toBe(300);
  });

  it("只有 input 时 output 为 0", () => {
    const result = extractTokenDelta("input: 42");
    expect(result.approx_input_tokens).toBe(42);
    expect(result.approx_output_tokens).toBe(0);
  });

  it("无匹配时返回 0", () => {
    const result = extractTokenDelta("no tokens here");
    expect(result.approx_input_tokens).toBe(0);
    expect(result.approx_output_tokens).toBe(0);
  });
});
