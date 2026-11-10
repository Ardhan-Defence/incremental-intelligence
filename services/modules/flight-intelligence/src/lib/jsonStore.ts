import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal durable store: an in-memory array, written to a JSON file on every
 * mutation and loaded once at startup. Scaffold-grade substitute for a real
 * database — fine for watchlist entries/alerts at this module's current
 * scale. Swap for Postgres/SQLite before this runs as more than one replica.
 */
export class JsonStore<T> {
  private items: T[] = [];

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      try {
        this.items = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        this.items = [];
      }
    } else {
      mkdirSync(dirname(filePath), { recursive: true });
    }
  }

  private persist() {
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2));
  }

  all(): T[] {
    return this.items;
  }

  add(item: T): T {
    this.items.push(item);
    this.persist();
    return item;
  }

  update(predicate: (item: T) => boolean, mutate: (item: T) => void): boolean {
    const item = this.items.find(predicate);
    if (!item) return false;
    mutate(item);
    this.persist();
    return true;
  }

  remove(predicate: (item: T) => boolean): boolean {
    const before = this.items.length;
    this.items = this.items.filter((i) => !predicate(i));
    if (this.items.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }
}
