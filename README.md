# Copilote d'entretien (MVP)

L'employeur pose une question → tu cliques → l'IA écoute → tu cliques → tu lis la réponse.

## Lancer en 2 minutes

```bash
npm install
cp .env.example .env      # puis colle ta clé OPENAI_API_KEY dans .env
npm start
```

Ouvre http://localhost:3000 dans Chrome ou Edge.

1. Ouvre « Mon profil », colle ton CV / tes réalisations, indique le poste et l'entreprise. C'est sauvegardé dans ton navigateur.
2. Clique sur le bouton rond (ou barre Espace) quand l'employeur commence sa question.
3. Reclique quand il a fini. La question apparaît, puis la réponse arrive en streaming.

## Source du son

- **Micro** : entretien en personne, ou visio avec haut-parleurs (le micro capte la voix de l'employeur).
- **Audio d'un onglet / de l'écran** : visio dans le navigateur (Meet, Teams web, Zoom web). Dans la fenêtre de partage de Chrome, choisis l'onglet de l'appel et coche « Partager l'audio de l'onglet ». Sur Windows, tu peux aussi partager « tout l'écran » avec l'audio du système. Sur macOS, seul l'audio d'onglet est disponible.

Le micro demande HTTPS, sauf sur `localhost`.

## Réglages qui comptent

- **Qualité du profil** : plus il est précis (chiffres, projets, outils), meilleures sont les réponses. L'IA n'invente rien : sans matière, elle reste générale.
- **Vitesse** : `gpt-4o-mini` est rapide. Pour des réponses plus fines, mets `ANSWER_MODEL` sur un modèle plus puissant, au prix d'un peu de latence.
- **Style** : tout se règle dans `prompts.js` (longueur, ton, règles par type de question).

## Mettre en ligne

Render, Railway ou Fly.io conviennent : variables d'environnement `OPENAI_API_KEY` et `APP_PASSWORD`, commande `npm start`. Ne publie jamais sans `APP_PASSWORD`. L'application gère désormais la saisie et l'envoi du mot de passe via l'en-tête `x-app-password`.

## Fonctionnalités incluses

- **Copilote en direct (`/index.html`)** : Écoute en 1 clic (ou touche Espace), transcription, modification possible de la question et streaming de la réponse oralisée.
- **Mode Entraînement (`/entrainement.html`)** : Simulation face à un recruteur IA (voix/texte) avec débriefing et coaching instantané sur vos réponses.
- **Espace candidat (`/compte.html`)** : Import de CV PDF (`pdf-parse`), ciblage d'offres et sauvegarde en base locale SQLite.
- **Extension Chrome (`/extension`)** : Volet latéral (Side Panel) synchronisé avec le compte pour s'entraîner ou s'assister pendant un appel visio (Teams, Meet, Zoom).

## Idées pour la suite

- Intégration Stripe (abonnements et crédits d'utilisation).
- VAD (détection automatique de silence pour ne plus cliquer).
- Bibliothèque de réponses favorites et historique des entraînements.

## Avant ton vrai entretien

Beaucoup d'employeurs interdisent l'aide d'une IA pendant un entretien. Vérifie les règles de celui que tu passes. L'outil est aussi très utile en entraînement : fais des simulations, lis les réponses proposées, puis reformule-les avec tes mots.
