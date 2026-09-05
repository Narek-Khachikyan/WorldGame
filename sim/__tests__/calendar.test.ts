import { describe, it, expect } from "vitest";
import { GameCalendar, START_DATE, addDays, parseGameDate, formatGameDate, isLeapYear, daysInMonth } from "../calendar.js";

describe("calendar", () => {
  it("starts at 2026-01-01", () => {
    const cal = new GameCalendar();
    expect(cal.getDateString()).toBe("2026-01-01");
    expect(cal.getDaysElapsed()).toBe(0);
    expect(START_DATE).toBe("2026-01-01");
  });

  it("ticks days sequentially", () => {
    const cal = new GameCalendar();
    cal.tick(1);
    expect(cal.getDateString()).toBe("2026-01-02");
    expect(cal.getDaysElapsed()).toBe(1);
    cal.tick(30);
    expect(cal.getDateString()).toBe("2026-02-01");
    expect(cal.getDaysElapsed()).toBe(31);
  });

  it("handles month / year boundaries and leap year 2028", () => {
    const cal = new GameCalendar("2028-02-28");
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    cal.tick(1);
    expect(cal.getDateString()).toBe("2028-02-29");
    cal.tick(1);
    expect(cal.getDateString()).toBe("2028-03-01");
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("handles year wrap", () => {
    const cal = new GameCalendar("2026-12-31");
    cal.tick(1);
    expect(cal.getDateString()).toBe("2027-01-01");
  });

  it("addDays helper advances date deterministically and is pure", () => {
    expect(addDays("2026-01-01", 30)).toBe("2026-01-31");
    expect(addDays("2026-01-01", 31)).toBe("2026-02-01");
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01"); // 2026 not leap
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    // pure: same inputs give same output, original not mutated
    const orig = "2026-01-01";
    expect(addDays(orig, 10)).toBe("2026-01-11");
    expect(orig).toBe("2026-01-01");
    expect(parseGameDate("2026-01-01").getUTCFullYear()).toBe(2026);
    expect(formatGameDate(parseGameDate("2026-06-15"))).toBe("2026-06-15");
  });

  it("rejects negative or non-integer tick", () => {
    const cal = new GameCalendar();
    expect(() => cal.tick(-1)).toThrow();
    expect(() => cal.tick(1.5 as unknown as number)).toThrow();
  });

  it("365 days from 2026-01-01 lands on 2027-01-01", () => {
    const cal = new GameCalendar();
    cal.tick(365);
    expect(cal.getDateString()).toBe("2027-01-01");
    expect(cal.getDaysElapsed()).toBe(365);
  });
});
