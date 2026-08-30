import { describe, it, expect } from "vitest";
import { endOfMonth, formatDay, isCompleteDate } from "@pablotech/akesi-pil/dates";

describe("endOfMonth", () => {
  it("coerces a month-only value to its last day", () => {
    expect(endOfMonth("2026-04")).toBe("2026-04-30");
    expect(endOfMonth("2026-05")).toBe("2026-05-31");
    expect(endOfMonth("2026-01")).toBe("2026-01-31");
  });
  it("handles February and leap years", () => {
    expect(endOfMonth("2025-02")).toBe("2025-02-28");
    expect(endOfMonth("2024-02")).toBe("2024-02-29");
  });
  it("coerces a year-only value to Dec 31", () => {
    expect(endOfMonth("2020")).toBe("2020-12-31");
  });
  it("passes a full date and empty through unchanged", () => {
    expect(endOfMonth("2026-04-15")).toBe("2026-04-15");
    expect(endOfMonth("")).toBe("");
    expect(endOfMonth(undefined)).toBe("");
    expect(endOfMonth(null)).toBe("");
  });
  it("is idempotent", () => {
    expect(endOfMonth(endOfMonth("2026-04"))).toBe("2026-04-30");
  });
});

describe("formatDay", () => {
  it("renders an abbreviated-month human date", () => {
    expect(formatDay("2026-04-30")).toBe("Apr 30, 2026");
    expect(formatDay("2026-05-01")).toBe("May 1, 2026");
  });
  it("coerces a month-only value to its last day first", () => {
    expect(formatDay("2026-04")).toBe("Apr 30, 2026");
    expect(formatDay("2026-12")).toBe("Dec 31, 2026");
  });
  it("returns empty for empty/undefined", () => {
    expect(formatDay("")).toBe("");
    expect(formatDay(undefined)).toBe("");
  });
});

describe("isCompleteDate", () => {
  it("is true for a full 4-digit year", () => {
    expect(isCompleteDate("2026-08-15")).toBe(true);
  });
  it("is false for an empty string", () => {
    expect(isCompleteDate("")).toBe(false);
  });
  // M107: typing "2" of "2026" into a date input reports "0002-08-15" — a zero-padded partial year,
  // not a real one. Must not be mistaken for complete.
  it("is false for a zero-padded partial year under 1000", () => {
    expect(isCompleteDate("0002-08-15")).toBe(false);
    expect(isCompleteDate("0099-08-15")).toBe(false);
  });
  it("is true right at the 1000 boundary", () => {
    expect(isCompleteDate("1000-01-01")).toBe(true);
    expect(isCompleteDate("0999-01-01")).toBe(false);
  });
});
