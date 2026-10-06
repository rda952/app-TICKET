import { normalize } from "./fields.js";

const INTERROGATIVES = /^(comment|quand|combien|pourquoi|est ce|c est quoi|c quoi|quel|quelle|quels|quelles)\b/;
const ASKS_SOMEONE = /\b(qqn|qqun|quelqu un|vous savez|tu sais|y a t il)\b/;

/** Heuristique bon marché pour éviter d'appeler l'IA sur chaque message. */
export function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 6) return false;
  if (trimmed.includes("?")) return true;
  const n = normalize(trimmed);
  return INTERROGATIVES.test(n) || ASKS_SOMEONE.test(n);
}

export interface ParsedMessage {
  author: string;
  date: string; // ISO
  content: string;
}

// « Pseudo — 29/09/2026 13:02 », « Pseudo — Hier à 18:55 », « Pseudo [TAG],  — 01/10/2026 18:35 »
const HEADER = /^(?:\d+\.\s*)?(.+?)\s+—\s+(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}|(?:Hier|Aujourd’hui|Aujourd'hui)\s+à\s+\d{1,2}:\d{2})\s*$/;

/**
 * Lit un copier-coller de salon Discord (format de l'app, en français) et le découpe en messages.
 * Les lignes sans en-tête sont rattachées au message précédent.
 */
export function parseDiscordExport(raw: string, now = new Date()): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = HEADER.exec(line);
    if (header) {
      current = { author: cleanAuthor(header[1]), date: parseDate(header[2], now), content: "" };
      messages.push(current);
      continue;
    }
    const text = line.replace(/^\d+\.\s*/, "").trim();
    if (!text || !current) continue;
    current.content = current.content ? `${current.content}\n${text}` : text;
  }
  return messages.filter((m) => m.content);
}

function cleanAuthor(raw: string): string {
  return raw.replace(/\s*\[[^\]]*\]/g, "").replace(/[,\s]+$/, "").trim();
}

function parseDate(raw: string, now: Date): string {
  const full = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(raw);
  if (full) {
    const [, d, m, y, h, min] = full;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min)).toISOString();
  }
  const rel = /(Hier|Aujourd.hui)\s+à\s+(\d{1,2}):(\d{2})/.exec(raw);
  const date = new Date(now);
  if (rel) {
    if (rel[1] === "Hier") date.setDate(date.getDate() - 1);
    date.setHours(Number(rel[2]), Number(rel[3]), 0, 0);
  }
  return date.toISOString();
}
