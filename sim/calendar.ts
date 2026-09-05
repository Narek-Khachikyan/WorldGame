/** Unified calendar — start 2026-01-01, base step 1 game day. Pure UTC. */

export const START_DATE: string = "2026-01-01";

export function parseGameDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatGameDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = parseGameDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatGameDate(d);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  // month 1-12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Lightweight calendar helper used by engine. */
export class GameCalendar {
  private current: Date;
  private _daysElapsed = 0;

  constructor(startDate: string = START_DATE) {
    this.current = parseGameDate(startDate);
  }

  getDateString(): string {
    return formatGameDate(this.current);
  }

  getDaysElapsed(): number {
    return this._daysElapsed;
  }

  getDate(): Date {
    return new Date(this.current.getTime());
  }

  /** Advance by integer days. */
  tick(days: number): void {
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(`tick days must be non-negative integer, got ${days}`);
    }
    if (days === 0) return;
    this.current.setUTCDate(this.current.getUTCDate() + days);
    this._daysElapsed += days;
  }

  /** Restore from save — sets date and daysElapsed without bypassing encapsulation via casts. */
  restoreState(dateString: string, daysElapsed: number): void {
    this.current = parseGameDate(dateString);
    this._daysElapsed = daysElapsed;
  }

  clone(): GameCalendar {
    const c = new GameCalendar(formatGameDate(this.current));
    // @ts-ignore private override for clone fidelity
    c._daysElapsed = this._daysElapsed;
    return c;
  }
}
