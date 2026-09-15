import { describe, expect, it } from "vitest";
import {
  NEARBY_MIN_RESULTS,
  type NearbyResponse,
  type NearbySort,
  type NearbyTrail,
  type TrailGeometryResponse,
} from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";

/**
 * « Randonnées autour de vous » : l'écran d'accueil (sections 34 et 35).
 *
 * Le fil conducteur des tests est celui de la fonctionnalité elle-même : on ne
 * cherche pas une randonnée, elle vient à vous. Deux règles sont vérifiées
 * partout où elles peuvent être trahies :
 *
 *  1. **Deux distances, jamais confondues** (section 19) : `approachM` mène au
 *     départ, `lengthM` mesure la marche. Un itinéraire de 96 km dont le départ
 *     est sous vos pieds doit précéder, en tri « au plus près », une randonnée
 *     de 5,6 km dont le départ est à 13 km — et l'inverse en tri « la plus
 *     courte ».
 *  2. **Le silence n'est pas une absence** (section 21) : sous le seuil
 *     d'anonymat, la fréquentation vaut `null`, jamais « très calme », et les
 *     passages valent `null`, jamais 0.
 */
const { app, sqlite, seedReference } = await setup();
seedReference();

/** Bergeries de Grotelle : le départ du classique de la Restonica est ce point même. */
const GROTELLE = { lat: 42.2261, lng: 9.0453 };
/** Gare de Vizzavona : extrémité commune du GR20 nord, du GR20 sud et de la Cascade des Anglais. */
const VIZZAVONA = { lat: 42.1275, lng: 9.1339 };
/** Col de Bavella : un seul itinéraire à moins de 10 km, la recherche devra s'élargir. */
const BAVELLA = { lat: 41.7953, lng: 9.2233 };
/** Pleine mer, à l'ouest de la Corse : rien à moins de 50 km. */
const HAUTE_MER = { lat: 41.5, lng: 7.5 };

async function nearby(query: string): Promise<NearbyResponse> {
  const res = await call<NearbyResponse>(app, "GET", `/trails/nearby?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Liste des identifiants, dans l'ordre servi : c'est l'ordre qui est testé. */
function ids(trails: readonly NearbyTrail[]): string[] {
  return trails.map((t) => t.id);
}

function find(body: NearbyResponse, id: string): NearbyTrail {
  const trail = body.trails.find((t) => t.id === id);
  // `toBeDefined` donne le message d'échec lisible ; le `throw` qui suit dit au
  // compilateur ce que l'assertion vient d'établir, sans `!` non-null.
  expect(trail, `itinéraire ${id} absent de la liste`).toBeDefined();
  if (trail === undefined) throw new Error(`itinéraire ${id} absent`);
  return trail;
}

function at(p: { lat: number; lng: number }, extra = ""): string {
  return `lat=${p.lat}&lng=${p.lng}${extra}`;
}

describe("Randonnées autour de vous", () => {
  it("propose les itinéraires du secteur, départ le plus proche en tête", async () => {
    const body = await nearby(at(GROTELLE));

    expect(body.sort).toBe("closest");
    expect(body.trails.length).toBeGreaterThanOrEqual(NEARBY_MIN_RESULTS);
    // Le classique de la Restonica part des bergeries de Grotelle : on y est.
    expect(body.trails[0].id).toBe("t_restonica_melo");
    expect(body.trails[0].approachM).toBe(0);
    expect(body.trails[0].trailhead.end).toBe("start");
    expect(body.trails[0].trailhead.point).toEqual(GROTELLE);

    // L'approche est croissante d'un bout à l'autre de la liste.
    const approaches = body.trails.map((t) => t.approachM);
    expect([...approaches].sort((a, b) => a - b)).toEqual(approaches);
    // Et aucun départ n'est au-delà du rayon annoncé.
    for (const trail of body.trails) expect(trail.approachM).toBeLessThanOrEqual(body.radiusM);

    expect(typeof body.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
  });

  it("ne confond jamais l'approche et la longueur de la randonnée", async () => {
    // Depuis la gare de Vizzavona : le GR20 nord (96 km de marche) commence
    // ici même, la Restonica (5,6 km de marche) commence à 13 km de route.
    const proche = await nearby(at(VIZZAVONA));
    const gr20 = find(proche, "t_gr20_nord");
    const restonica = find(proche, "t_restonica_melo");

    expect(gr20.approachM).toBe(0);
    expect(gr20.lengthM).toBe(96_000);
    expect(restonica.approachM).toBeGreaterThan(10_000);
    expect(restonica.lengthM).toBe(5_600);

    // Tri « au plus près » : c'est l'APPROCHE qui décide. Le long itinéraire
    // dont le départ est sous nos pieds passe devant la courte randonnée dont
    // le départ est à l'autre bout de la vallée.
    expect(ids(proche.trails).indexOf("t_gr20_nord")).toBeLessThan(ids(proche.trails).indexOf("t_restonica_melo"));

    // Tri « la plus courte » : c'est la LONGUEUR qui décide, et l'ordre
    // s'inverse. Si les deux champs étaient confondus quelque part, l'un de ces
    // deux tris renverrait l'ordre de l'autre.
    const courte = await nearby(at(VIZZAVONA, "&sort=shortest"));
    expect(ids(courte.trails).indexOf("t_restonica_melo")).toBeLessThan(ids(courte.trails).indexOf("t_gr20_nord"));
    expect(find(courte, "t_gr20_nord").approachM).toBe(0);
  });

  it("classe par difficulté croissante (« la plus facile »)", async () => {
    const body = await nearby(at(VIZZAVONA, "&sort=easiest"));
    const rank = { easy: 0, moderate: 1, hard: 2, expert: 3 } as const;
    const ranks = body.trails.map((t) => rank[t.difficulty]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(body.trails[0].difficulty).toBe("easy");
    // À difficulté égale, le moindre dénivelé passe devant.
    expect(ids(body.trails).indexOf("t_restonica_melo")).toBeLessThan(
      ids(body.trails).indexOf("t_mare_a_mare_corte_sega"),
    );
  });

  it("ne fait jamais passer une fréquentation inconnue pour du calme", async () => {
    const body = await nearby(at(VIZZAVONA, "&sort=quietest"));
    // Aucun segment du réseau n'est encore rattaché à ces itinéraires : la
    // fréquentation est inconnue, et elle le dit.
    for (const trail of body.trails) {
      expect(trail.frequentation).toBeNull();
      expect(trail.passagesToday).toBeNull();
    }
    // Faute de critère, l'ordre reste total et reproductible : approche puis
    // identifiant. Deux chargements du même écran donnent la même liste.
    const encore = await nearby(at(VIZZAVONA, "&sort=quietest"));
    expect(ids(encore.trails)).toEqual(ids(body.trails));
    expect(ids(body.trails).slice(0, 3)).toEqual(["t_cascade_anglais", "t_gr20_nord", "t_gr20_sud"]);
  });

  it("classe par popularité décroissante, les inconnus en dernier", async () => {
    const body = await nearby(at(VIZZAVONA, "&sort=popular"));
    const scores = body.trails.map((t) => t.popularityScore);
    // « On ne sait pas » (null) n'est pas « impopulaire » : ces itinéraires
    // ferment la marche sans prétendre à un score.
    const connus = scores.filter((s): s is number => s !== null);
    expect([...connus].sort((a, b) => b - a)).toEqual(connus);
    const premierInconnu = scores.indexOf(null);
    if (premierInconnu >= 0) expect(scores.slice(premierInconnu).every((s) => s === null)).toBe(true);
    expect(body.sort).toBe("popular");
  });

  it("dit la forme du tracé et n'invente pas le dénivelé négatif", async () => {
    const body = await nearby(at(GROTELLE));
    // Boucle VTT du col de Vergio : le tracé se referme, on redescend donc ce
    // que l'on a monté.
    const boucle = find(body, "t_vtt_vergio_nino");
    expect(boucle.shape).toBe("loop");
    expect(boucle.elevationLossM).toBe(boucle.elevationGainM);
    // Itinéraire linéaire : l'arrivée est ailleurs, à une altitude que la base
    // ne connaît pas. `null`, et surtout pas 0.
    const lineaire = find(body, "t_restonica_melo");
    expect(lineaire.shape).toBe("linear");
    expect(lineaire.elevationLossM).toBeNull();
  });

  it("estime une durée de marche et dit qu'elle n'est pas observée", async () => {
    const body = await nearby(at(GROTELLE));
    const restonica = find(body, "t_restonica_melo");
    // 5,6 km et 530 m de dénivelé : entre une heure et demie et quatre heures.
    expect(restonica.durationMs).toBeGreaterThan(90 * 60_000);
    expect(restonica.durationMs).toBeLessThan(240 * 60_000);
    // Aucun passage enregistré : la durée est un calcul, et l'annonce.
    expect(restonica.durationObserved).toBe(false);
    // La durée est une troisième grandeur : elle ne vaut ni l'une ni l'autre
    // des deux distances.
    expect(restonica.durationMs).not.toBe(restonica.lengthM);
    expect(restonica.durationMs).not.toBe(restonica.approachM);
  });

  it("élargit le rayon quand le secteur est pauvre en itinéraires", async () => {
    // Bavella : un seul départ à moins de 10 km, deux à moins de 25 km.
    const body = await nearby(at(BAVELLA));
    expect(body.radiusM).toBe(50_000);
    expect(body.widened).toBe(true);
    expect(body.note).toContain("élargie");
    expect(body.trails[0].id).toBe("t_bavella_bombe");
  });

  it("respecte un rayon imposé sans élargir dans le dos de l'utilisateur", async () => {
    const body = await nearby(at(GROTELLE, "&radiusM=5000"));
    expect(body.radiusM).toBe(5000);
    expect(body.widened).toBe(false);
    expect(ids(body.trails)).toEqual(["t_restonica_melo"]);
    // Un seul itinéraire : la note le dit sans laisser croire que le massif est vide.
    expect(body.note).toContain("Seulement 1 itinéraire");
    expect(body.note).toContain("reste à enrichir");
  });

  it("en pleine mer : aucun résultat, et une note qui l'explique", async () => {
    const body = await nearby(at(HAUTE_MER));
    expect(body.trails).toEqual([]);
    expect(body.radiusM).toBe(50_000);
    expect(body.note).toBe("Aucun itinéraire connu dans un rayon de 50 km — la carte de ce secteur reste à enrichir.");
    // La phrase ne dit jamais qu'il n'y a rien à marcher ici : c'est la carte
    // qui est incomplète, pas la montagne.
    expect(body.note).toContain("reste à enrichir");
  });

  it("filtre par activité, les itinéraires mixtes restant ouverts à tous", async () => {
    const vtt = await nearby(at(GROTELLE, "&activity=mtb"));
    expect(ids(vtt.trails)).toContain("t_vtt_vergio_nino");
    for (const trail of vtt.trails) expect(["mtb", "mixed"]).toContain(trail.activity);

    const cheval = await nearby(at(GROTELLE, "&activity=equestrian"));
    // Aucun itinéraire équestre dans le jeu de démonstration : seul le Mare a
    // Mare, ouvert à plusieurs pratiques, reste proposé.
    expect(ids(cheval.trails)).toEqual(["t_mare_a_mare_corte_sega"]);
  });

  it("respecte la limite demandée sans fausser la note", async () => {
    const body = await nearby(at(GROTELLE, "&limit=2"));
    expect(body.trails).toHaveLength(2);
    // La note décrit la richesse du secteur, pas la taille de la page.
    expect(body.note).toBe("Peu d'itinéraires à proximité : la recherche a été élargie à 25 km.");
  });

  it("refuse une latitude absurde", async () => {
    const res = await call<{ error: { code: string; details: { path: string }[] } }>(
      app,
      "GET",
      "/trails/nearby?lat=200&lng=9.0453",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details[0].path).toBe("lat");

    const sansPosition = await call(app, "GET", "/trails/nearby");
    expect(sansPosition.status).toBe(400);
    const triInconnu = await call(app, "GET", `/trails/nearby?${at(GROTELLE, "&sort=le_plus_beau")}`);
    expect(triInconnu.status).toBe(400);
  });

  it("met la liste en cache une minute", async () => {
    const res = await call(app, "GET", `/trails/nearby?${at(GROTELLE)}`);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("« nearby » n'est jamais pris pour un identifiant d'itinéraire", async () => {
    // L'ordre d'enregistrement des routes Hono est le sujet de ce test : si
    // /trails/:id primait, l'écran d'accueil répondrait « Itinéraire
    // introuvable » à chaque ouverture de l'application.
    const res = await call<NearbyResponse>(app, "GET", `/trails/nearby?${at(GROTELLE)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trails)).toBe(true);

    // La route par identifiant, elle, continue de fonctionner.
    const fiche = await call(app, "GET", "/trails/t_restonica_melo");
    expect(fiche.status).toBe(200);
    const inconnu = await call<{ error: { code: string } }>(app, "GET", "/trails/t_inconnu");
    expect(inconnu.status).toBe(404);
    expect(inconnu.body.error.code).toBe("not_found");
  });

  it("n'interroge la base qu'une fois par rayon essayé", async () => {
    // Le coût de l'écran d'accueil ne doit pas dépendre du nombre
    // d'itinéraires renvoyés : pas de requête par itinéraire, ni pour les
    // statistiques, ni pour les signalements.
    const compte = new Map<string, number>();
    const vraiPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = ((source: string) => {
      for (const table of ["trails", "paths", "segment_statistics", "reports"]) {
        if (source.includes(`from "${table}"`)) compte.set(table, (compte.get(table) ?? 0) + 1);
      }
      return vraiPrepare(source);
    }) as typeof sqlite.prepare;

    try {
      const body = await nearby(at(GROTELLE));
      expect(body.trails.length).toBeGreaterThan(3);
      // Deux rayons essayés (10 km puis 25 km) : deux requêtes d'itinéraires.
      expect(compte.get("trails")).toBe(2);
      expect(compte.get("paths") ?? 0).toBeLessThanOrEqual(1);
      expect(compte.get("segment_statistics") ?? 0).toBeLessThanOrEqual(1);
      expect(compte.get("reports") ?? 0).toBeLessThanOrEqual(1);
    } finally {
      sqlite.prepare = vraiPrepare;
    }
  });
});

describe("Tracé complet d'un itinéraire", () => {
  it("reconstruit le tracé depuis les segments du réseau, pas depuis le schéma stocké", async () => {
    const res = await call<TrailGeometryResponse>(app, "GET", "/trails/t_restonica_melo/geometry");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("t_restonica_melo");
    expect(res.body.name).toContain("Restonica");

    /*
     * `trails.geometry` ne compte que 7 sommets — des points de passage. La
     * réponse en compte bien davantage : elle vient des SEGMENTS du réseau
     * navigable, qui est la donnée sur laquelle le guidage travaillera.
     */
    expect(res.body.geometryFrom).toBe("segments");
    expect(res.body.segmentCount).toBeGreaterThan(0);
    expect(res.body.coordinates.length).toBeGreaterThan(7);

    // Le premier sommet est le départ servi par la liste : le tracé affiché à
    // la sélection part bien du point annoncé.
    expect(res.body.coordinates[0]).toEqual([GROTELLE.lng, GROTELLE.lat]);

    // Provenance : de la démonstration, et l'API le dit franchement — c'est ce
    // qui permettra à l'interface de refuser de la présenter comme un sentier.
    expect(res.body.trailSource).toBe("seed");
    expect(res.body.source).toBe("seed");

    // Aucune altimétrie dans le jeu de démonstration : `null`, et non un
    // tableau de zéros qui aplatirait la vallée de la Restonica.
    expect(res.body.elevations).toBeNull();
  });

  it("répond 404 sur un itinéraire inconnu", async () => {
    const res = await call<{ error: { code: string } }>(app, "GET", "/trails/t_inconnu/geometry");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("rend les altitudes dès que les segments rattachés en portent", async () => {
    const segments = sqlite
      .prepare("SELECT id, coordinates FROM paths WHERE id LIKE 'd_t_restonica_melo%'")
      .all() as { id: string; coordinates: string }[];
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      const points = JSON.parse(segment.coordinates) as [number, number][];
      const elevations = points.map((_, i) => 900 + i);
      sqlite
        .prepare("UPDATE paths SET elevations = ?, trail_id = ? WHERE id = ?")
        .run(JSON.stringify(elevations), "t_restonica_melo", segment.id);
    }

    const res = await call<TrailGeometryResponse>(app, "GET", "/trails/t_restonica_melo/geometry");
    expect(res.status).toBe(200);
    expect(res.body.elevations).toHaveLength(res.body.coordinates.length);
    for (const value of res.body.elevations ?? []) expect(Number.isFinite(value)).toBe(true);
  });
});

/**
 * Fréquentation : les segments de la Restonica viennent d'être rattachés à
 * l'itinéraire par le test précédent ; il reste à leur donner des passages.
 */
describe("Fréquentation et seuil d'anonymat", () => {
  const COLONNES =
    "segment_id, activity_type, direction, passages_7, passages_total, unique_users, unique_sessions, median_ms, average_ms, p25_ms, p75_ms, spread, last_passage_at, popularity_score, frequentation, confidence, insufficient_data, updated_at";

  /** Écrit l'agrégat « toutes activités, les deux sens » de chaque segment de la Restonica. */
  function ecrireStatistiques(opts: { uniqueUsers: number; passages: number; medianMs: number }): void {
    const segments = sqlite
      .prepare("SELECT id FROM paths WHERE trail_id = 't_restonica_melo'")
      .all() as { id: string }[];
    expect(segments.length).toBeGreaterThan(0);
    const insert = sqlite.prepare(
      `INSERT OR REPLACE INTO segment_statistics (${COLONNES}) VALUES (?, 'all', 'both', ?, ?, ?, ?, ?, ?, ?, ?, 0.2, ?, 62, 'high', 0.7, 0, ?)`,
    );
    for (const { id } of segments) {
      insert.run(
        id,
        opts.passages,
        opts.passages,
        opts.uniqueUsers,
        opts.uniqueUsers,
        opts.medianMs,
        opts.medianMs,
        opts.medianMs,
        opts.medianMs,
        Date.now(),
        new Date().toISOString(),
      );
    }
  }

  it("ne publie rien sous le seuil d'utilisateurs distincts", async () => {
    // Deux contributeurs : en dire quoi que ce soit reviendrait à parler d'eux.
    ecrireStatistiques({ uniqueUsers: 2, passages: 14, medianMs: 1_800_000 });
    const body = await nearby(at(GROTELLE));
    const restonica = find(body, "t_restonica_melo");
    expect(restonica.frequentation).toBeNull();
    expect(restonica.passagesToday).toBeNull();
    // Pas « zéro » : rien. Un score de 0 se lirait « personne n'y passe ».
    expect(restonica.popularityScore).toBeNull();
    // Et la durée reste théorique : elle n'emprunte pas des passages que l'on
    // n'a pas le droit de publier.
    expect(restonica.durationObserved).toBe(false);
  });

  it("publie la fréquentation dès que le seuil est franchi", async () => {
    ecrireStatistiques({ uniqueUsers: 4, passages: 14, medianMs: 1_800_000 });
    const body = await nearby(at(GROTELLE));
    const restonica = find(body, "t_restonica_melo");
    expect(restonica.frequentation).toBe("high");
    expect(restonica.popularityScore).toBeGreaterThan(0);
    // 14 passages sur sept jours, le dernier aujourd'hui : deux passages du
    // jour. Un nombre parce qu'on sait — pas un `null`, parce qu'on sait.
    expect(restonica.passagesToday).toBe(2);
    // La durée s'appuie désormais sur des passages réellement observés.
    expect(restonica.durationObserved).toBe(true);

    // Les autres itinéraires n'ont toujours aucune donnée : ils restent muets.
    expect(find(body, "t_gr20_nord").frequentation).toBeNull();
    expect(find(body, "t_gr20_nord").passagesToday).toBeNull();
  });

  it("place l'itinéraire dont on sait quelque chose avant ceux dont on ne sait rien", async () => {
    // Tri « les plus calmes » : un itinéraire mesuré « fréquenté » passe devant
    // ceux dont la fréquentation est inconnue. L'inverse laisserait croire
    // qu'un sentier sans données est un sentier désert.
    const body = await nearby(at(GROTELLE, "&sort=quietest"));
    expect(body.trails[0].id).toBe("t_restonica_melo");
    expect(body.trails[0].frequentation).toBe("high");
    for (const trail of body.trails.slice(1)) expect(trail.frequentation).toBeNull();
  });

  it("met en tête le plus parcouru dans le tri « les plus populaires »", async () => {
    const body = await nearby(at(GROTELLE, "&sort=popular"));
    expect(body.trails[0].id).toBe("t_restonica_melo");
    expect(body.trails[0].popularityScore).toBeGreaterThan(0);
  });
});

describe("Signalements actifs sur l'itinéraire", () => {
  async function signaler(token: string, subtype: string, point: { lat: number; lng: number }): Promise<void> {
    const res = await call<{ report: { id: string; blurred: boolean } }>(app, "POST", "/reports", {
      token,
      body: { subtype, lat: point.lat, lng: point.lng, description: "Signalement de test" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Un signalement flouté n'est plus à l'endroit annoncé : ceux-ci ne le sont
    // pas, le test mesure donc bien une proximité au tracé.
    expect(res.body.report.blurred).toBe(false);
  }

  it("compte et nomme ce qui est signalé le long du tracé", async () => {
    const user = await registerUser(app);
    // Le lac de Capitello, dernier sommet du tracé de la Restonica : le
    // signalement est sur le sentier, et à près de deux kilomètres du GR20.
    await signaler(user.token, "fallen_tree", { lat: 42.2117, lng: 9.0183 });

    const body = await nearby(at(GROTELLE));
    const restonica = find(body, "t_restonica_melo");
    expect(restonica.activeReports).toBe(1);
    // Le libellé vient de la taxonomie, il n'est pas fabriqué par l'API.
    expect(restonica.reportHint).toBe("Arbre tombé signalé");

    // Les itinéraires voisins ne ramassent pas le signalement d'un autre.
    expect(find(body, "t_gr20_nord").activeReports).toBe(0);
    expect(find(body, "t_gr20_nord").reportHint).toBeNull();
  });

  it("compte plutôt que d'arbitrer quand plusieurs genres se cumulent", async () => {
    const user = await registerUser(app);
    await signaler(user.token, "herd", { lat: 42.2139, lng: 9.0261 });

    const body = await nearby(at(GROTELLE));
    const restonica = find(body, "t_restonica_melo");
    expect(restonica.activeReports).toBe(2);
    expect(restonica.reportHint).toBe("2 signalements");
  });

  it("ignore un signalement expiré : seul ce que la carte montre est compté", async () => {
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    sqlite.prepare("UPDATE reports SET expires_at = ? WHERE subtype = 'herd'").run(hier);

    const body = await nearby(at(GROTELLE));
    const restonica = find(body, "t_restonica_melo");
    expect(restonica.activeReports).toBe(1);
    expect(restonica.reportHint).toBe("Arbre tombé signalé");
  });

  it("ne rattache pas un signalement éloigné du tracé", async () => {
    const user = await registerUser(app);
    // À plus de deux kilomètres au nord du sentier, de l'autre côté de la crête.
    await signaler(user.token, "rockfall", { lat: 42.2461, lng: 9.0355 });

    const body = await nearby(at(GROTELLE));
    expect(find(body, "t_restonica_melo").activeReports).toBe(1);
  });
});

describe("Robustesse des tris", () => {
  const TRIS: NearbySort[] = ["closest", "popular", "easiest", "shortest", "quietest"];

  it("rend une liste complète et stable pour chacun des cinq critères", async () => {
    const reference = await nearby(at(GROTELLE));
    for (const sort of TRIS) {
      const body = await nearby(at(GROTELLE, `&sort=${sort}`));
      expect(body.sort).toBe(sort);
      // Un tri change l'ordre, jamais le contenu.
      expect(ids(body.trails).slice().sort()).toEqual(ids(reference.trails).slice().sort());
      // Et il est reproductible d'un chargement à l'autre.
      const encore = await nearby(at(GROTELLE, `&sort=${sort}`));
      expect(ids(encore.trails)).toEqual(ids(body.trails));
    }
  });
});
