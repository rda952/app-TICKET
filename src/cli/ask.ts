// Usage : npm run ask -- "retail sdm ?"
// Simule la réponse du bot à une question posée dans #questions.
import { Store } from "../db.js";
import { findAnswer, formatAnswer } from "../knowledge.js";
import { isLikelyQuestion } from "../text.js";

const question = process.argv.slice(2).join(" ");
if (!question) {
  console.error('Usage : npm run ask -- "ta question"');
  process.exit(1);
}

const store = new Store();
if (!isLikelyQuestion(question)) console.log("(Le bot ne verrait pas ça comme une question, il resterait silencieux.)");
const answer = await findAnswer(store, question);
console.log(answer ? formatAnswer(answer) : "(Pas de réponse fiable dans la base : le bot laisse un humain répondre.)");
store.close();
