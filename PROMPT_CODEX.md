# Prompt à coller dans Codex

Colle le bloc ci-dessous tel quel. Il décrit le produit, l'architecture complète et les critères de réussite, pour que Codex comprenne l'état actuel de l'application et puisse la faire évoluer sans régression.

---

Tu es un ingénieur full-stack senior. Voici l'état actuel et la vision du projet « Copilote d'entretien » : une suite complète pour candidats d'entretien d'embauche combinant un copilote en direct, un simulateur d'entraînement interactif avec un coach IA, un espace de préparation avec gestion de CVs PDF, et une extension Chrome intégrée.

## Principe produit
- **Copilote en direct (`/index.html`)** :
  - Un clic (ou touche Espace) écoute la question de l'employeur (micro ou audio d'onglet visio Teams/Meet/Zoom).
  - La question est transcrite et reste directement modifiable par le candidat.
  - Un bouton « Relancer la réponse ↺ » (ou Entrée) régénère la réponse à la volée.
  - La réponse est streamée mot à mot, formulée à la première personne (« je »), registre oral naturel, 60 à 100 mots, sans markdown, ancrée dans les faits réels du candidat (méthode STAR).
- **Mode Entraînement (`/entrainement.html`)** :
  - Simulation face à un recruteur IA qui pose des questions adaptées au poste et à l'offre en 3 ou 5 étapes.
  - Synthèse vocale de la question du recruteur.
  - Le candidat répond au micro (transcription audio) ou par écrit.
  - Débriefing streamé en direct par le coach IA : Appréciation globale, Points forts, Axes d'amélioration et Modèle de réponse idéal.
- **Espace candidat (`/compte.html`)** :
  - Comptes utilisateurs sécurisés en local (SQLite), upload et parsing de CV PDF, ciblage d'offres d'emploi et de postes.
- **Extension Chrome (`/extension`)** :
  - Volet latéral Chrome (Side Panel Manifest V3) synchronisé automatiquement avec le compte local pour assister le candidat discrètement en visio.

## Stack technique
- Node.js 18+ (ES modules), Express, multer (upload mémoire), SDK `openai`, dotenv, `node:sqlite` (`DatabaseSync`), `pdf-parse`, `nodemailer`.
- Front natif pur (HTML5, CSS3, JS vanilla) sans framework ni étape de build.
- Clé OpenAI côté serveur uniquement.

## Architecture des fichiers
- `server.js` :
  - `POST /api/transcribe` : audio webm/mp4/ogg → texte via modèle Whisper (`TRANSCRIBE_MODEL`).
  - `POST /api/answer` : question + contexte + historique → réponse streamée (`ANSWER_MODEL`).
  - `POST /api/training/question` : génère la question du recruteur selon l'étape et le profil.
  - `POST /api/training/feedback` : génère le retour constructif du coach streamé.
  - `GET /api/health` : vérification de disponibilité pour l'extension Chrome.
  - Middleware CORS pour l'extension Chrome avec `Access-Control-Allow-Credentials: true`.
  - Protection optionnelle par `APP_PASSWORD` via l'en-tête `x-app-password`.
- `prompts.js` :
  - `buildSystemPrompt({ role, company, profile, offer, language })`
  - `buildTrainingRecruiterPrompt({ role, company, profile, offer, questionIndex, totalQuestions, language })`
  - `buildTrainingFeedbackPrompt({ role, company, profile, offer, question, answer, language })`
- `accounts.js` :
  - Base SQLite locale (`copilote-local.sqlite`).
  - Tables : `users` (hachage scrypt, sel 16 octets), `sessions` (tokens sha256, cookies HttpOnly), `resumes` (extraction PDF via `pdf-parse`), `preparations`, `password_resets`.
- `public/` :
  - `index.html` : copilote live avec question modifiable, relance rapide et gestion `APP_PASSWORD`.
  - `entrainement.html` : simulateur d'entretien avec coach IA.
  - `compte.html` & `compte.js` : espace candidat, gestion des CVs et préparation.
  - `landing.html` : page d'accueil avec présentation, démo et FAQ.
  - `tarifs.html` : grille tarifaire indicative.
  - `extension-guide.html` : guide d'installation de l'extension Chrome en mode développeur.
  - `mot-de-passe.html` & `mot-de-passe.js` : réinitialisation de mot de passe par token email.
- `extension/` :
  - `manifest.json`, `background.js`, `panel.html`, `panel.css`, `panel.js` (synchronisation automatique `/api/account/preparation`, capture audio onglet visio, transcription et réponse streamée).

## Ensuite, ajoute dans cet ordre :
1. Paiement et abonnements (Stripe) avec gestion de quotas d'utilisation en base SQLite.
2. Détection d'activité vocale automatique (VAD) pour éliminer le besoin de cliquer pendant l'entretien.
3. Raccourci clavier global dans Chrome pour activer l'écoute sans quitter l'onglet visio.
4. Historique persistant des sessions d'entraînement avec suivi des progrès.

---

## Conseils de prompting pour les réponses
- Ne jamais inventer d'expérience ou de chiffre non présent dans le CV.
- Réponses directes à l'oral, sans préambule ni méta-commentaire.
- Règle d'or : concis, percutant, vrai.
