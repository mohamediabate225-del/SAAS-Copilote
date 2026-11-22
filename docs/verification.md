# Vérification locale — 22 novembre 2026

Cette version reste locale. Aucun site, service cloud, produit Stripe réel ou
extension Chrome Web Store n’a été publié.

## Résultats observés

- Suite `node --test` : **26 tests réussis, aucun échec et aucun test ignoré**, avec
  `COPILOTE_PLAYWRIGHT` pointant vers l’installation indépendante de Playwright.
- Parcours API : inscription, connexion, récupération du mot de passe à usage
  unique, révocation, import de CV, préparation, entraînement, historique,
  export et isolation entre comptes.
- Navigateurs : WebKit aux largeurs 375 et 768 px ; Microsoft Edge à 1024 et
  1440 px. Connexion vers le dashboard, création de session, import, réponses,
  entraînement, reprise et démo hors connexion. Aucun débordement horizontal
  sur les pages contrôlées. Inspection visuelle du formulaire de session,
  de la connexion mobile et des quatre offres.
- Extension MV3 réellement chargée dans Chromium : association par jeton sans
  cookies du site, attestation avant capture, audio simulé, transcription,
  réponse et refus après révocation du jeton.
- Quotas : essai après vérification, absence de nouvel essai après recréation du
  compte, cinq questions, réservations concurrentes, limite quotidienne commune,
  modifications de plans prises en compte et absence d’appel IA si budget épuisé.
- Décompte : durée audio décodée côté serveur ; fichier invalide et audio de plus
  de 180 secondes rejetés ; reçu vocal privé à usage unique pour éviter le double
  débit lors du débrief immédiat.
- Paiements avec fournisseur simulé : signature du corps brut, refus des
  signatures invalides, événements idempotents, Pass seulement après paiement,
  renouvellement sans report, événement ancien ignoré, Checkout avec prix
  contrôlé et CGV, réessai idempotent et portail lié au compte connecté.
- SMTP local de test : réception effective du message de vérification, secret
  stocké uniquement sous forme hachée en base. La délivrabilité réelle reste à
  vérifier avec le domaine d’envoi.
- Sauvegarde SQLite en ligne restaurée sur une copie temporaire :
  `integrity_check=ok`, aucune violation de clé étrangère, schéma attendu présent.
- Syntaxe de 46 fichiers JavaScript vérifiée ; `npm audit --omit=dev` ne signale
  aucune vulnérabilité connue à cette date. Cela ne constitue pas un audit de
  sécurité exhaustif.
- Serveur local redémarré sur `127.0.0.1:3100` ; `/api/health` confirme la base
  disponible et la configuration IA présente. Les paiements restent désactivés.

Le test de navigation WebKit quittait parfois une page avant la résolution du
contrôle initial de quota. La vérification de mise en page attend désormais le
message d’accès rendu. Les lectures de quota sont dédupliquées et interrompues
au départ de la page. Un contrôle séparé de 20 transitions rapides n’a produit
aucune erreur. Ceci ne remplace pas un essai sur un iPhone physique.

## Mesure de rapidité avec OpenAI réel

Sur une question et un CV synthétiques comparables, depuis ce poste :

| Mesure | Avant | Dernier essai après modification |
|---|---:|---:|
| Premier texte visible dans le flux | 2 966 ms | 1 366 ms |
| Réponse complète | 2 967 ms | 1 631 ms |

Un autre essai après modification a donné 912 ms avant le premier texte et
1 238 ms jusqu’à la réponse complète. Ce sont des observations ponctuelles,
pas une moyenne ni une garantie de délai.

Un extrait vocal synthétique français de 3,989 secondes a été décodé et transcrit
en 997 ms. Ce délai commence à l’envoi du fichier ; il n’inclut pas le temps
de parole. Le découpage de l’écoute utilise au maximum quatre secondes par
extrait et environ 500 ms de silence. Le réseau, la longueur du contexte et le
fournisseur influencent encore le délai.

Le contrôle de question a isolé la demande sur les achats après une anecdote
sur les oranges. La réponse avec CV est diffusée progressivement en un appel
de rédaction, sans attendre une seconde rédaction complète. Les instructions
interdisent d’inventer des faits personnels ; elles ne garantissent pas l’absence
de toute erreur du modèle.

## Vérifications externes encore nécessaires

- Créer le compte Stripe, fournir les clés **de test** dans l’environnement,
  exécuter `npm run stripe:setup`, puis vérifier les vrais Checkout, portail et
  webhooks avec les cartes de test. Aucun produit n’a été créé chez Stripe.
- Choisir le domaine et l’hébergeur ; valider HTTPS, volume persistant,
  restauration distante et accès mobile en 5G. Le Dockerfile n’a pas été construit
  ici : Docker n’est pas disponible sur ce poste.
- Configurer SMTP, SPF, DKIM et DMARC ; vérifier les messages réels de
  vérification, réinitialisation et paiement.
- Compléter et faire valider les gabarits légaux, la TVA, les durées de
  conservation, le processus de rétractation, remboursement et litige.
- Tester Zoom/Teams/Meet avec les permissions audio réelles, puis Safari sur
  iPhone. La capture audio de l’extension est simulée dans la suite locale.
- Configurer une supervision externe et tester ses alertes. Les compteurs
  locaux d’erreurs, délais et audience agrégée sont disponibles ; aucun service
  d’alertes externe n’a été créé.
- Préparer le dossier d’extension pour le domaine choisi, réconcilier son ID avec
  celui du Chrome Web Store et demander l’accord avant soumission.

`npm run preflight` signale actuellement les paramètres de production manquants.
La procédure et les commandes sont dans [launch.md](launch.md). Les cases de
validation de production ne sont pas cochées automatiquement à partir des seuls
essais locaux.
