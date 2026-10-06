import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config.js";
import type { FactWithSubject, StoredMessage, Subject } from "./db.js";
import { FIELD_KEYS, FIELDS, FIELDS_BY_KIND } from "./fields.js";

const client = new Anthropic();

// Si une requête est refusée par les filtres de sécurité, l'API la relance sur un modèle de repli.
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

const RULES = `Tu travailles pour un serveur Discord francophone de revente de billets (concerts, sport, spectacles).
Règles absolues :
- Ne retiens et ne donne que des informations pratiques et licites : dates de sortie, prix retail, type de billet, méthode de livraison, correspondance de sections, frais et délais de paiement des plateformes, démarches de litige.
- Ignore tout ce qui sert à contourner les protections des billetteries (bots, contournement de files d'attente ou d'OTP, comptes sous fausse identité, multi-comptes) et toute donnée personnelle.
- N'invente jamais rien.`;

function formatMessages(messages: StoredMessage[]): string {
  return messages
    .map((m) => `[${m.id}] ${m.author} (${m.createdAt}) : ${m.content.replace(/\s+/g, " ")}`)
    .join("\n");
}

function fieldGuide(): string {
  return Object.entries(FIELDS)
    .map(([key, label]) => `- ${key} : ${label}`)
    .join("\n");
}

// --- Extraction de faits depuis les messages ---

const ExtractionSchema = z.object({
  facts: z.array(
    z.object({
      subject_kind: z.enum(["event", "platform"]),
      subject_name: z.string(),
      subject_aliases: z.array(z.string()),
      field: z.enum(FIELD_KEYS),
      value: z.string(),
      source_message_id: z.string(),
    }),
  ),
});

export type ExtractedFact = z.infer<typeof ExtractionSchema>["facts"][number];

export async function extractFacts(
  messages: StoredMessage[],
  knownSubjects: Subject[],
): Promise<ExtractedFact[]> {
  if (messages.length === 0) return [];
  const known =
    knownSubjects.map((s) => `- ${s.kind} : ${s.name} (alias : ${s.aliases.join(", ") || "aucun"})`).join("\n") ||
    "(aucun pour l'instant)";

  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
    system: `${RULES}

Ta tâche : lire des messages Discord et en extraire les faits réutilisables qui pourraient répondre aux questions futures des membres.

Champs possibles :
${fieldGuide()}
Champs pertinents pour un événement : ${FIELDS_BY_KIND.event.join(", ")}.
Champs pertinents pour une plateforme (Viagogo, Seatiks, Ticketmaster…) : ${FIELDS_BY_KIND.platform.join(", ")}.

Consignes :
- Un fait = une information affirmée (pas une question, pas une rumeur, pas une blague, pas une opinion isolée). Une réponse courte à une question compte (ex. « jeudi » en réponse à « ça drop quand SDM ? » → date_drop de SDM).
- Convertis les dates relatives (« jeudi », « demain ») en dates absolues grâce à la date du message, et garde le jour : « jeudi 02/10/2026 ».
- Réutilise exactement le nom d'un sujet déjà connu quand il s'agit du même. Sinon, choisis un nom clair (ex. « Céline Dion – Paris La Défense Arena 2026 ») et mets les abréviations utilisées par les membres dans subject_aliases (ex. « céline », « sdm »).
- value : une phrase courte, autonome et précise, compréhensible sans le contexte.
- source_message_id : l'id entre crochets du message qui contient l'info.
- S'il n'y a rien d'utile, renvoie une liste vide. Mieux vaut peu de faits fiables que beaucoup de faits douteux.

Sujets déjà connus :
${known}`,
    messages: [{ role: "user", content: formatMessages(messages) }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) return [];
  const ids = new Set(messages.map((m) => m.id));
  return response.parsed_output.facts.filter((f) => ids.has(f.source_message_id));
}

// --- Réponse à une question ---

const AnswerSchema = z.object({
  should_answer: z.boolean(),
  answer: z.string(),
  used_fact_ids: z.array(z.number()),
});

export interface Answer {
  answer: string;
  usedFactIds: number[];
}

export async function answerQuestion(question: string, facts: FactWithSubject[]): Promise<Answer | null> {
  if (facts.length === 0) return null;
  const kb = facts
    .map(
      (f) =>
        `#${f.id} [${f.status === "validated" ? "validé staff" : "non confirmé"}] ${f.subjectName} › ${FIELDS[f.field]} : ${f.value} (ajouté le ${f.createdAt.slice(0, 10)})`,
    )
    .join("\n");

  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(AnswerSchema) },
    system: `${RULES}

Tu réponds aux questions des membres uniquement à partir de la base de connaissances fournie.
- should_answer = true seulement si un ou plusieurs faits répondent vraiment à la question. Sinon should_answer = false et answer vide : un humain prendra le relais.
- answer : en français, court (1 à 3 phrases), ton direct comme sur Discord, sans formule de politesse.
- Si un fait utilisé est « non confirmé », dis-le clairement.
- used_fact_ids : les numéros (#) des faits utilisés.`,
    messages: [
      {
        role: "user",
        content: `Base de connaissances :\n${kb}\n\nQuestion du membre :\n${question}`,
      },
    ],
  });

  const out = response.parsed_output;
  if (response.stop_reason === "refusal" || !out || !out.should_answer || !out.answer.trim()) return null;
  const known = new Set(facts.map((f) => f.id));
  const used = out.used_fact_ids.filter((id) => known.has(id));
  if (used.length === 0) return null;
  return { answer: out.answer.trim(), usedFactIds: used };
}

// --- Résumé quotidien ---

export async function dailyDigest(messages: StoredMessage[]): Promise<string | null> {
  if (messages.length === 0) return null;
  const stream = client.beta.messages.stream({
    model: config.model,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "medium" },
    system: `${RULES}

Tu écris le résumé quotidien du serveur pour des membres qui n'ont pas pu tout lire.
Format Discord, 1800 caractères maximum, en français :
- **Drops & dates** : sorties annoncées, dates, prix retail
- **Livraison & plateformes** : problèmes rencontrés et solutions trouvées
- **À retenir** : 2-3 infos marquantes
Uniquement des faits présents dans les messages. Omets une rubrique vide. Pas d'introduction ni de conclusion.`,
    messages: [{ role: "user", content: formatMessages(messages) }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  return text || null;
}
