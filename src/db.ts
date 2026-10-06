import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { type Field, type SubjectKind, normalize } from "./fields.js";

export type FactStatus = "pending" | "validated" | "rejected";

export interface StoredMessage {
  id: string;
  channelId: string;
  author: string;
  content: string;
  createdAt: string; // ISO
  url: string | null;
}

export interface Subject {
  id: number;
  kind: SubjectKind;
  name: string;
  aliases: string[];
}

export interface Fact {
  id: number;
  subjectId: number;
  field: Field;
  value: string;
  status: FactStatus;
  sourceUrl: string | null;
  sourceExcerpt: string | null;
  createdBy: string;
  createdAt: string;
  validatedBy: string | null;
}

export interface FactWithSubject extends Fact {
  subjectName: string;
  subjectKind: SubjectKind;
}

export class Store {
  private db: DatabaseSync;

  constructor(path = config.dbPath) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        url TEXT,
        extracted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS messages_extracted ON messages(extracted, created_at);
      CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        UNIQUE(kind, name)
      );
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY,
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        source_url TEXT,
        source_excerpt TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        validated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // --- Messages ---

  saveMessage(m: StoredMessage): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, channel_id, author, content, created_at, url)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.channelId, m.author, m.content, m.createdAt, m.url);
  }

  unextractedMessages(limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE extracted = 0 ORDER BY created_at LIMIT ?`,
      )
      .all(limit);
    return rows.map(rowToMessage);
  }

  markExtracted(ids: string[]): void {
    const stmt = this.db.prepare(`UPDATE messages SET extracted = 1 WHERE id = ?`);
    for (const id of ids) stmt.run(id);
  }

  messagesSince(isoDate: string): StoredMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE created_at >= ? ORDER BY created_at`)
      .all(isoDate);
    return rows.map(rowToMessage);
  }

  getMessage(id: string): StoredMessage | undefined {
    const row = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
    return row ? rowToMessage(row) : undefined;
  }

  // --- Sujets (événements, plateformes) ---

  subjects(): Subject[] {
    return this.db
      .prepare(`SELECT * FROM subjects ORDER BY name`)
      .all()
      .map(rowToSubject);
  }

  findSubject(name: string, kind?: SubjectKind): Subject | undefined {
    const wanted = normalize(name);
    if (!wanted) return undefined;
    return this.subjects().find(
      (s) =>
        (!kind || s.kind === kind) &&
        [s.name, ...s.aliases].some((n) => normalize(n) === wanted),
    );
  }

  /** Cherche les sujets dont le nom ou un alias apparaît dans le texte. */
  subjectsMentionedIn(text: string): Subject[] {
    const haystack = ` ${normalize(text)} `;
    return this.subjects().filter((s) =>
      [s.name, ...s.aliases].some((n) => {
        const needle = normalize(n);
        return needle.length >= 2 && haystack.includes(` ${needle} `);
      }),
    );
  }

  upsertSubject(kind: SubjectKind, name: string, aliases: string[] = []): Subject {
    const existing = this.findSubject(name, kind);
    if (existing) {
      const merged = [...existing.aliases];
      for (const a of aliases) {
        const known = [existing.name, ...merged].some((n) => normalize(n) === normalize(a));
        if (!known && normalize(a)) merged.push(a);
      }
      if (merged.length !== existing.aliases.length) {
        this.db
          .prepare(`UPDATE subjects SET aliases = ? WHERE id = ?`)
          .run(JSON.stringify(merged), existing.id);
      }
      return { ...existing, aliases: merged };
    }
    const result = this.db
      .prepare(`INSERT INTO subjects (kind, name, aliases) VALUES (?, ?, ?)`)
      .run(kind, name.trim(), JSON.stringify(aliases));
    return { id: Number(result.lastInsertRowid), kind, name: name.trim(), aliases };
  }

  // --- Faits ---

  /** Ajoute un fait s'il n'existe pas déjà (même sujet, champ et valeur). Renvoie l'id ou null si doublon. */
  addFact(input: {
    subjectId: number;
    field: Field;
    value: string;
    status?: FactStatus;
    sourceUrl?: string | null;
    sourceExcerpt?: string | null;
    createdBy: string;
    validatedBy?: string | null;
  }): number | null {
    const duplicate = this.factsForSubject(input.subjectId, ["pending", "validated", "rejected"]).find(
      (f) => f.field === input.field && normalize(f.value) === normalize(input.value),
    );
    if (duplicate) return null;
    const result = this.db
      .prepare(
        `INSERT INTO facts (subject_id, field, value, status, source_url, source_excerpt, created_by, created_at, validated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.subjectId,
        input.field,
        input.value.trim(),
        input.status ?? "pending",
        input.sourceUrl ?? null,
        input.sourceExcerpt ?? null,
        input.createdBy,
        new Date().toISOString(),
        input.validatedBy ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  setFactStatus(id: number, status: FactStatus, by: string): FactWithSubject | undefined {
    this.db
      .prepare(`UPDATE facts SET status = ?, validated_by = ? WHERE id = ?`)
      .run(status, by, id);
    return this.getFact(id);
  }

  getFact(id: number): FactWithSubject | undefined {
    const row = this.db
      .prepare(
        `SELECT f.*, s.name AS subject_name, s.kind AS subject_kind
         FROM facts f JOIN subjects s ON s.id = f.subject_id WHERE f.id = ?`,
      )
      .get(id);
    return row ? rowToFactWithSubject(row) : undefined;
  }

  factsForSubject(subjectId: number, statuses: FactStatus[] = ["validated", "pending"]): Fact[] {
    const placeholders = statuses.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM facts WHERE subject_id = ? AND status IN (${placeholders}) ORDER BY created_at`,
      )
      .all(subjectId, ...statuses)
      .map(rowToFact);
  }

  pendingFacts(limit: number): FactWithSubject[] {
    return this.db
      .prepare(
        `SELECT f.*, s.name AS subject_name, s.kind AS subject_kind
         FROM facts f JOIN subjects s ON s.id = f.subject_id
         WHERE f.status = 'pending' ORDER BY f.created_at LIMIT ?`,
      )
      .all(limit)
      .map(rowToFactWithSubject);
  }

  // --- Réglages internes ---

  getMeta(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key);
    return row ? String(row.value) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

type Row = Record<string, unknown>;

function rowToMessage(r: Row): StoredMessage {
  return {
    id: String(r.id),
    channelId: String(r.channel_id),
    author: String(r.author),
    content: String(r.content),
    createdAt: String(r.created_at),
    url: (r.url as string | null) ?? null,
  };
}

function rowToSubject(r: Row): Subject {
  return {
    id: Number(r.id),
    kind: r.kind as SubjectKind,
    name: String(r.name),
    aliases: JSON.parse(String(r.aliases)) as string[],
  };
}

function rowToFact(r: Row): Fact {
  return {
    id: Number(r.id),
    subjectId: Number(r.subject_id),
    field: r.field as Field,
    value: String(r.value),
    status: r.status as FactStatus,
    sourceUrl: (r.source_url as string | null) ?? null,
    sourceExcerpt: (r.source_excerpt as string | null) ?? null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    validatedBy: (r.validated_by as string | null) ?? null,
  };
}

function rowToFactWithSubject(r: Row): FactWithSubject {
  return {
    ...rowToFact(r),
    subjectName: String(r.subject_name),
    subjectKind: r.subject_kind as SubjectKind,
  };
}
