// Usage : npm run fiches
// Affiche toutes les fiches de la base.
import { Store } from "../db.js";
import { formatFiche } from "../knowledge.js";

const store = new Store();
const subjects = store.subjects();
if (subjects.length === 0) console.log("Base vide. Commence par : npm run import -- exemples/questions.txt");
for (const s of subjects) console.log(formatFiche(store, s) + "\n");
store.close();
