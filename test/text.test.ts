import assert from "node:assert/strict";
import { test } from "node:test";
import { isLikelyQuestion, parseDiscordExport } from "../src/text.js";

test("reconnaît les questions typiques du salon", () => {
  assert.ok(isLikelyQuestion("On a les retail sdm ?"));
  assert.ok(isLikelyQuestion("hello quelqu'un a les retail de sdm please"));
  assert.ok(isLikelyQuestion("Comment lister x6 sur VGG pour oasis"));
  assert.ok(!isLikelyQuestion("jeudi"));
  assert.ok(!isLikelyQuestion("merci boss"));
  assert.ok(!isLikelyQuestion("Panique pas ça va arriver"));
});

test("découpe un copier-coller Discord en messages", () => {
  const raw = [
    "1. Membre1 [BVIP],  — 29/09/2026 13:02",
    "2. Ça drop quand sdm ?",
    "3. Membre2 — 29/09/2026 13:05",
    "jeudi apparement",
    "suite du message",
    "Membre3 — Hier à 18:55",
    "Dasheet Pro est dispo",
  ].join("\n");
  const now = new Date(2026, 9, 6, 12, 0);
  const messages = parseDiscordExport(raw, now);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].author, "Membre1");
  assert.equal(messages[0].content, "Ça drop quand sdm ?");
  assert.equal(messages[1].content, "jeudi apparement\nsuite du message");
  assert.equal(new Date(messages[0].date).getDate(), 29);
  assert.equal(new Date(messages[2].date).getDate(), 5);
});
