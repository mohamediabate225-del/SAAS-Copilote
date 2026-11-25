# Mise en ligne de COPILOTE.IA

Ce document prépare le déploiement de la branche `feat/espace-candidat`. Aucun service n'est créé automatiquement et aucune clé secrète ne doit être commitée.

## Pourquoi le téléphone ne se connecte pas en local

`http://localhost:3100` désigne le téléphone lui-même quand le lien est ouvert sur Safari. Le serveur local écoute aussi sur `127.0.0.1`, qui n'est pas accessible depuis la 5G. Pour un accès téléphone, il faut une URL HTTPS publique fournie par l'hébergeur.

## Déploiement recommandé

Le fichier `render.yaml` est déjà préparé pour Render, avec une région Frankfurt, un volume persistant `/data`, un contrôle `/api/health` et `HOST=0.0.0.0`. Dans Render :

1. Créer un service Web depuis le dépôt GitHub, branche `feat/espace-candidat`, en utilisant le Blueprint `render.yaml`.
2. Renseigner l'URL HTTPS finale dans `APP_BASE_URL`, puis la même URL dans les callbacks OAuth si ces connexions sont activées.
3. Renseigner les secrets uniquement dans les variables d'environnement du service : `OPENAI_API_KEY`, `TRIAL_IDENTITY_SECRET` (32 caractères aléatoires minimum) et les identifiants SMTP.
4. Conserver `BILLING_ENABLED=false` et `STRIPE_LIVE_ENABLED=false` jusqu'à la validation du parcours de paiement en mode test.
5. Garder `INVITATION_REQUIRED=true` pour la bêta privée. Le passer à `false` seulement lorsque l'inscription publique est voulue.
6. Vérifier que le volume `/data` est persistant et que `COPILOTE_DB_PATH=/data/copilote.sqlite` est conservé après redéploiement.

## Contrôle avant ouverture commerciale

Depuis l'URL HTTPS finale, vérifier sur ordinateur puis Safari en 5G :

- `/api/health` répond `status: ok` et `database: ok` ;
- inscription, vérification d'e-mail et connexion redirigent vers le tableau de bord ;
- un rechargement Safari conserve la session ;
- le tableau de bord, un CV, une session et l'entraînement restent accessibles ;
- une déconnexion invalide immédiatement la session ;
- le mot de passe oublié envoie bien un lien depuis le domaine final ;
- l'audio demande le consentement et la langue choisie avant la capture ;
- les routes IA refusent une requête sans session ;
- une sauvegarde et sa restauration sont testées avant d'accepter des clients.

Commandes locales :

```text
npm test
npm run preflight
```

`npm run preflight` doit rester bloqué tant que les valeurs de production et les validations `LEGAL_REVIEWED`, `DNS_MAIL_VERIFIED` et `BACKUP_RESTORE_VERIFIED` ne sont pas réellement confirmées.

## Publication

La publication du service demande une autorisation explicite de l'éditeur. Le code peut être préparé et poussé sur GitHub avant cette autorisation ; aucun déploiement ou domaine public n'est activé par ce document.
