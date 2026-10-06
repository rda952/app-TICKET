# Ticket Copilot

Bot Discord pour les groupes de revente de billets. Il transforme le flot de messages du serveur en **fiches claires** et **répond tout seul aux questions qui reviennent sans arrêt** (« retail SDM ? », « ça drop quand ? », « quel type de billet ? », « délai de paiement Seatiks ? »…).

Il ne gère pas le stock et ne met rien en vente : Tikey, Dasheet, Seatiks, etc. le font déjà. Lui s'occupe de l'**information**.

## Ce que fait le MVP

| Fonction | Comment |
|---|---|
| **Fiches événement / plateforme** | L'IA lit les salons choisis toutes les 10 min et en tire les infos utiles : date de drop, prix retail, type de billet, livraison, correspondance des sections, frais, délais de paiement… |
| **Validation par le staff** | Les infos trouvées par l'IA sont « ⏳ en attente ». `/a-valider` les affiche avec des boutons Valider / Rejeter. `/ajouter` permet au staff de saisir une info directement. |
| **Réponse automatique** | Dans #questions, si une question porte sur un sujet connu et que la base a la réponse, le bot répond en citant ses sources. Sinon il reste silencieux et un humain prend le relais. |
| **Résumé quotidien** | Chaque jour, un résumé des dernières 24 h est posté dans le salon choisi (`/resume` pour le lancer à la main). |
| **`/fiche`** | N'importe quel membre peut afficher la fiche d'un événement ou d'une plateforme. |

Le bot ignore volontairement tout ce qui sert à contourner les protections des billetteries (bots, OTP, multi-comptes) et les données personnelles.

## Essayer sans Discord (2 minutes)

Il faut [Node.js](https://nodejs.org) 22.13+ et une clé API Claude.

```bash
npm install
cp .env.example .env          # puis mets ta clé dans ANTHROPIC_API_KEY
npm run import -- exemples/questions.txt   # colle tes propres exports dans un .txt pour tester
npm run fiches                             # voir les fiches générées
npm run ask -- "on a la date du drop sdm ?"  # simuler une question dans #questions
```

Pour tester sur tes propres messages : sélectionne-les dans Discord, copie-colle-les dans un fichier `.txt` (même format que `exemples/questions.txt`) et lance `npm run import -- ton-fichier.txt`.

## Lancer le bot sur un serveur de test

1. **Crée un serveur Discord de test** (le « + » à gauche dans Discord).
2. **Crée le bot** sur https://discord.com/developers/applications → *New Application* → onglet **Bot** :
   - *Reset Token* → copie le token dans `DISCORD_TOKEN`
   - active **Message Content Intent**
3. **Invite-le** : onglet *OAuth2 → URL Generator* → coche `bot` et `applications.commands`, puis les permissions *View Channels*, *Send Messages*, *Read Message History*, *Embed Links*. Ouvre l'URL générée et choisis ton serveur de test.
4. **Récupère les IDs des salons** : Discord → Paramètres → Avancés → *Mode développeur*, puis clic droit sur un salon → *Copier l'identifiant*. Remplis `WATCHED_CHANNEL_IDS`, `QUESTION_CHANNEL_IDS`, `DIGEST_CHANNEL_ID` dans `.env`.
5. `npm run bot`

Ensuite, poste des messages comme dans un vrai groupe (ou colle des messages réels), lance `/analyser`, valide avec `/a-valider`, puis pose une question dans #questions.

## Développement

```bash
npm test          # tests
npm run typecheck # vérification des types
```

Structure : `src/bot.ts` (Discord), `src/ai.ts` (appels Claude), `src/knowledge.ts` (logique des fiches et réponses), `src/db.ts` (SQLite), `src/text.ts` (détection de questions, lecture des exports), `src/cli/` (outils en ligne de commande).
