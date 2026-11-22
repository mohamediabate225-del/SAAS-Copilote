# Tarifs, concurrence et coûts de COPILOTE.IA

Recherche effectuée le 22 novembre 2026 avec Firecrawl. Pages officielles lues en
direct, puis options mensuelles vérifiées quand la page affichait l’annuel par
défaut. Les calculs ci-dessous sont des scénarios, pas des factures prévisionnelles
garanties ni les coûts internes des concurrents.

## Décision recommandée

Conserver **9 € / 14 € / 29 € TTC pendant la bêta**. Les volumes sont bornés ; les
prix très élevés des concurrents ne prouvent pas un coût API élevé. Mesurer les
coûts par client actif et la qualité avant d’augmenter. Après la bêta, tester
**12 € le Pass, 19 €/mois Essentiel et 39 €/mois Pro**, avec les mêmes volumes,
auprès des nouveaux clients. C’est une hypothèse commerciale à valider, pas une
hausse appliquée à la base ou à Stripe.

Ne pas promettre de l’illimité à ce stade. Avant commercialisation, les volumes
annoncés doivent être réellement utilisables dans des conditions normales. Les
plafonds techniques actuels peuvent arrêter l’IA avant le crédit de minutes.

## Comparaison vérifiée

| Service | Paiement mensuel sans engagement annuel | Autre formule | Périmètre et réserves |
|---|---|---|---|
| [ParakeetAI](https://www.parakeet-ai.com/#pricing) | 149,90 $/mois sur la page US | 78 $/semaine ; 49,99 $/mois affichés, **599,90 $ facturés par an** | Appels et simulations annoncés illimités. Téléchargements CV PDF et portraits illimités exclus de cette offre. Crédit ponctuel : 38 $ pour une heure, sans expiration, selon le volet Credits. |
| [Verve AI](https://www.vervecopilot.com/pricing) | Standard **39,99 €/mois**, Pro **72,99 €/mois** | Annuel affiché par défaut : 14,99 €/mois et 29,99 €/mois | En mensuel, Standard : cinq sessions de 60 min et simulations annoncées illimitées. Pro : sessions de 90 min annoncées illimitées. La TVA n’était pas précisée dans la section consultée. |
| [Final Round AI](https://www.finalroundai.com/subscription) | **150 $/mois** | 83,33 $/mois avec facturation trimestrielle ; 25 $/mois avec facturation annuelle | Copilote annoncé illimité, préparation, rapports et banque de questions. Prix annuels affichés comme équivalents mensuels : ne pas les comparer à un paiement mensuel sans engagement. |
| COPILOTE.IA | Essentiel **14 €/mois TTC**, Pro **29 €/mois TTC** | Pass Sprint **9 € TTC**, paiement unique | 150 / 400 / 90 minutes ; audio plafonné à 30 min/jour. Budget IA et jetons bornés. Essai 15 min et 5 questions, valable 7 jours après vérification de l’e-mail. |

La capture fournie affiche Parakeet à **129,90 €/mois**, 67,60 €/semaine et
43,33 €/mois pour l’annuel. Le relevé en direct accessible a affiché des dollars,
sans sélecteur EUR trouvé. Aucun taux de conversion n’est appliqué ici ; les
montants de la capture et ceux du relevé ne sont pas confondus. L’ouverture de
la racine avec une localisation française redirigeait vers le créateur de CV :
ce produit n’a pas été utilisé pour chiffrer l’assistant d’entretien.

La page annuelle de Verve affiche 60 sessions Standard, alors que la vue mensuelle
et sa comparaison indiquent cinq sessions. La sélection de la bonne période est
donc essentielle. Les contenus comparatifs des fournisseurs et les extraits de
recherche étaient parfois contradictoires ; les tarifs ci-dessus viennent des
pages d’offres, pas de leurs articles promotionnels.

## Pourquoi certains concurrents sont beaucoup plus chers

Les pages établissent des différences de volumes, de fonctionnalités, de modèles,
d’applications de bureau et de périodes d’engagement. Elles ne publient pas leur
coût par utilisateur ou leur marge. On ne peut donc pas attribuer leur prix à
OpenAI sans preuve.

Hypothèses commerciales plausibles : forte valeur perçue d’une embauche, demande
urgente mais temporaire, coût d’acquisition et support, financement de clients
intensifs dans une offre illimitée. Le fort écart mensuel/annuel encourage aussi
l’engagement et les encaissements anticipés. Ce sont des interprétations du
positionnement, pas des faits vérifiés sur leur comptabilité ou leurs résultats.

## Ce que coûte réellement le moteur actuel

Le code utilise GPT-4o Transcribe pour l’audio, GPT-4.1 par défaut pour les réponses,
GPT-4.1 mini pour l’extraction de question et certaines recherches. Le CV, l’offre
et l’historique limité constituent des tokens d’entrée à chaque appel. Le mode
recherche ajoute un routage et un appel web ; la génération de portraits est
encore un poste distinct. Une heure écoulée n’est pas nécessairement une heure
d’audio transcrit : les silences ne sont pas systématiquement envoyés.

Tarifs standard relevés dans la [grille OpenAI complète](https://developers.openai.com/api/docs/pricing.md) :

| Poste | Prix de référence USD |
|---|---|
| GPT-4o Transcribe | Environ 0,006 $ par minute |
| GPT-4.1, texte | 2 $/million de tokens d’entrée ; 8 $/million de sortie |
| GPT-4.1 mini, texte | 0,40 $/million d’entrée ; 1,60 $/million de sortie |
| Recherche web non-preview | 0,01 $ par appel, plus les tokens ; bloc de 8 000 tokens de recherche pour GPT-4.1 mini |

La transcription seule représente donc **0,54 $ pour 90 min**, **0,90 $ pour
150 min** et **2,40 $ pour 400 min**. Ce n’est pas le coût total de l’outil.
Les fiches de [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)
et de [GPT-4o Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-transcribe)
marquent ces modèles comme dépréciés. Planifier une migration évaluée avant
lancement ; aucun changement de modèle n’a été fait lors de cette refonte.

### Deux scénarios par heure d’audio transcrit

Les réponses sont calculées sans économie de cache. La recherche est provisionnée
en plus des réponses, même lorsqu’elle les remplace dans le code : estimation
prudente. Les appels d’extraction comprennent les tentatives préparées durant
l’écoute ; ils ne sont pas limités à un appel par réponse.

| Hypothèse | Usage modéré | Usage intensif |
|---|---:|---:|
| Réponses GPT-4.1 | 30 × (6 000 tokens en entrée, 350 en sortie) | 60 × (20 000 en entrée, 500 en sortie) |
| Extractions GPT-4.1 mini | 60 × (2 000 en entrée, 100 en sortie) | 180 × (6 000 en entrée, 150 en sortie) |
| Routages GPT-4.1 | 30 × (500 en entrée, 80 en sortie) | 60 × (500 en entrée, 80 en sortie) |
| Recherches web GPT-4.1 mini | 3 × (8 000 + 500 en entrée, 500 en sortie) | 12 × les mêmes volumes |
| Transcription | 60 min | 60 min |
| Total avant réserve | 0,9534 $ | 3,7440 $ |
| Total avec réserve de 20 % | **1,14408 $/h** | **4,4928 $/h** |

Formule : audio × 0,006 + somme des appels (entrée × tarif entrée + sortie × tarif
sortie) / 1 000 000 + frais des recherches. Puis multiplier par 1,20.

| Crédit consommé entièrement | API modérée | API intensive théorique |
|---|---:|---:|
| Sprint : 90 min | 1,72 $ | 6,74 $ |
| Essentiel : 150 min | 2,86 $ | 11,23 $ |
| Pro : 400 min | 7,63 $ | 29,95 $ |

Ces scénarios n’incluent pas portraits, création répétée de CV, stockage,
hébergement, e-mails, support, acquisition, litiges, impôts ou rémunération.
Ils supposent tout le crédit dépensé en audio ; les réponses écrites en
entraînement consomment aussi ce crédit. Les plafonds de jetons/coût existants
interrompraient une partie des scénarios intensifs **avant** ces totaux.

Les 19 appels réussis présents dans la base locale au moment du contrôle ne
constituent pas une population représentative de clients. Aucune moyenne de
marge commerciale n’est déduite de ces quelques essais.

## Recette disponible : ne pas confondre TTC et marge

Les [tarifs Stripe France](https://stripe.com/fr/pricing) consultés indiquent
1,5 % + 0,25 € pour une carte standard EEE et 0,7 % supplémentaire sur le volume
Billing. D’autres cartes, Stripe Tax, les litiges ou d’autres services peuvent
coûter davantage.

Scénario de gestion uniquement : TVA supposée de 20 %, carte standard EEE,
Billing sur les abonnements. Le régime TVA réel reste à confirmer. Pour
provisionner l’API, **1 dollar de coût est budgété comme 1 euro** ; ce n’est pas un
taux de change observé. Hors éventuelles taxes fournisseur et frais de change.

| Offre | TTC | Après TVA supposée et frais Stripe | Reste après API modérée provisionnée |
|---|---:|---:|---:|
| Pass Sprint | 9 € | 7,12 € | **5,40 €** |
| Essentiel | 14 € | 11,11 € | **8,25 €** |
| Pro | 29 € | 23,28 € | **15,65 €** |

Ce reste finance tous les autres coûts ; **ce n’est pas le bénéfice**. Dans le
scénario intensif sans garde-fous, il serait proche de zéro ou négatif aux prix
actuels. Une utilisation courte laisse davantage de marge, mais on ne doit pas
construire le prix uniquement sur les minutes que les clients n’utiliseront pas.

## Garde-fous et points à améliorer

- Les budgets configurés sont de 3 $ / 5 $ / 10 $ estimés et 300 000 / 600 000 /
  1 500 000 tokens pour Sprint / Essentiel / Pro. Ils sont contrôlés avant les
  appels. Ce sont des plafonds internes estimés, pas une garantie sur une facture
  fournisseur en cas de modèle ou de tarif mal configuré.
- Les longues pièces jointes sont renvoyées dans le contexte ; réduire aux
  passages utiles est plus rentable que relever les prix sans mesure.
- Mesurer médiane et 95e percentile du coût par client payant, par heure et par
  action. Distinguer audio, réponse, extraction, recherche et portrait.
- Ne pas promettre de portraits ou recherches illimités. Avant lancement, prévoir
  un quota explicite de générations et un décompte lisible par l’utilisateur.
- Vérifier que les quotas techniques laissent consommer le volume annoncé dans
  les scénarios normaux ; sinon optimiser, relever le budget, ou redéfinir le
  volume annoncé avant toute vente. La nouvelle FAQ précise déjà ces limites.
- Le plafond actuel de **30 min/jour** coupe une simulation de 45 à 60 minutes.
  Pour une offre de préparation, il convient à des séquences courtes. Pour vendre
  une aide sur un appel complet, il faudra tester un plafond de session/jour plus
  adapté, en conservant les limites mensuelles et de coût. Ce paramètre n’a pas
  été modifié sans décision sur l’offre.
- À coûts connus, viser à titre de pilotage une dépense API au 95e percentile
  inférieure à 25–30 % du revenu hors taxes, puis intégrer le coût d’acquisition
  et du support. Ce seuil est un objectif proposé, pas une norme de marché.

## Refonte livrée

Offres sélectionnables au clavier et au toucher, prix TTC et période explicites,
récapitulatif et aperçu synchronisés, lien direct `?offre=pro`, conditions proches
du bouton, état de paiement indisponible, récupération après erreur de chargement,
FAQ sur les minutes et les plafonds. Les valeurs viennent de l’API et de `plans`.
Le choix par défaut est Essentiel, sans allégation non démontrée de popularité.
Les styles réutilisent `public/ui.css` et ses polices, avec une feuille limitée
à la page tarifs. Aucun nouveau tarif, abonnement annuel ou achat n’a été activé.

Vérification : 27 tests réussis, dont sélection au clavier, changement de prix
et de minutes dans une API simulée, lien direct vers une offre, retour après
erreur réseau, consentement avant Checkout et paiement simulé. Parcours existants
de connexion, CV, entraînement et extension toujours couverts. Contrôle de
débordement à 320, 375, 768, 812, 1024 et 1440 px, WebKit mobile, orientation
paysage et texte agrandi sur bureau ; captures bureau et mobile inspectées.
Les paiements restent désactivés dans l’application locale. Aucun site publié.
