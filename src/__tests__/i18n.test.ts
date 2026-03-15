import { describe, expect, it } from "vitest";
import { translations } from "../i18n";

describe("i18n translations", () => {
  const zhKeys = Object.keys(translations.zh);
  const enKeys = Object.keys(translations.en);

  it("中英文 key 集合应一致", () => {
    const zhOnly = zhKeys.filter((k) => !enKeys.includes(k));
    const enOnly = enKeys.filter((k) => !zhKeys.includes(k));

    expect(zhOnly).toEqual([]);
    expect(enOnly).toEqual([]);
  });

  it("所有翻译值应为非空字符串或函数", () => {
    for (const key of zhKeys) {
      const zhVal = translations.zh[key as keyof typeof translations.zh];
      const enVal = translations.en[key as keyof typeof translations.en];
      expect(typeof zhVal === "string" || typeof zhVal === "function", `zh.${key} 类型异常`).toBe(true);
      expect(typeof enVal === "string" || typeof enVal === "function", `en.${key} 类型异常`).toBe(true);
    }
  });

  it("翻译条目数量 > 0", () => {
    expect(zhKeys.length).toBeGreaterThan(0);
    expect(enKeys.length).toBeGreaterThan(0);
  });
});
