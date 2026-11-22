# Préparation du lancement de COPILOTE.IA

Cette procédure ne publie rien. Demander l'accord du propriétaire avant chaque
publication du site, activation de paiement réel ou soumission de l'extension.

## État et décisions manquantes

- Éditeur déclaré : COPILOTE.IA, SAS, France, 2 rue de l'Arsenal, 92500 Rueil-Malmaison.
- Contact : mdiabate04@icloud.com.
- Domaine et hébergeur : à choisir. Le fichier render.yaml prépare une option
  Docker à Francfort avec un disque persistant, sans déploiement automatique.
- Compte Stripe et clés test : non fournis. Les produits n'ont pas été créés à distance.
- SMTP et domaine d'envoi : à configurer. Ne pas utiliser un expéditeur dont on
  ne contrôle pas le domaine. L'adresse de contact iCloud ne fournit pas à elle
  seule une configuration d'envoi transactionnel.
- SIREN/RCS, capital, TVA, directeur de publication, médiateur, hébergeur,
  durées de conservation et garanties de transfert : compléter les gabarits
  légaux, puis obtenir leur validation juridique. Aucune conformité RGPD globale
  n'est présumée par les contrôles techniques.

## Offres et décompte

La table `plans` contient les prix TTC en centimes, minutes, durée, maximum de
questions live, plafond audio quotidien et plafonds techniques de jetons/coût.
Les valeurs sont relues à chaque réservation : modifier la base suffit pour les
quotas. Les prix Stripe immuables doivent être synchronisés si le prix change.

| Offre | Prix TTC | Crédit | Validité |
|---|---:|---:|---|
| Gratuit | 0 € | 15 min, 5 questions live | 7 jours après vérification d'e-mail |
| Pass Sprint | 9 € une fois | 90 min | 14 jours après paiement |
| Essentiel | 14 €/mois | 150 min | Période mensuelle payée |
| Pro | 29 €/mois | 400 min | Période mensuelle payée |

Pas de report. Une minute audio est mesurée par décodage en mémoire avec FFmpeg,
pas par un champ fourni par le client. Un envoi est limité à 180 secondes et 8 Mo.
Le plafond de 30 minutes audio/jour suit le jour civil Europe/Paris. L'analyse
d'une réponse écrite consomme 60 secondes de crédit. Un reçu vocal serveur, lié
au compte et à usage unique, évite de payer à nouveau le débrief d'un texte dicté.
Sans reçu (par exemple après une reprise d'un ancien brouillon), l'analyse est
considérée comme écrite ; l'interface doit présenter ce décompte.

Les réservations SQLite sont atomiques et précèdent chaque appel fournisseur,
y compris l'identification d'une question, les recherches et les portraits.
Les appels simultanés consomment le crédit réservé. En cas d'issue réseau inconnue,
la réservation reste comptée pour éviter de dépasser le budget. Un opérateur peut
la rapprocher de la facturation du fournisseur avant correction ; ne pas la
supprimer aveuglément. Les coûts USD sont estimés, pas des factures garanties :
maintenir AI_COST_RATES_JSON, AUDIO_USD_PER_MINUTE et IMAGE_USD_PER_REQUEST à jour,
et configurer aussi des alertes/budgets dans le compte OpenAI.

En local, BILLING_ENABLED=false conserve un plan technique bêta gratuit de
400 minutes/mois, avec les plafonds de sécurité. Ce mode n'est jamais utilisé
en NODE_ENV=production. La production exige une adresse vérifiée et un droit
d'usage valide, même si Stripe est désactivé.

## Test Stripe, avant tout paiement réel

1. Créer un compte Stripe, rester en mode test. Inscrire sk_test_… dans
   STRIPE_SECRET_KEY de .env, jamais dans Git ou dans le navigateur.
2. Exécuter `npm run stripe:setup`. Le script refuse les clés live, crée les
   produits/prix TTC inclusifs, conserve les anciens prix dans stripe_prices et
   configure un portail qui résilie en fin de période. Aucun forfait annuel.
3. Lancer `stripe listen --forward-to localhost:3100/api/billing/webhook`.
   Copier le secret whsec_… dans STRIPE_WEBHOOK_SECRET, redémarrer le serveur.
4. Configurer BILLING_ENABLED=true et APP_BASE_URL=http://localhost:3100.
   Vérifier l'e-mail du compte de test via un SMTP de test ; ne pas fournir
   de route de contournement publique.
5. Tester Checkout Pass puis abonnement avec les cartes de test Stripe,
   annulation, paiement refusé, renouvellement, résiliation et répétition
   d'événements. La page de retour ne débloque jamais de crédit seule.
6. Enregistrer en production les événements checkout.session.completed,
   checkout.session.async_payment_succeeded, customer.subscription.created,
   customer.subscription.updated, customer.subscription.deleted,
   invoice.paid et invoice.payment_failed. La signature porte sur le corps brut.
   Les événements ne sont marqués traités qu'après la transaction complète.
7. Configurer la TVA avec l'expert-comptable. Le montant est TTC/inclusive.
   Activer STRIPE_TAX_ENABLED=true uniquement après configuration de Stripe Tax.
   Ne pas supposer une franchise en base ou un taux de TVA.
8. Les remboursements et litiges nécessitent un rapprochement opérateur des
   droits d'accès ; les paiements réels restent désactivés tant que ce processus,
   la rétractation, les factures et les obligations juridiques ne sont pas validés.

Sources : [Checkout](https://docs.stripe.com/payments/checkout),
[webhooks](https://docs.stripe.com/webhooks),
[abonnements](https://docs.stripe.com/billing/subscriptions/webhooks),
[Stripe Tax](https://docs.stripe.com/tax/checkout).

## Hébergement privé puis public

1. Après choix et accord, créer le service Docker à Francfort à partir de
   render.yaml. Le plan avec disque est payant : faire valider son coût.
2. Une seule instance SQLite. Monter /data, définir COPILOTE_DB_PATH, vérifier
   la propriété du volume pour l'utilisateur node. Ne pas utiliser plusieurs
   réplicas partageant la même base. Mettre les secrets dans le gestionnaire
   du prestataire. Aucune base, sauvegarde ou .env dans l'image ni dans Git.
3. Définir APP_BASE_URL avec le domaine HTTPS exact, HOST=0.0.0.0 et PORT=3100.
   TRUST_PROXY doit correspondre au chemin de proxy vérifié chez l'hébergeur ;
   ne pas mettre true sans connaître le nombre et les adresses des relais.
   Les cookies Secure sont activés en production même sans confiance de proxy.
4. Générer TRIAL_IDENTITY_SECRET (au moins 32 caractères), sauvegarder ce secret
   séparément et le garder stable. Il protège les empreintes anti-réessai.
5. Bêta : INVITATION_REQUIRED=true, puis `npm run invite -- 1 14` pour un code
   privé valable 14 jours. Un compte OAuth neuf ne contourne pas l'invitation :
   en bêta, créer le compte invité par e-mail.
6. Pour un aperçu entièrement fermé, PREVIEW_TOKEN reste possible. /api/health
   et le webhook signé restent atteignables pour les contrôles d'infrastructure.
   Une invitation limite l'inscription ; elle ne rend pas la landing privée.
7. Sauvegarde quotidienne privée via `npm run backup`. Copier les sauvegardes
   chiffrées hors du volume, définir rotation et suppression, restaurer sur une
   base de test et vérifier les comptes, fichiers et droits avant ouverture.
8. Configurer une sonde HTTPS sur /api/health. Les compteurs agrégés d'erreurs,
   latence et limites sont dans operational_metrics. /api/operations requiert
   x-monitoring-key égal à MONITORING_KEY. Aucun CV, audio ou texte de question.
   Relier une sonde/alerte externe à ce point selon le service retenu.
9. ANALYTICS_ENABLED=false par défaut. L'option activée compte uniquement les
   pages autorisées, sans cookie, identifiant, paramètres d'URL ni empreinte.
   Documenter et valider sa base légale avant activation.
10. `npm run preflight`, suite complète de tests, puis test HTTPS réel sur Safari
    en 5G : inscription, réception d'e-mail, connexion persistante, import,
    reprise, quotas et déconnexion. Le mode audio d'un onglet sur ordinateur
    ne doit pas être présenté comme disponible sur Safari mobile.

Sources : [Render Blueprint](https://render.com/docs/blueprint-spec),
[disques](https://render.com/docs/disks), [régions](https://render.com/docs/regions).
La configuration préparée n'est pas une infrastructure créée ou validée à distance.

## Courrier et DNS

Choisir le fournisseur transactionnel et une adresse sur un domaine contrôlé.
Copier ses enregistrements SPF et DKIM dans le DNS ; ne pas inventer les valeurs
ou publier plusieurs enregistrements SPF. Ajouter DMARC selon la politique
validée, puis contrôler les en-têtes d'un message reçu : SPF, DKIM et alignement
DMARC. Tester la vérification d'adresse, la réinitialisation et les e-mails
de paiement. Les derniers sont mis en file, avec nouvelles tentatives bornées.
En l'absence de SMTP, le site indique clairement que l'envoi est indisponible.

## Extension Chrome

Configurer APP_BASE_URL puis `npm run extension:prepare` pour un dossier
release/extension avec le seul domaine de production dans host_permissions.
Zipper ce dossier (ne jamais inclure .env ou les données du serveur).
Le dossier contient la description, la politique de confidentialité et les
justifications des permissions. Ajouter les captures et les éléments visuels
requis par le tableau de bord du Store. Charger d'abord un brouillon non publié,
récupérer sa clé publique et son ID officiel, puis aligner manifest.key et
EXTENSION_ID. L'identifiant local ne garantit pas l'identifiant attribué par le Store.
Tester le jeton révoquable avec cette version ; demander l'accord avant la
première publication non répertoriée, puis avant une publication publique.

[Identifiant stable Chrome](https://developer.chrome.com/docs/extensions/reference/manifest/key).

## Maintien et Postgres

Garder les scripts de backup, tests et contrôles d'accès avant chaque mise à jour.
Réconcilier les crédits avec Stripe, surveiller les coûts réels du fournisseur
et les réservations uncertain. Prévoir Postgres lorsque plusieurs instances
sont nécessaires : conversion des requêtes, migrations transactionnelles,
vérification des clés étrangères, comparaison des totaux et test de retour
arrière sur copie. Ne pas remplacer le stockage de production sans répétition.
