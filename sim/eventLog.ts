import type { SimEvent } from "./types.js";

export class EventLog {
  private events: SimEvent[] = [];
  private nextId = 1;

  append(date: string, kind: string, payload?: unknown, message?: string): SimEvent {
    const ev: SimEvent = {
      id: this.nextId++,
      date,
      kind,
      payload,
      message,
    };
    this.events.push(ev);
    return ev;
  }

  /** All events in order. Returns copy. */
  getAll(): readonly SimEvent[] {
    return [...this.events];
  }

  getTail(n: number): readonly SimEvent[] {
    if (n <= 0) return [];
    return this.events.slice(-n);
  }

  getByKind(kind: string): readonly SimEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  clear(): void {
    this.events = [];
    this.nextId = 1;
  }

  /** Restore tail from save — clears and re-appends, restoring nextId. */
  restoreTail(tail: SimEvent[]): void {
    this.events = [];
    this.nextId = 1;
    for (const e of tail) {
      this.events.push({ ...e });
    }
    if (tail.length > 0) {
      const maxId = Math.max(...tail.map((e) => e.id));
      this.nextId = maxId + 1;
    }
  }

  get size(): number {
    return this.events.length;
  }
}
