/**
 * Chaînes d'interface françaises partagées (web, API : messages d'erreur,
 * notifications). Toute chaîne visible par l'utilisateur doit vivre ici ou
 * dans la taxonomie (libellés des catégories / statuts / badges).
 *
 * Les gabarits utilisent la syntaxe `{nom}` ; voir `t()` pour l'interpolation.
 */
import type { Basemap, FlagReason, NotificationType, ReportCategory } from "./types";
import { formatDistance } from "./geo";
import { formatRelative } from "./time";

export const fr = {
  appName: "Mountain Live",
  tagline: "La montagne en temps réel.",
  report: "Signaler",
  map: "Carte",
  explore: "Explorer",
  community: "Communauté",
  profile: "Profil",

  /** Barre de navigation (section 3). */
  nav: {
    navigate: "Itinéraire",
    map: "Carte",
    explore: "Explorer",
    report: "Signaler",
    community: "Communauté",
    profile: "Profil",
    around: "Autour de moi",
    notifications: "Notifications",
  },

  common: {
    cancel: "Annuler",
    confirm: "Confirmer",
    validate: "Valider",
    publish: "Publier",
    back: "Retour",
    next: "Suivant",
    continue: "Continuer",
    close: "Fermer",
    retry: "Réessayer",
    save: "Enregistrer",
    delete: "Supprimer",
    edit: "Modifier",
    share: "Partager",
    search: "Rechercher",
    loading: "Chargement…",
    seeMore: "Voir plus",
    seeOnMap: "Voir sur la carte",
    understood: "J'ai compris",
    skip: "Passer",
    later: "Plus tard",
    yes: "Oui",
    no: "Non",
    ok: "OK",
    optional: "facultatif",
    required: "obligatoire",
    unknown: "Inconnu",
    none: "Aucun",
    all: "Tous",
    details: "Détails",
    send: "Envoyer",
  },

  /** Onboarding (section 21) : trois écrans, puis pratiques, puis localisation. */
  onboarding: {
    slide1: "La montagne en temps réel.",
    slide2: "Découvrez les dangers, activités et conditions autour de vous.",
    slide3: "Signalez ce que vous rencontrez et aidez les autres usagers.",
    practicesTitle: "Quelles sont vos pratiques ?",
    practicesHint: "Sélectionnez une ou plusieurs pratiques : la carte et les filtres s'adaptent à vos besoins.",
    locationTitle: "Autoriser la localisation",
    locationBody:
      "Votre position sert uniquement à centrer la carte, à trier les signalements par distance et à vous alerter à proximité. Elle n'est jamais publiée : seule une estimation anonyme de la fréquentation est partagée.",
    locationAllow: "Autoriser la localisation",
    locationLater: "Plus tard",
    start: "Commencer",
    skip: "Passer l'introduction",
  },

  auth: {
    loginTitle: "Connexion",
    registerTitle: "Créer un compte",
    email: "Adresse e-mail",
    password: "Mot de passe",
    passwordHint: "8 caractères minimum",
    pseudo: "Pseudo",
    pseudoHint: "Visible par les autres utilisateurs, jamais votre e-mail.",
    region: "Région (facultatif)",
    consent: "J'accepte la politique de confidentialité et les règles de sécurité.",
    login: "Se connecter",
    register: "Créer mon compte",
    logout: "Se déconnecter",
    noAccount: "Pas encore de compte ?",
    hasAccount: "Déjà un compte ?",
    continueAsGuest: "Consulter sans compte",
    guestHint: "Un compte est nécessaire pour signaler ou confirmer.",
    errors: {
      invalidCredentials: "E-mail ou mot de passe incorrect.",
      emailTaken: "Un compte existe déjà avec cet e-mail.",
      emailInvalid: "Adresse e-mail invalide.",
      passwordTooShort: "Le mot de passe doit contenir au moins 8 caractères.",
      pseudoInvalid: "Le pseudo doit contenir entre 2 et 32 caractères (lettres, chiffres, espaces, - _ .).",
      pseudoTaken: "Ce pseudo est déjà utilisé.",
      consentRequired: "Vous devez accepter la politique de confidentialité.",
      suspended: "Votre compte est temporairement suspendu.",
      sessionExpired: "Votre session a expiré, reconnectez-vous.",
    },
  },

  /** Assistant de signalement (sections 4 et 32). */
  wizard: {
    title: "Que souhaitez-vous signaler ?",
    subtitle: "Choisissez une catégorie",
    chooseSubtype: "Précisez le signalement",
    position: "Position du signalement",
    positionAuto: "Position GPS actuelle",
    positionAdjust: "Ajuster sur la carte",
    positionHint: "Déplacez la carte pour placer le point exactement.",
    positionAccuracy: "Précision : {distance}",
    photo: "Ajouter une photo",
    photoOptional: "Photo (facultative)",
    photoTake: "Prendre une photo",
    photoChoose: "Choisir dans la galerie",
    photoRemove: "Retirer la photo",
    description: "Commentaire",
    descriptionOptional: "Commentaire (facultatif)",
    descriptionPlaceholder: "Précisez ce que vous avez vu…",
    dangerLevel: "Niveau de danger",
    duration: "Durée estimée de validité",
    endTime: "Heure de fin",
    endTimeHint: "Le signalement disparaîtra automatiquement à cette heure.",
    summary: "Vérifiez avant de publier",
    publish: "Publier",
    publishing: "Publication…",
    published: "Signalement publié. Merci !",
    publishedOffline: "Signalement enregistré : il sera envoyé dès le retour du réseau.",
    needLocation: "Position introuvable : activez la localisation ou placez le point sur la carte.",
    sensitiveNotice: "Les observations d'espèces sensibles sont affichées avec une position approximative.",
    loginRequired: "Connectez-vous pour publier un signalement.",
  },

  /** Fiche d'un signalement (section 14). */
  sheet: {
    reportedAgo: "Signalé {ago}",
    reportedBy: "par {pseudo}",
    confirmedBy: "Confirmé par {n} utilisateurs",
    confirmedByOne: "Confirmé par 1 utilisateur",
    lastConfirmation: "Dernière confirmation {ago}",
    noConfirmation: "Pas encore confirmé",
    distance: "À {distance}",
    validUntil: "Valable {until}",
    expiresIn: "Expire {in}",
    expired: "Expiré",
    resolved: "Résolu",
    source: "Source",
    level: "Niveau",
    photo: "Photo",
    photos: "Photos",
    description: "Description",
    place: "Lieu",
    date: "Date",
    confidence: "Confiance",
    blurred: "Position approximative (espèce sensible)",
    comments: "Commentaires",
    noComments: "Aucun commentaire pour l'instant.",
    commentPlaceholder: "Ajouter un commentaire…",
    linkCopied: "Lien copié",
    shareTitle: "{label} — Mountain Live",
    actions: {
      confirm: "Confirmer",
      gone: "Plus présent",
      addPhoto: "Ajouter une photo",
      comment: "Commenter",
      share: "Partager",
      flag: "Signaler un problème",
      resolve: "Déclarer résolu",
      update: "Mettre à jour",
      directions: "Itinéraire",
    },
  },

  /** Confirmation communautaire (section 6). */
  confirmations: {
    question: "Cette information est-elle toujours exacte ?",
    stillPresent: "Toujours présent",
    improved: "Situation améliorée",
    gone: "Plus présent",
    dispute: "Contester",
    disputeHint: "Signalement faux ou trompeur",
    thanks: "Merci, votre retour a été pris en compte.",
    changed: "Votre avis a été mis à jour.",
    ownReport: "Vous ne pouvez pas confirmer votre propre signalement.",
    loginRequired: "Connectez-vous pour confirmer un signalement.",
    offlineQueued: "Votre confirmation sera envoyée au retour du réseau.",
  },

  /** Filtres de la carte (section 11). Les clés de catégorie suivent `ReportCategory`. */
  filters: {
    title: "Filtres",
    all: "Tout afficher",
    danger: "Dangers",
    hunting: "Chasse",
    animals: "Animaux",
    path: "Chemins",
    water: "Eau",
    activity: "Activités",
    crowd: "Fréquentation",
    official: "Informations officielles",
    reset: "Réinitialiser",
    apply: "Terminer",
    byPractice: "Selon ma pratique",
    savePreset: "Enregistrer mes filtres",
    presetSaved: "Filtres enregistrés",
  },

  /** Mode hors connexion (section 9). */
  offline: {
    mode: "Mode hors connexion",
    synced: "Synchronisation effectuée",
    syncing: "Synchronisation…",
    backOnline: "Connexion rétablie",
    download: "Télécharger cette zone",
    downloading: "Téléchargement en cours…",
    downloaded: "Zone disponible hors connexion",
    zonesTitle: "Zones hors connexion",
    noZones: "Aucune zone téléchargée.",
    zoneHint: "Cadrez la zone souhaitée sur la carte puis téléchargez-la : carte, sentiers, points d'eau, refuges et signalements récents.",
    areaTooLarge: "Zone trop grande : rapprochez-vous pour la télécharger.",
    deleteZone: "Supprimer cette zone",
    updateZone: "Mettre à jour",
    updatedAgo: "Mise à jour {ago}",
    pending: "{n} actions en attente d'envoi",
    pendingOne: "1 action en attente d'envoi",
    staleData: "Données affichées {ago} : elles peuvent être obsolètes.",
  },

  /** Notifications (sections 12 et 23). */
  notifications: {
    title: "Notifications",
    empty: "Aucune notification.",
    markAllRead: "Tout marquer comme lu",
    preferences: "Préférences de notification",
    preferencesHint: "Choisissez précisément ce qui mérite une alerte : pas de notification inutile.",
    types: {
      new_danger_on_route: "Nouveau danger sur un itinéraire enregistré",
      new_battue_nearby: "Nouvelle battue à proximité",
      trail_closed: "Fermeture de sentier",
      report_updated: "Signalement mis à jour",
      report_confirmed: "Signalement confirmé",
      report_resolved: "Signalement résolu",
      official_alert: "Alerte officielle",
      system: "Informations sur l'application",
    } satisfies Record<NotificationType, string>,
    proximity: {
      title: "Alertes de proximité",
      enabled: "Activer les alertes",
      radius: "Rayon d'alerte",
      categories: "Catégories surveillées",
      /** Formulations sans accord de genre : « Attention : Battue à 600 m sur votre itinéraire. » */
      onRoute: "Attention : {label} à {distance} sur votre itinéraire.",
      nearby: "{label} à {distance}.",
      ahead: "{label} dans {distance}.",
    },
  },

  /** Profil, préférences et paramètres (section 15). */
  profilePage: {
    title: "Profil",
    reports: "Signalements",
    confirmations: "Confirmations",
    reliability: "Fiabilité",
    level: "Niveau {level}",
    levelHint: "Votre niveau progresse avec les signalements confirmés par la communauté.",
    badges: "Badges",
    noBadges: "Aucun badge pour l'instant : publiez votre premier signalement !",
    practices: "Pratiques",
    region: "Région",
    memberSince: "Membre depuis {date}",
    edit: "Modifier le profil",
    preferences: "Préférences",
    settings: "Paramètres",
    theme: "Thème",
    themeLight: "Clair",
    themeDark: "Sombre",
    themeSystem: "Automatique",
    basemap: "Fond de carte",
    basemaps: {
      topo: "Topographique",
      satellite: "Satellite",
      classic: "Classique",
      relief: "Relief",
      ortho: "Ortho IGN",
    } satisfies Record<Basemap, string>,
    aroundRadius: "Rayon « Autour de moi »",
    privacy: "Politique de confidentialité",
    exportData: "Exporter mes données",
    deleteAccount: "Supprimer mon compte",
    deleteAccountConfirm:
      "Cette action supprime définitivement votre compte et vos données personnelles. Vos signalements sont anonymisés.",
    deleted: "Votre compte a été supprimé.",
    saved: "Modifications enregistrées",
    myReports: "Mes signalements",
    noReports: "Vous n'avez publié aucun signalement.",
  },

  /** Modération (section 17). */
  moderation: {
    flagTitle: "Signaler un contenu",
    reasonLabel: "Motif",
    detailsLabel: "Précisions (facultatif)",
    submit: "Envoyer le signalement",
    sent: "Merci, notre équipe va examiner ce contenu.",
    reasons: {
      false_info: "Fausse information",
      dangerous_content: "Contenu dangereux",
      inappropriate_photo: "Photo inappropriée",
      harassment: "Harcèlement",
      obsolete: "Information obsolète",
      spam: "Spam",
    } satisfies Record<FlagReason, string>,
    admin: {
      title: "Modération",
      stats: "Statistiques",
      reports: "Signalements",
      flags: "Litiges",
      openFlags: "Litiges ouverts",
      users: "Utilisateurs",
      alerts: "Alertes officielles",
      delete: "Supprimer",
      confirmDelete: "Supprimer ce signalement ? Cette action est irréversible.",
      changeCategory: "Modifier la catégorie",
      changeStatus: "Modifier le statut",
      suspend: "Suspendre le compte",
      unsuspend: "Lever la suspension",
      suspendDuration: "Durée de la suspension",
      resolveFlag: "Clore le litige",
      rejectFlag: "Rejeter",
      review: "Examiner",
      resolutionNote: "Note de résolution",
      actionNone: "Aucune action",
      actionDelete: "Supprimer le contenu",
      actionSuspend: "Suspendre l'auteur",
      publishAlert: "Publier une alerte officielle",
    },
  },

  /** Erreurs API et appareil, formulées pour l'utilisateur. */
  errors: {
    generic: "Une erreur est survenue. Veuillez réessayer.",
    network: "Impossible de joindre le serveur. Vérifiez votre connexion.",
    offline: "Action indisponible hors connexion.",
    unauthorized: "Connectez-vous pour continuer.",
    forbidden: "Vous n'avez pas les droits nécessaires.",
    notFound: "Élément introuvable.",
    validation: "Certains champs sont invalides.",
    conflict: "Cette action a déjà été effectuée.",
    rateLimited: "Trop de requêtes : patientez un instant.",
    server: "Le service est momentanément indisponible.",
    timeout: "La requête a pris trop de temps.",
    photoTooLarge: "Photo trop lourde (10 Mo maximum).",
    photoInvalid: "Format de photo non pris en charge.",
    locationDenied: "Localisation refusée. Vous pouvez placer le point manuellement sur la carte.",
    locationUnavailable: "Position indisponible pour le moment.",
    mapLoad: "La carte n'a pas pu être chargée.",
  },

  /** Règles de sécurité (section 27), affichées à l'onboarding et dans les paramètres. */
  safetyNotice: {
    title: "Règles de sécurité",
    intro: "Mountain Live est une aide à la décision, pas une garantie.",
    rules: [
      "Les informations communautaires peuvent être incomplètes ou inexactes.",
      "L'absence de signalement ne signifie pas l'absence de danger.",
      "L'application ne remplace pas les consignes officielles.",
      "Respectez les réglementations locales.",
      "Vos décisions restent sous votre responsabilité.",
    ],
    priority: "Les alertes officielles ont toujours priorité.",
    accept: "J'ai compris",
  },

  /** Carte principale (sections 3 et 10). */
  mapUi: {
    search: "Rechercher un lieu-dit, une commune, un col…",
    centerOnMe: "Me localiser",
    filters: "Filtres",
    basemap: "Fond de carte",
    legend: "Légende",
    noReports: "Aucun signalement dans cette zone.",
    zoomIn: "Zoomez pour voir les détails",
    cluster: "{n} signalements",
    officialAlert: "Alerte officielle",
    presence: "Environ {n} utilisateurs actifs dans cette zone",
    presenceLow: "Fréquentation faible dans cette zone",
    crowdLow: "Fréquentation faible",
    crowdMedium: "Fréquentation modérée",
    crowdHigh: "Forte fréquentation",
    locating: "Recherche de votre position…",
    addHere: "Signaler ici",
  },

  /** Page « Autour de moi » (section 24). */
  around: {
    title: "Autour de moi",
    empty: "Rien à signaler autour de vous pour l'instant.",
    radius: "Rayon",
    item: "À {distance} : {title}",
    needLocation: "Activez la localisation pour voir ce qui se passe autour de vous.",
    sortedByDistance: "Triés par distance",
  },

  /** Page Explorer (section 22). */
  explorePage: {
    title: "Explorer",
    searchPlaceholder: "Lieu-dit, commune, sommet, col, sentier…",
    recent: "Signalements récents",
    water: "Points d'eau",
    activities: "Activités en cours",
    restrictions: "Restrictions",
    trails: "Sentiers",
    crowd: "Fréquentation",
    noResults: "Aucun résultat.",
    elevation: "Altitude : {elevation} m",
    officialAlerts: "Alertes officielles",
  },

  /** Page Communauté. */
  communityPage: {
    title: "Communauté",
    activity: "Activité récente",
    topContributors: "Contributeurs les plus fiables",
    partners: "Partenaires vérifiés",
    empty: "Pas d'activité récente.",
  },

  /** Itinéraires (section 13, post-MVP : chaînes prêtes). */
  routes: {
    reportsOnRoute: "{n} signalements présents sur votre itinéraire",
    reportOnRouteOne: "1 signalement présent sur votre itinéraire",
    noReportOnRoute: "Aucun signalement sur votre itinéraire",
  },

  /** Navigation temps réel sur les sentiers (sections 5 à 13, 19 à 22 du module navigation). */
  navigation: {
    title: "Navigation",
    subtitle: "Suivi GPS sur les sentiers",
    homeTitle: "Démarrer un itinéraire",
    homeSubtitle: "Choisissez un sentier, importez une trace ou partez librement : la carte vous suit sur le chemin.",
    searchRoutes: "Rechercher un itinéraire (GR 20, Mare a Mare, lac…)",
    results: "Résultats",
    selectedRoute: "Itinéraire choisi",
    settings: "Réglages",
    demoNetwork: "Sentiers de démonstration : les vrais sentiers et itinéraires OpenStreetMap s'importent automatiquement au lancement connecté (ou via « Importer les sentiers (OpenStreetMap).command »).",
    start: "Démarrer",
    startFree: "Explorer librement",
    startRoute: "Suivre cet itinéraire",
    chooseRoute: "Choisir un itinéraire",
    nearbyRoutes: "Itinéraires à proximité",
    noNearbyRoutes: "Aucun itinéraire connu à proximité : explorez librement ou importez une trace GPX.",
    importGpx: "Importer un fichier GPX",
    gpxImported: "Trace importée : {name}",
    gpxInvalid: "Ce fichier ne contient pas de trace exploitable.",
    exportGpx: "Exporter en GPX",
    saveTrack: "Enregistrer la trace",
    myTracks: "Mes traces",
    noTracks: "Aucune trace enregistrée pour l'instant.",
    activity: "Activité",
    activities: { hiking: "Randonnée", trail: "Trail", mtb: "VTT", equestrian: "Équitation", other: "Autre" },
    trackingMode: "Précision du suivi",
    trackingModes: { eco: "Économie de batterie", normal: "Normal", precise: "Précision élevée" },
    trackingHints: {
      eco: "Position toutes les 15 s environ : autonomie maximale.",
      normal: "Position toutes les 5 s : le bon compromis pour la randonnée.",
      precise: "Position à chaque relevé GPS : trail, VTT, passages techniques.",
    },
    voice: "Guidage vocal",
    voiceHint: "Les instructions et alertes importantes sont lues à voix haute.",
    simulate: "Simuler ce parcours (démo)",
    simulating: "Simulation en cours",
    pause: "Pause",
    resume: "Reprendre",
    stop: "Terminer",
    stopConfirm: "Terminer l'activité ?",
    stopBody: "Votre trace sera résumée et pourra être enregistrée ou exportée.",
    recenter: "Recentrer",
    report: "Signaler",
    backtrack: "Revenir sur mes pas",
    backtrackStarted: "Retour par votre trace : suivez la ligne jusqu'au point de départ.",
    returnToStart: "Retour au point de départ",
    offRoute: "Vous semblez avoir quitté l'itinéraire.",
    offRouteBody: "Vous êtes à {distance} du parcours.",
    backOnRoute: "Vous êtes sur le bon itinéraire.",
    returnToRoute: "Revenir au parcours",
    continueFree: "Continuer en mode libre",
    bringMeBack: "Me ramener sur le parcours",
    guidanceToRoute: "Rejoignez le parcours : {distance} vers {direction}",
    gpsWeak: "Signal GPS faible",
    gpsWeakBody: "Position estimée à partir de votre trajectoire et des sentiers.",
    gpsLost: "Signal GPS perdu",
    gpsSearching: "Recherche du signal GPS…",
    gpsBack: "Signal GPS retrouvé.",
    gpsWaiting: "Recherche du signal GPS…",
    gpsDenied: "Localisation refusée : la navigation a besoin du GPS.",
    accuracy: "Précision ±{distance}",
    onPath: "Sur : {name}",
    onKind: "Sur un {kind}",
    offPath: "Hors sentier",
    matchedLow: "Chemin incertain",
    stats: {
      remaining: "Restant",
      done: "Parcouru",
      distance: "Distance",
      altitude: "Altitude",
      speed: "Vitesse",
      avgSpeed: "Vitesse moyenne",
      eta: "Arrivée",
      duration: "Durée",
      gain: "Dénivelé +",
      loss: "Dénivelé −",
      gainRemaining: "D+ restant",
      maxAltitude: "Altitude max",
      points: "Points",
    },
    summaryTitle: "Activité terminée",
    kinds: {
      path: "sentier",
      track: "piste",
      footway: "chemin piéton",
      bridleway: "chemin équestre",
      cycleway: "piste cyclable",
      steps: "escalier",
      road: "route",
      via_ferrata: "via ferrata",
      unknown: "chemin",
    },
    instructions: {
      left: "gauche",
      right: "droite",
      turnIn: "Tournez à {dir} dans {distance}",
      turnNow: "Prenez le sentier à {dir}",
      slightIn: "Obliquez à {dir} dans {distance}",
      slightNow: "Obliquez à {dir}",
      sharpIn: "Tournez franchement à {dir} dans {distance}",
      sharpNow: "Tournez franchement à {dir}",
      uturnIn: "Faites demi-tour dans {distance}",
      uturnNow: "Faites demi-tour",
      bendIn: "Le sentier tourne à {dir} dans {distance}",
      bendNow: "Le sentier tourne à {dir}",
      straightJunctionIn: "Continuez tout droit à l'intersection dans {distance}",
      straightJunctionNow: "Continuez tout droit à l'intersection",
      continueFor: "Continuez sur ce sentier pendant {distance}",
      arriveIn: "Arrivée dans {distance}",
      arrived: "Vous êtes arrivé.",
      freeMode: "Mode libre : votre parcours est enregistré.",
    },
    events: {
      reportFar: "{label} à {distance} devant vous",
      reportIn: "Attention : {label} dans {distance}",
      reportNow: "{label} à proximité immédiate",
      infoIn: "{label} dans {distance}",
      slope: "Forte pente",
      ford: "Traversée de rivière",
      closed: "Chemin fermé",
      officialIn: "Alerte officielle : {label} dans {distance}",
      onRoute: "{label} sur votre itinéraire",
      approximate: "position approximative",
    },
    setup: {
      title: "Préparer l'activité",
      modeFree: "Mode libre",
      modeFreeHint: "Sans itinéraire : la carte suit votre position, identifie le chemin emprunté et enregistre votre trace.",
      modeRoute: "Itinéraire",
      modeRouteHint: "Guidage pas à pas, distance restante, événements devant vous.",
      needLocation: "Activez la localisation pour démarrer.",
      offlineHint: "Le GPS fonctionne sans réseau : téléchargez la zone avant de partir pour garder la carte et les sentiers.",
    },
  },

  /**
   * Moteur cartographique collectif : fréquentation, temps observés,
   * itinéraires, contribution et vie privée.
   */
  network: {
    title: "Le réseau vivant",
    subtitle: "Ce que les passages nous apprennent des chemins",

    /** Contribution et consentement (section 35). */
    contribute: {
      title: "Contribuer à l'amélioration des chemins",
      short: "Contribuer anonymement",
      hint: "Vos traces servent à corriger les tracés, mesurer les temps réels et découvrir des chemins absents des cartes. Elles sont anonymisées : aucune position personnelle n'est publiée.",
      ask: "Contribuer anonymement avec cette activité à améliorer les informations du réseau ?",
      accept: "Contribuer",
      decline: "Garder pour moi",
      contributed: "Activité partagée anonymement. Merci.",
      kept: "Activité conservée pour vous seul.",
      withdraw: "Retirer ma contribution",
      withdrawn: "Contribution retirée : cette activité ne compte plus dans les statistiques.",
      always: "Toujours contribuer, sans me redemander",
      privacyNote: "Les départs et arrivées sont écartés avant toute utilisation collective, et une statistique n'est publiée qu'à partir de plusieurs utilisateurs distincts.",
    },

    /** Mes activités (sections 35 et 49). */
    activities: {
      title: "Mes activités",
      empty: "Aucune activité enregistrée pour l'instant.",
      emptyHint: "Démarrez un itinéraire : distance, durée, dénivelé et trace seront enregistrés sur cet appareil.",
      delete: "Supprimer cette activité",
      deleteConfirm: "Supprimer définitivement cette activité ?",
      deleteBody: "La trace et les passages correspondants seront effacés, y compris des statistiques collectives.",
      deleteAll: "Supprimer tout mon historique",
      deleted: "Activité supprimée.",
      status: { private: "Privée", contributed: "Partagée anonymement", withdrawn: "Contribution retirée" },
      processed: "Rattachée au réseau",
      pending: "En attente de traitement",
      segments: "{n} segments parcourus",
    },

    /** Fiche d'un chemin (section 33). */
    segment: {
      title: "Chemin",
      length: "Longueur",
      elevation: "Dénivelé",
      difficulty: "Difficulté",
      surface: "Surface",
      state: "État",
      lastPassage: "Dernier passage",
      passages: "Fréquentation",
      times: "Temps observés",
      noTimes: "Pas encore de temps observé sur ce chemin.",
      reports: "Signalements",
      routes: "Voir les itinéraires utilisant ce chemin",
      openStatus: { open: "Praticable", closed: "Fermé" },
      basedOn: "Basé sur {n} passages",
      basedOnOne: "Basé sur 1 passage",
      slowZone: "Ralentissement observé",
      turnaround: "Demi-tours fréquents",
      confusion: "Intersection où l'on se trompe souvent",
    },

    /** Fréquentation (sections 11, 12, 43). */
    frequentation: {
      title: "Fréquentation",
      levels: {
        unknown: "Données insuffisantes",
        very_low: "Très faible",
        low: "Faible",
        moderate: "Modérée",
        high: "Élevée",
        very_high: "Très élevée",
      },
      insufficient: "Données communautaires insuffisantes",
      insufficientHint: "Peu de passages enregistrés ici : cela ne veut pas dire que le chemin n'existe pas ou qu'il est mauvais.",
      periods: { today: "Aujourd'hui", week: "7 jours", month: "30 jours", year: "Cette année", all: "Tout" },
      passages: "{n} passages",
      passagesOne: "1 passage",
      recent: "{n} passages ces 30 derniers jours",
      season: "Fréquentation habituelle élevée à cette période.",
      declining: "Fréquentation en forte baisse.",
      legend: "Plus le trait est vif, plus le chemin est emprunté.",
    },

    /** Itinéraires proposés (sections 22, 23). */
    routes: {
      title: "Itinéraires",
      from: "Départ",
      to: "Arrivée",
      useMyPosition: "Ma position",
      search: "Chercher un itinéraire",
      searching: "Recherche d'itinéraires…",
      none: "Aucun itinéraire trouvé entre ces deux points sur le réseau connu.",
      noneHint: "Essayez des points plus proches d'un chemin, ou élargissez la zone téléchargée.",
      criteria: {
        fastest: "Le plus rapide",
        shortest: "Le plus court",
        most_used: "Le plus emprunté",
        easiest: "Le plus facile",
        quietest: "Le moins fréquenté",
        recommended: "Recommandé",
      },
      observed: "Temps observé",
      theoretical: "Temps estimé",
      choose: "Suivre cet itinéraire",
    },

    /** Confiance des estimations (section 26). */
    confidence: {
      label: "Confiance",
      levels: { very_low: "Très faible", low: "Faible", medium: "Moyenne", high: "Élevée", very_high: "Très élevée" },
      theoretical: "Estimation théorique, sans passage observé.",
      blended: "Estimation affinée par les passages observés.",
      observed: "Estimation fondée sur les passages observés.",
      personal: "Temps estimé pour vous",
      community: "Temps moyen observé",
    },

    /** Zones privées (section 36). */
    privacy: {
      title: "Zones privées",
      hint: "Les traces situées dans ces zones ne servent jamais aux statistiques collectives. Le départ et l'arrivée de chaque activité sont de toute façon écartés.",
      add: "Ajouter une zone",
      suggestion: "Un départ revient souvent ici : en faire une zone privée ?",
      remove: "Retirer cette zone",
      radius: "Rayon",
      label: "Nom (facultatif)",
      empty: "Aucune zone privée déclarée.",
    },

    /** Candidatures issues de l'apprentissage (sections 19, 46). */
    candidates: {
      title: "Propositions du terrain",
      kinds: {
        new_trail: "Chemin potentiel",
        geometry: "Tracé à corriger",
        variant: "Variante empruntée",
        slow_zone: "Zone de ralentissement",
        turnaround: "Demi-tours fréquents",
        confusion: "Intersection confuse",
        inactive: "Chemin peut-être abandonné",
      },
      status: { open: "À examiner", accepted: "Acceptée", rejected: "Rejetée", merged: "Fusionnée" },
      observations: "{observations} passages · {users} utilisateurs distincts",
      accept: "Valider",
      reject: "Rejeter",
      note: "Note de décision",
      empty: "Aucune proposition en attente.",
      hint: "Rien n'est appliqué automatiquement : chaque proposition attend une décision humaine.",
    },
  },

  /** Écrans de démarrage. */
  splash: {
    loading: "Chargement de la carte…",
  },
};

export type Translations = typeof fr;

type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? Join<P, K>
    : T[K] extends readonly unknown[]
      ? never
      : T[K] extends object
        ? Leaves<T[K], Join<P, K>>
        : never;
}[keyof T & string];

/** Clés « a.b.c » pointant vers une chaîne de `fr`. */
export type TranslationKey = Leaves<Translations>;

export type TranslationVars = Record<string, string | number>;

/** Remplace les `{nom}` d'un gabarit par les valeurs fournies. */
export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Accès typé à une chaîne : `t("offline.mode")`, `t("sheet.distance", { distance: "320 m" })`.
 * Une clé inconnue renvoie la clé elle-même (jamais d'exception à l'affichage).
 */
export function t(key: TranslationKey, vars?: TranslationVars): string {
  let node: unknown = fr;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? interpolate(node, vars) : key;
}

/** Libellé de filtre pour une catégorie (section 11). */
export function filterLabel(category: ReportCategory | "all" | "official" | "hunting"): string {
  return fr.filters[category];
}

/** Phrases dynamiques fréquentes, prêtes à afficher. */
export const phrases = {
  /** « Confirmé par 8 utilisateurs » / « Confirmé par 1 utilisateur » / « Pas encore confirmé ». */
  confirmedBy(n: number): string {
    if (n <= 0) return fr.sheet.noConfirmation;
    return n === 1 ? fr.sheet.confirmedByOne : interpolate(fr.sheet.confirmedBy, { n });
  },
  /** « Signalé il y a 35 min ». */
  reportedAgo(date: string | Date, now: Date = new Date()): string {
    return interpolate(fr.sheet.reportedAgo, { ago: formatRelative(date, now) });
  },
  /** « Dernière confirmation il y a 12 min ». */
  lastConfirmation(date: string | Date, now: Date = new Date()): string {
    return interpolate(fr.sheet.lastConfirmation, { ago: formatRelative(date, now) });
  },
  /** « À 650 m : Troupeau ». */
  aroundItem(distanceM: number, title: string): string {
    return interpolate(fr.around.item, { distance: formatDistance(distanceM), title });
  },
  /** « Environ 12 utilisateurs actifs dans cette zone ». */
  activeUsers(n: number): string {
    return n < 2 ? fr.mapUi.presenceLow : interpolate(fr.mapUi.presence, { n });
  },
  /** « Attention : Battue à 600 m sur votre itinéraire. » / « Arbre tombé à 300 m. » */
  proximityAlert(label: string, distanceM: number, mode: "nearby" | "onRoute" | "ahead" = "nearby"): string {
    return interpolate(fr.notifications.proximity[mode], { label, distance: formatDistance(distanceM) });
  },
  /** « 3 signalements présents sur votre itinéraire ». */
  reportsOnRoute(n: number): string {
    if (n <= 0) return fr.routes.noReportOnRoute;
    return n === 1 ? fr.routes.reportOnRouteOne : interpolate(fr.routes.reportsOnRoute, { n });
  },
  /** « 3 actions en attente d'envoi ». */
  pendingSync(n: number): string {
    return n === 1 ? fr.offline.pendingOne : interpolate(fr.offline.pending, { n });
  },
  /** « 12 signalements » (clusters). */
  cluster(n: number): string {
    return interpolate(fr.mapUi.cluster, { n });
  },
};
