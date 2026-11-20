# Copilote Entretien

Copilote Entretien est une application de préparation aux entretiens. Elle comprend une démo sans compte, des simulations personnalisées et un copilote audio utilisable dans les situations qui l’autorisent.

## Démarrage local

Installez Node.js 24 ou plus récent, puis lancez `npm ci`. Créez `.env` à partir de `.env.example` et configurez `OPENAI_API_KEY`. La commande `npm start` ouvre le service sur `http://localhost:3100` par défaut. `npm test` vérifie les parcours API avec une base SQLite vierge et un fournisseur IA simulé.

Les tests navigateur peuvent utiliser une installation de Playwright indépendante du projet. Indiquez son dossier parent via `COPILOTE_PLAYWRIGHT`. Ce dossier doit contenir `node_modules/playwright`. Installez le navigateur WebKit de Playwright et Microsoft Edge avant d’exécuter la suite.

## Parcours candidat

- L’essai IA dure 10 minutes à partir de la première action IA. L’espace candidat et les débriefs restent disponibles après expiration.
- L’espace prépare le poste, l’offre et le CV. Les simulations et le copilote réutilisent ces données.
- Une simulation peut être reprise depuis l’historique. Elle accepte les réponses écrites et la dictée.
- Les indicateurs de dictée sont des estimations tirées des mots transcrits et du temps enregistré.
- Le navigateur peut ouvrir la démo hors connexion après une première visite. L’espace candidat et les appels IA requièrent une connexion.
- Le panneau Chrome local s’associe avec un code révoquable valable 7 jours. Le raccourci proposé ouvre le panneau. L’utilisateur choisit ensuite la source audio.
- Les participants doivent être informés de la capture audio. Pour un entretien réel, vérifiez les règles de l’employeur et obtenez l’accord des participants.

## Configuration d’un hébergement

Le Dockerfile exécute Node.js sans privilèges administrateur. Utilisez une instance avec stockage persistant monté sur `/data` et un proxy HTTPS à l’adresse exacte fournie dans `APP_BASE_URL`. Configurez les adresses de proxy de confiance avec `TRUST_PROXY` selon l’hébergement. Gardez ce volume hors des sauvegardes publiques. Les sauvegardes SQLite effectuées pendant le fonctionnement doivent utiliser un mécanisme compatible avec SQLite.

Les secrets sont des variables d’environnement du serveur. Pour le mot de passe oublié, configurez SMTP et l’origine publique HTTPS. Pour la facturation, configurez les clés Stripe, les identifiants de tarifs récurrents et le portail client. Enregistrez `/api/billing/webhook` pour les événements `customer.subscription.created`, `customer.subscription.updated` et `customer.subscription.deleted`. Validez le parcours Stripe en mode test avant tout encaissement.

La prévisualisation privée s’active avec un `PREVIEW_TOKEN` aléatoire d’au moins 32 caractères et une origine HTTPS. Le lien de prévisualisation transmet ce jeton une fois, puis le serveur redirige vers une URL sans jeton et envoie un cookie signé. Réservez cette configuration aux aperçus privés.

`npm run usage` affiche les nombres agrégés de simulations, d’essais et d’abonnements, ainsi que les appels IA, les jetons signalés par l’API et le volume audio. Le rapport ne contient ni le texte des échanges ni d’identifiants.
