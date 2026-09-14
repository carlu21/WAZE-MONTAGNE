# Cahier des charges — Projet Mountain Live (nom temporaire)

> « Waze indique ce qui se passe sur la route. Cette application indique ce qui se passe en montagne. »

Application mobile et web collaborative de montagne, inspirée dans son fonctionnement général de Waze, mais dédiée aux espaces naturels, aux sentiers, aux activités de pleine nature et à la cohabitation des différents usagers de la montagne. Le cœur du produit est une carte dynamique et collaborative permettant de savoir ce qui se passe réellement autour de soi, quasiment en temps réel : dangers, activités en cours, animaux, obstacles, points d'eau, sentiers, conditions de circulation.

Utilisateurs visés : randonneurs, trailers, cavaliers, vététistes, chasseurs, pêcheurs, bergers, éleveurs, professionnels du tourisme, guides, propriétaires ou gestionnaires d'espaces naturels, communes, collectivités, associations, fédérations, gestionnaires de sentiers, services publics compétents.

Objectif : un MVP très solide, clair et fonctionnel, avec une architecture permettant d'ajouter progressivement des fonctionnalités. Territoire pilote envisagé : la Corse (randonnée, élevage, pastoralisme, chasse, pêche, équitation, VTT, tourisme, forêt, risques naturels).

## 1. Objectif produit
Ouvrir l'application et comprendre immédiatement la situation autour de soi grâce à une carte interactive affichant : chasse ou battue en cours, troupeau, chiens de protection, animaux sauvages dangereux, arbre tombé, éboulement, chemin effondré, crue, passage impraticable, neige/névé, verglas, travaux forestiers, piste fermée, incendie ou risque incendie, restriction d'accès, source, fontaine, refuge, abri, point d'eau, zone sans réseau, sentier encombré, forte fréquentation, passage de cavaliers, passage de VTT, événement sportif, problème de balisage, problème de signalétique. Icônes, couleurs et catégories faciles à identifier ; clic sur un signalement → fiche détaillée.

## 2. Philosophie
Simplicité, information en temps réel, collaboration communautaire, confiance dans la donnée. Pas de menus complexes. Actions principales : consulter la carte ; voir ce qui se passe autour de soi ; signaler ; confirmer / infirmer ; consulter le détail ; consulter éventuellement un itinéraire ; télécharger une zone hors connexion.

## 3. Écran d'accueil principal
La carte. En haut : recherche (montagne, commune, col, sentier, lieu), filtre, centrage sur la position. En bas : barre de navigation 4–5 entrées (Carte, Explorer, Signaler, Communauté, Profil) avec bouton central flottant « + » très visible. Signalement en moins de 20 secondes.

## 4. Système de signalement
Bouton « + Signaler » → « Que souhaitez-vous signaler ? » avec grandes icônes.
- Danger : éboulement, arbre tombé, chemin effondré, passage dangereux, crue, neige, verglas, incendie, autre danger.
- Chemin / accessibilité : chemin fermé, chemin impraticable, travaux, sentier encombré, problème de balisage, mauvais état du chemin, obstacle.
- Chasse / activités : chasse en cours, battue, zone temporairement occupée, travaux forestiers, événement sportif, activité pastorale.
- Animaux : troupeau, chiens de protection, bovins, chevaux, animaux sauvages, sangliers, animal blessé, animal agressif, autre observation animale.
- Eau / ressources : source, fontaine, point d'eau, source sèche, source active, refuge, abri.
- Fréquentation / usagers : forte présence de randonneurs, cavaliers, VTT, véhicules, zone très fréquentée, zone peu fréquentée.
Après sélection : position GPS automatique (ajustable sur la carte), photo facultative, commentaire facultatif, niveau de danger (faible, modéré, important, critique), durée estimée de validité. Puis publication.

## 5. Durée de vie
Durée adaptée par type : animal sauvage 1–3 h ; troupeau quelques heures ; chasse jusqu'à l'heure de fin ; forte fréquentation 1–2 h ; arbre tombé plusieurs jours jusqu'à résolution ; éboulement jours/semaines ; source sèche quelques jours ; source active récurrente reconfirmée ; travaux période renseignée ; fermeture officielle dates début/fin. Expiration automatique ; récent = icône normale, ancien = icône transparente, trop ancien = archivé.

## 6. Confirmation communautaire
Confirmer, contester, déclarer résolu, mettre à jour. Affichage : « Signalé il y a 35 minutes », « Confirmé par 8 utilisateurs », « Dernière confirmation il y a 12 minutes ». Trois boutons : Toujours présent / Situation améliorée / Plus présent. Score de confiance : Faible confiance, Probable, Confirmé, Très fiable — fonction du nombre et de la récence des confirmations, de la réputation, des contradictions, du caractère officiel.

## 7. Types de données
Officielle (communes, préfectures, services publics, gestionnaires, fédérations, partenaires, open data) → badge « Source officielle ». Partenaire (guides, professionnels, bergers, associations, gestionnaires de sentiers, sociétés de chasse, clubs) → « Partenaire vérifié ». Communautaire → « Signalement communautaire ».

## 8. Protection des utilisateurs
Jamais de position GPS individuelle publique. Estimation agrégée (« Environ 12 utilisateurs actifs dans cette zone ») ou heatmap. Chasseurs : zones de chasse/battue plutôt que positions individuelles. Espèces sensibles : localisation floutée automatiquement. Aucune fonction de localisation des agents de contrôle (gardes, OFB, agents publics).

## 9. Mode hors connexion
Sélection d'une zone puis « Télécharger cette zone » : carte, sentiers, points d'eau, refuges, topographie, signalements récents, points utiles. Synchronisation automatique au retour du réseau. Bannières « Mode hors connexion » puis « Synchronisation effectuée ».

## 10. Cartographie
Fonds : topographique, satellite, classique, relief. Courbes de niveau, chemins, sentiers, routes forestières, rivières, sommets, cols, refuges, points d'eau, zones réglementées. Zoom intelligent (peu d'infos à faible zoom, détails à zoom élevé). Clustering automatique.

## 11. Filtres
Tout afficher, Dangers, Chasse, Animaux, Chemins, Eau, Activités, Fréquentation, Informations officielles. Préférences enregistrables selon la pratique (cavalier : chiens de protection, chasse, routes, sentiers praticables à cheval, eau, obstacles, passages difficiles ; randonneur : eau, danger, chasse, fermetures, refuges ; etc.).

## 12. Alertes de proximité
« Attention : battue signalée à 600 m sur votre itinéraire. » « Arbre tombé signalé à 300 m. » « Troupeau et chiens de protection signalés dans 400 m. » Alertes personnalisables.

## 13. Itinéraires (post-MVP, architecture prête)
Départ, destination, dénivelé, distance, temps, profil altimétrique, difficulté, type de pratique (randonnée, trail, VTT, équitation). « 3 signalements présents sur votre itinéraire ».

## 14. Fiche d'un signalement
Titre, icône, distance, lieu, date, heure, photo, description, niveau, nombre de confirmations, dernière confirmation, source. Boutons : Confirmer, Plus présent, Ajouter une photo, Commenter, Partager.

## 15. Profil utilisateur
Photo, pseudo, type de pratiquant, région, nombre de signalements, nombre de confirmations, score de fiabilité. Pratiques : randonneur, trailer, cavalier, VTT, chasseur, pêcheur, berger, professionnel, gestionnaire, autre. Badges : Éclaireur, Contributeur, Expert local, Sentinelle, Partenaire vérifié. Pas de réseau social classique.

## 16. Réputation
Niveau 1 pour un nouvel utilisateur, montée avec les signalements confirmés, baisse avec les faux/abusifs. Jamais de score humiliant public ; usage interne pour la fiabilité.

## 17. Modération
Signaler : fausse information, contenu dangereux, photo inappropriée, harcèlement, information obsolète, spam. Back-office : supprimer, modifier une catégorie, suspendre un compte, examiner les litiges, statistiques.

## 18. Tableau de bord professionnel (future offre B2B)
Nombre de signalements, zones à incidents, sentiers à problèmes récurrents, points d'eau régulièrement secs, fréquentation estimée, zones de conflits d'usage, résolus, délais moyens, historique, carte thermique.

## 19. Charte graphique
Premium, naturelle, moderne, très lisible ; montagne, topographie, cartes, nature, aventure, sécurité. Palette : vert forêt, vert profond, beige naturel, blanc cassé, gris roche, orange sécurité, rouge danger (rouge uniquement pour les alertes importantes). Sobre, boutons arrondis modérément, icônes minimalistes, police très lisible, carte prioritaire.

## 20. Mobile-first
Gants, soleil, pluie, mouvement, peu de réseau, batterie limitée : gros boutons, contraste élevé, compréhension en quelques secondes, mode sombre.

## 21. Onboarding
« La montagne en temps réel. » / « Découvrez les dangers, activités et conditions autour de vous. » / « Signalez ce que vous rencontrez et aidez les autres usagers. » Puis choix des pratiques (Randonnée, Trail, Équitation, VTT, Chasse, Pêche, Autre) puis autorisation de localisation expliquée.

## 22. Page Explorer
Recherche par commune, massif, sentier, sommet, lieu. Affiche carte, signalements récents, fréquentation, points d'eau, activités, restrictions.

## 23. Notifications
Nouveau danger sur itinéraire enregistré, nouvelle battue à proximité, fermeture de sentier, mise à jour, confirmé, résolu. Page de préférences précise ; pas de notifications inutiles.

## 24. Page « Autour de moi »
Cartes verticales triées par distance : « À 300 m : Source », « À 650 m : Troupeau signalé il y a 20 min », « À 1,2 km : Battue jusqu'à 13 h », « À 2 km : Arbre tombé ».

## 25. Base de données
users, reports, report_categories, report_confirmations, report_comments, photos, official_alerts, partners, trails, water_points, areas, offline_zones, notifications, user_preferences, user_reputation, moderation_reports. Signalement : id, user_id, type, sous_type, latitude, longitude, niveau_de_danger, date_creation, date_expiration, statut, nombre_confirmations, source, photo, description, zone, last_confirmation_at, confidence_score.

## 26. Statuts
actif, confirmé, probablement résolu, résolu, expiré, contesté, supprimé.

## 27. Règles de sécurité
Informations communautaires possiblement incomplètes ; absence de signalement ≠ absence de danger ; ne remplace pas les consignes officielles ; respecter les réglementations locales ; décisions sous la responsabilité de l'utilisateur. Alertes officielles prioritaires.

## 28. Protection des données
RGPD, consentements, suppression de compte et des données, durée limitée de stockage des positions, anonymisation de la fréquentation, sécurisation des coordonnées, politique de confidentialité claire. Pas d'historique précis des déplacements.

## 29. MVP (dans l'ordre)
1. inscription / connexion ; 2. onboarding ; 3. carte ; 4. géolocalisation ; 5. signalements ; 6. catégories ; 7. photos ; 8. confirmation communautaire ; 9. expiration automatique ; 10. filtres ; 11. alertes simples ; 12. profil ; 13. hors connexion basique ; 14. back-office de modération.
Pas dans le MVP : réseau social, messagerie privée, marketplace, réservations, fonctions commerciales complexes.

## 30. Écrans
Splash, Onboarding, Création de compte, Connexion, Choix des activités, Autorisation GPS, Carte principale, Filtres, Création d'un signalement, Choix de catégorie, Ajout photo, Validation, Fiche signalement, Autour de moi, Recherche d'un lieu, Explorer, Téléchargement hors connexion, Notifications, Profil, Préférences, Paramètres, Signalement de contenu, Back-office administrateur, Dashboard professionnel futur.

## 31. Priorité UX
Minimiser les clics ; action principale immédiatement identifiable ; peu de texte ; icônes ; une main ; forte luminosité extérieure.

## 32. Parcours de signalement idéal
Arbre bloquant le chemin → « + » → Obstacle → Arbre tombé → position auto → photo → « Passage difficile » → Publier. < 20 s.

## 33. Parcours de consultation idéal
Ouverture → géolocalisation → carte centrée → deux dangers, une battue, un point d'eau, un troupeau visibles → compréhension en < 5 s.

## 34. Différenciation
« La couche d'information temps réel de la montagne. » Répondre à « Que se passe-t-il là-bas maintenant ? » plutôt qu'à « Où puis-je aller ? ».

## 35. Vision long terme
Plateforme nationale puis internationale : information terrain, signalements citoyens, données officielles, gestion des risques, cohabitation des usages, fréquentation, sécurité, gestion des espaces naturels ; outils de pilotage pour collectivités et gestionnaires.

## 36. Nom
Temporaire : « Projet Mountain Live » / « Projet Terra Live ». Identité non dépendante du mot « randonnée ».

## 37. Consigne de conception
Architecture complète ; écrans principaux ; navigation simple ; composants UI réutilisables ; base de données ; système de signalement ; logique de confiance ; évolutions futures sans surcharger le MVP ; interface optimisée pour l'extérieur ; expérience extrêmement intuitive. Produit crédible, professionnel, proche d'une application commercialisable. Chaque bouton, donnée, icône et écran doit avoir une véritable fonction.
