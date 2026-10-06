// Usage : npm run import -- chemin/vers/export.txt [--tout-valider]
// Lit un copier-coller de salon Discord, l'enregistre et en extrait les infos, sans avoir besoin du bot.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Store } from "../db.js";
import { FIELDS } from "../fields.js";
import { runExtraction } from "../knowledge.js";
import { parseDiscordExport } from "../text.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage : npm run import -- chemin/vers/export.txt [--tout-valider]");
  process.exit(1);
}

const store = new Store();
const parsed = parseDiscordExport(readFileSync(file, "utf8"));
const channel = basename(file);
for (const m of parsed) {
  const id = "import-" + createHash("sha1").update(`${channel}|${m.author}|${m.date}|${m.content}`).digest("hex").slice(0, 16);
  store.saveMessage({ id, channelId: channel, author: m.author, content: m.content, createdAt: m.date, url: null });
}
console.log(`${parsed.length} messages lus dans ${channel}. Analyse en cours…`);

const added = await runExtraction(store);
for (const f of added) {
  if (args.includes("--tout-valider")) store.setFactStatus(f.id, "validated", "import");
  console.log(`+ ${f.subjectName} › ${FIELDS[f.field]} : ${f.value}`);
}
console.log(`\n${added.length} info(s) ajoutée(s)${args.includes("--tout-valider") ? " et validée(s)" : " en attente de validation"}.`);
store.close();
