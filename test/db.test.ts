import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../src/db.js";

test("fusionne les sujets par nom ou alias et évite les doublons", () => {
  const store = new Store(":memory:");
  const sdm = store.upsertSubject("event", "Stade de France – SDM", ["sdm"]);
  const again = store.upsertSubject("event", "SDM", ["stade de france"]);
  assert.equal(again.id, sdm.id);

  assert.deepEqual(store.subjectsMentionedIn("On a les retail SDM ?").map((s) => s.id), [sdm.id]);
  assert.equal(store.subjectsMentionedIn("rien à voir avec sdmx").length, 0);

  const id = store.addFact({ subjectId: sdm.id, field: "date_drop", value: "Jeudi 02/10/2026", createdBy: "ia" });
  assert.ok(id);
  assert.equal(store.addFact({ subjectId: sdm.id, field: "date_drop", value: "jeudi 02/10/2026 ", createdBy: "ia" }), null);
  assert.equal(store.pendingFacts(10).length, 1);

  store.setFactStatus(id!, "validated", "staff");
  assert.equal(store.pendingFacts(10).length, 0);
  assert.equal(store.factsForSubject(sdm.id)[0].status, "validated");
  store.close();
});
