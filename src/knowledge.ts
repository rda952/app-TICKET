import { answerQuestion, extractFacts } from "./ai.js";
import type { FactWithSubject, Store, Subject } from "./db.js";
import { FIELDS, FIELDS_BY_KIND } from "./fields.js";

const BATCH_SIZE = 150;

/** Lit les messages pas encore analysés et ajoute les faits trouvés (en attente de validation). */
export async function runExtraction(store: Store): Promise<FactWithSubject[]> {
  const added: FactWithSubject[] = [];
  for (;;) {
    const batch = store.unextractedMessages(BATCH_SIZE);
    if (batch.length === 0) break;
    const facts = await extractFacts(batch, store.subjects());
    for (const f of facts) {
      const subject = store.upsertSubject(f.subject_kind, f.subject_name, f.subject_aliases);
      const source = store.getMessage(f.source_message_id);
      const id = store.addFact({
        subjectId: subject.id,
        field: f.field,
        value: f.value,
        sourceUrl: source?.url ?? null,
        sourceExcerpt: source ? `${source.author} : ${source.content.slice(0, 200)}` : null,
        createdBy: "ia",
      });
      const stored = id === null ? undefined : store.getFact(id);
      if (stored) added.push(stored);
    }
    store.markExtracted(batch.map((m) => m.id));
  }
  return added;
}

/** Cherche une réponse dans la base. Renvoie null si rien de fiable : le bot reste alors silencieux. */
export async function findAnswer(
  store: Store,
  question: string,
): Promise<{ text: string; facts: FactWithSubject[] } | null> {
  const subjects = store.subjectsMentionedIn(question);
  if (subjects.length === 0) return null;
  const facts = subjects.flatMap((s) =>
    store.factsForSubject(s.id).map((f) => ({ ...f, subjectName: s.name, subjectKind: s.kind })),
  );
  const answer = await answerQuestion(question, facts);
  if (!answer) return null;
  return { text: answer.answer, facts: facts.filter((f) => answer.usedFactIds.includes(f.id)) };
}

export function formatAnswer(answer: { text: string; facts: FactWithSubject[] }): string {
  const confirmed = answer.facts.every((f) => f.status === "validated");
  const sources = answer.facts
    .map((f) => f.sourceUrl)
    .filter((u): u is string => Boolean(u))
    .slice(0, 3)
    .map((u) => `<${u}>`)
    .join(" ");
  const badge = confirmed ? "✅ validé par le staff" : "⚠️ non confirmé par le staff";
  return `${answer.text}\n-# ${badge}${sources ? ` · sources : ${sources}` : ""}`;
}

export function formatFiche(store: Store, subject: Subject): string {
  const facts = store.factsForSubject(subject.id);
  const title = `**${subject.kind === "event" ? "🎫" : "🏪"} ${subject.name}**`;
  const aliases = subject.aliases.length ? `\n-# alias : ${subject.aliases.join(", ")}` : "";
  if (facts.length === 0) return `${title}${aliases}\nAucune info pour l'instant.`;
  const fields = [...new Set([...FIELDS_BY_KIND[subject.kind], ...facts.map((f) => f.field)])];
  const sections = fields.flatMap((field) => {
    const lines = facts
      .filter((f) => f.field === field)
      .map((f) => `- ${f.status === "validated" ? "✅" : "⏳"} ${f.value}`);
    return lines.length ? [`__${FIELDS[field]}__\n${lines.join("\n")}`] : [];
  });
  return `${title}${aliases}\n${sections.join("\n")}\n-# ✅ validé staff · ⏳ en attente de validation`;
}
