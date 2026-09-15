import { describe, expect, it } from "vitest";
import { polylineLengthM, type LngLat } from "../geo";
import { makeSegment } from "../navigation/graph";
import type { PathSegment, PathSource } from "../navigation/types";
import {
  KNOWLEDGE_CORRECTION_PROPOSAL_NOTICE,
  KNOWLEDGE_EXTERNAL_CAP_REASON,
  KNOWLEDGE_EXTERNAL_SCORE_CAP,
  KNOWLEDGE_LAYER_WEIGHTS,
  KNOWLEDGE_NO_COMMUNITY_SUFFIX,
  KNOWLEDGE_NO_EVIDENCE_REASON,
  KNOWLEDGE_NO_USAGE_LABEL,
  KNOWLEDGE_TRAIL_CLEARANCE_M,
  KNOWLEDGE_TRAIL_ID_PREFIX,
  bestGeometry,
  potentialExistingTrails,
  potentialGeometryCorrections,
  resolveItinerary,
  segmentConfidence,
  segmentKnowledge,
} from "./knowledge";
import type { GeometryLayer, NormalizedTrace, SegmentAttestation, TraceCorridor } from "./types";

/* ------------------------------------------------------------------ */
/* Jeux de données fabriqués (tout est fictif : « example.org », etc.)  */
/* ------------------------------------------------------------------ */

/** Origine arbitraire d'un massif de démonstration. */
const LNG0 = 9;
const LAT0 = 42;
const M_PAR_DEG_LAT = 111320;
const M_PAR_DEG_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const JOUR = 86_400_000;
const MAINTENANT = Date.UTC(2026, 0, 15, 12, 0, 0);

/** Point situé à `estM` mètres à l'est et `nordM` mètres au nord de l'origine. */
function p(estM: number, nordM = 0): LngLat {
  return [LNG0 + estM / M_PAR_DEG_LNG, LAT0 + nordM / M_PAR_DEG_LAT];
}

/** Ligne est-ouest rectiligne, échantillonnée tous les `pasM` mètres. */
function ligne(deM: number, aM: number, nordM = 0, pasM = 25): LngLat[] {
  const out: LngLat[] = [];
  const sens = aM >= deM ? 1 : -1;
  for (let e = deM; sens > 0 ? e < aM : e > aM; e += sens * pasM) out.push(p(e, nordM));
  out.push(p(aM, nordM));
  return out;
}

/** Ligne est-ouest décalée au nord seulement entre `deM` et `aM`. */
function ligneDeviee(longueurM: number, deM: number, aM: number, nordM: number, pasM = 5): LngLat[] {
  const out: LngLat[] = [];
  for (let e = 0; e <= longueurM; e += pasM) out.push(p(e, e >= deM && e <= aM ? nordM : 0));
  return out;
}

function segment(id: string, coordinates: LngLat[], source: PathSource = "local"): PathSegment {
  return makeSegment(id, coordinates, { name: `Sentier de démonstration ${id}`, source });
}

function trace(coordinates: LngLat[], breaks: number[] = []): NormalizedTrace {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const c of coordinates) {
    west = Math.min(west, c[0]);
    east = Math.max(east, c[0]);
    south = Math.min(south, c[1]);
    north = Math.max(north, c[1]);
  }
  return {
    coordinates,
    elevations: null,
    times: null,
    lengthM: polylineLengthM(coordinates),
    elevationGainM: null,
    elevationLossM: null,
    bbox: coordinates.length === 0 ? { west: 0, south: 0, east: 0, north: 0 } : { west, south, east, north },
    removed: {},
    segments: breaks.length + 1,
    breaks,
  };
}

function attestation(
  layer: GeometryLayer,
  sourceId: string | null,
  traceId: string | null = null,
  at: number | null = null,
): SegmentAttestation {
  return { layer, sourceId, traceId, at, deviationM: null };
}

function faisceau(
  id: string,
  coordinates: LngLat[],
  options: { uniqueSources?: number; traceIds?: string[]; dispersionM?: number } = {},
): TraceCorridor {
  const traceIds = options.traceIds ?? ["trace-1", "trace-2", "trace-3"];
  return {
    id,
    traceIds,
    coordinates,
    lengthM: polylineLengthM(coordinates),
    dispersionM: options.dispersionM ?? 4,
    uniqueSources: options.uniqueSources ?? 3,
    confidence: 0.7,
  };
}

/** Candidat de géométrie tel que `bestGeometry` l'attend. */
interface CandidatGeometrie {
  layer: GeometryLayer;
  coordinates: LngLat[];
  sourceId: string | null;
  confidence?: number;
}

function candidat(
  layer: GeometryLayer,
  coordinates: LngLat[],
  sourceId: string | null = null,
  confidence?: number,
): CandidatGeometrie {
  return confidence === undefined ? { layer, coordinates, sourceId } : { layer, coordinates, sourceId, confidence };
}

const RESEAU_ABC = [
  segment("seg-a", ligne(0, 200)),
  segment("seg-b", ligne(200, 400)),
  segment("seg-c", ligne(400, 600)),
];

/* ------------------------------------------------------------------ */

describe("resolveItinerary — un GPX est un itinéraire, pas un chemin (section 6)", () => {
  it("rend les trois segments empruntés, dans l'ordre du parcours", () => {
    const resolu = resolveItinerary(trace(ligne(0, 600, 0, 10)), RESEAU_ABC, { traceId: "rando-demo" });
    expect(resolu.traceId).toBe("rando-demo");
    expect(resolu.legs.map((l) => l.segmentId)).toEqual(["seg-a", "seg-b", "seg-c"]);
    expect(resolu.gaps).toEqual([]);
    expect(resolu.matchedRatio).toBeGreaterThan(0.95);
    expect(resolu.unmatchedM).toBeLessThan(20);
  });

  it("mesure la couverture et l'écart de chaque tronçon sans jamais dépasser 1", () => {
    const resolu = resolveItinerary(trace(ligne(0, 600, 0, 10)), RESEAU_ABC);
    for (const leg of resolu.legs) {
      expect(leg.coverage).toBeGreaterThan(0.85);
      expect(leg.coverage).toBeLessThanOrEqual(1);
      expect(leg.deviationM).toBeLessThan(2);
      expect(leg.reversed).toBe(false);
      expect(Number.isFinite(leg.distanceM)).toBe(true);
    }
    expect(resolu.matchedM + resolu.unmatchedM).toBeCloseTo(polylineLengthM(ligne(0, 600, 0, 10)), 0);
  });

  it("signale le sens inverse quand l'itinéraire descend le chemin", () => {
    const resolu = resolveItinerary(trace(ligne(600, 0, 0, 10)), RESEAU_ABC);
    expect(resolu.legs.map((l) => l.segmentId)).toEqual(["seg-c", "seg-b", "seg-a"]);
    expect(resolu.legs.every((l) => l.reversed)).toBe(true);
  });

  it("rend en `gaps` la portion sans chemin connu, matière des nouveaux chemins", () => {
    const reseauTroue = [RESEAU_ABC[0], RESEAU_ABC[2]];
    const resolu = resolveItinerary(trace(ligne(0, 600, 0, 10)), reseauTroue, { traceId: "rando-trou" });
    expect(resolu.legs.map((l) => l.segmentId)).toEqual(["seg-a", "seg-c"]);
    expect(resolu.gaps).toHaveLength(1);
    expect(resolu.gaps[0].toM - resolu.gaps[0].fromM).toBeGreaterThan(100);
    expect(resolu.gaps[0].coordinates.length).toBeGreaterThanOrEqual(2);
    expect(resolu.unmatchedM).toBeGreaterThan(100);
    expect(resolu.matchedRatio).toBeLessThan(0.8);
  });

  it("ne rattache jamais l'arête fictive d'une trace interrompue", () => {
    const debut = ligne(0, 200, 0, 10);
    const fin = ligne(400, 600, 0, 10);
    const coupee = trace([...debut, ...fin], [debut.length]);
    const resolu = resolveItinerary(coupee, RESEAU_ABC);
    expect(resolu.legs.map((l) => l.segmentId)).toEqual(["seg-a", "seg-c"]);
    expect(resolu.gaps).toHaveLength(1);
  });

  it("évite l'aller-retour parasite entre deux segments voisins (hystérésis)", () => {
    const reseau = [segment("seg-a", ligne(0, 400)), segment("seg-b", ligne(180, 250, 5, 10))];
    const devie = trace(ligneDeviee(400, 185, 245, 3));
    expect(resolveItinerary(devie, reseau).legs.map((l) => l.segmentId)).toEqual(["seg-a"]);
  });

  it("bascule quand même sur le voisin si la marge de changement est annulée", () => {
    const reseau = [segment("seg-a", ligne(0, 400)), segment("seg-b", ligne(180, 250, 5, 10))];
    const devie = trace(ligneDeviee(400, 185, 245, 3));
    const resolu = resolveItinerary(devie, reseau, { switchMarginM: 0 });
    expect(resolu.legs.map((l) => l.segmentId)).toEqual(["seg-a", "seg-b", "seg-a"]);
  });

  it("n'expose pas un tronçon plus court que la longueur minimale", () => {
    const reseau = [segment("seg-a", ligne(0, 400)), segment("seg-b", ligne(180, 250, 5, 10))];
    const devie = trace(ligneDeviee(400, 185, 245, 3));
    const resolu = resolveItinerary(devie, reseau, { switchMarginM: 0, minLegM: 500 });
    expect(resolu.legs).toEqual([]);
    expect(resolu.matchedM).toBe(0);
    expect(resolu.unmatchedM).toBeGreaterThan(0);
  });

  it("ne publie pas un trou plus court que la longueur minimale, mais le compte", () => {
    const reseauTroue = [RESEAU_ABC[0], RESEAU_ABC[2]];
    const resolu = resolveItinerary(trace(ligne(0, 600, 0, 10)), reseauTroue, { minGapM: 10_000 });
    expect(resolu.gaps).toEqual([]);
    expect(resolu.unmatchedM).toBeGreaterThan(100);
  });

  it("ne rattache rien au-delà de la tolérance de projection", () => {
    const loin = trace(ligne(0, 600, 300, 10));
    const resolu = resolveItinerary(loin, RESEAU_ABC);
    expect(resolu.legs).toEqual([]);
    expect(resolu.matchedRatio).toBe(0);
    expect(resolu.gaps.length).toBeGreaterThan(0);
  });

  it("supporte une trace vide, d'un seul point ou de points identiques", () => {
    for (const degenere of [trace([]), trace([p(0)]), trace([p(0), p(0), p(0)])]) {
      const resolu = resolveItinerary(degenere, RESEAU_ABC, { traceId: "degenere" });
      expect(resolu).toEqual({
        traceId: "degenere",
        legs: [],
        matchedM: 0,
        unmatchedM: 0,
        matchedRatio: 0,
        gaps: [],
      });
    }
  });

  it("supporte un réseau vide ou des segments illisibles sans rien inventer", () => {
    const cassee = [
      segment("seg-vide", []),
      segment("seg-point", [p(0)]),
      { ...segment("seg-nul", ligne(0, 200)), coordinates: [p(0), p(0)] },
    ];
    expect(resolveItinerary(trace(ligne(0, 600, 0, 10)), []).legs).toEqual([]);
    expect(resolveItinerary(trace(ligne(0, 600, 0, 10)), cassee).legs).toEqual([]);
  });

  it("donne le même résultat quel que soit l'ordre des segments fournis", () => {
    const parcours = trace(ligne(0, 600, 0, 10));
    const direct = resolveItinerary(parcours, RESEAU_ABC, { traceId: "t" });
    const melange = resolveItinerary(parcours, [RESEAU_ABC[2], RESEAU_ABC[0], RESEAU_ABC[1]], { traceId: "t" });
    expect(JSON.stringify(melange)).toBe(JSON.stringify(direct));
    expect(JSON.stringify(resolveItinerary(parcours, RESEAU_ABC, { traceId: "t" }))).toBe(JSON.stringify(direct));
  });
});

/* ------------------------------------------------------------------ */

describe("segmentConfidence — expliquer le chiffre (section 12)", () => {
  it("ne compte qu'une fois une source qui se répète", () => {
    const repetee = segmentConfidence(
      [
        attestation("osm", "source-a", null, MAINTENANT - JOUR),
        attestation("osm", "source-a", null, MAINTENANT - 2 * JOUR),
        attestation("osm", "source-a", null, MAINTENANT - 3 * JOUR),
      ],
      {},
      MAINTENANT,
    );
    expect(repetee.uniqueSources).toBe(1);
    expect(repetee.reasons).toContain("attesté par une seule source");
    expect(repetee.reasons).toContain("présent dans OpenStreetMap");
  });

  it("monte nettement avec trois sources indépendantes", () => {
    const une = segmentConfidence([attestation("osm", "source-a", null, MAINTENANT)], {}, MAINTENANT);
    const trois = segmentConfidence(
      [
        attestation("osm", "source-a", null, MAINTENANT),
        attestation("osm", "source-b", null, MAINTENANT),
        attestation("official", "source-c", null, MAINTENANT),
      ],
      {},
      MAINTENANT,
    );
    expect(trois.uniqueSources).toBe(3);
    expect(trois.score).toBeGreaterThan(une.score);
    expect(trois.reasons).toContain("attesté par 3 sources indépendantes");
    expect(trois.reasons).toContain("présent dans une source officielle");
  });

  it("classe les raisons par contribution décroissante", () => {
    const fiche = segmentConfidence(
      [
        attestation("official", "source-a", "trace-1", MAINTENANT),
        attestation("official", "source-b", "trace-2", MAINTENANT),
        attestation("observed", "source-c", null, MAINTENANT),
      ],
      { passages: 40, uniqueUsers: 9, lastPassageAt: MAINTENANT - JOUR },
      MAINTENANT,
    );
    expect(fiche.reasons[0]).toBe("présent dans une source officielle");
    expect(fiche.reasons).toContain("40 passages de nos utilisateurs");
    expect(fiche.reasons).toContain("dernière observation : aujourd'hui");
  });

  it("plafonne le score sur la seule foi des sources externes (section 25)", () => {
    const externes = segmentConfidence(
      [
        attestation("official", "source-a", "trace-1", MAINTENANT),
        attestation("official", "source-b", "trace-2", MAINTENANT),
        attestation("osm", "source-c", "trace-3", MAINTENANT),
        attestation("osm", "source-d", "trace-4", MAINTENANT),
        attestation("community", "source-e", "trace-5", MAINTENANT),
        attestation("imported_gpx", "source-f", "trace-6", MAINTENANT),
      ],
      {},
      MAINTENANT,
    );
    expect(externes.score).toBe(KNOWLEDGE_EXTERNAL_SCORE_CAP);
    expect(externes.reasons).toContain(KNOWLEDGE_EXTERNAL_CAP_REASON);
  });

  it("n'atteint 100 qu'avec l'usage réel de nos utilisateurs", () => {
    const attestations = [
      attestation("official", "source-a", "trace-1", MAINTENANT),
      attestation("official", "source-b", "trace-2", MAINTENANT),
      attestation("osm", "source-c", "trace-3", MAINTENANT),
      attestation("osm", "source-d", "trace-4", MAINTENANT),
      attestation("community", "source-e", "trace-5", MAINTENANT),
      attestation("imported_gpx", "source-f", "trace-6", MAINTENANT),
    ];
    const avecUsage = segmentConfidence(
      attestations,
      { passages: 60, uniqueUsers: 12, lastPassageAt: MAINTENANT },
      MAINTENANT,
    );
    expect(avecUsage.score).toBe(100);
    expect(avecUsage.passages).toBe(60);
    const peuDUsage = segmentConfidence(attestations, { passages: 2, uniqueUsers: 1 }, MAINTENANT);
    expect(peuDUsage.score).toBeGreaterThan(KNOWLEDGE_EXTERNAL_SCORE_CAP);
    expect(peuDUsage.score).toBeLessThan(100);
  });

  it("récompense la fraîcheur de la dernière preuve", () => {
    const fraiche = segmentConfidence([attestation("osm", "source-a", null, MAINTENANT - JOUR)], {}, MAINTENANT);
    const ancienne = segmentConfidence(
      [attestation("osm", "source-a", null, MAINTENANT - 2000 * JOUR)],
      {},
      MAINTENANT,
    );
    expect(fraiche.score).toBeGreaterThan(ancienne.score);
    expect(fraiche.reasons).toContain("dernière observation : hier");
    expect(ancienne.reasons).toContain("dernière observation : il y a 5 ans");
  });

  it("retient le passage le plus récent comme dernière preuve", () => {
    const fiche = segmentConfidence(
      [attestation("osm", "source-a", null, MAINTENANT - 400 * JOUR)],
      { passages: 3, lastPassageAt: MAINTENANT - JOUR },
      MAINTENANT,
    );
    expect(fiche.lastEvidenceAt).toBe(MAINTENANT - JOUR);
    expect(fiche.reasons).toContain("dernière observation : hier");
  });

  it("compte les traces importées distinctes et détaille les couches", () => {
    const fiche = segmentConfidence(
      [
        attestation("imported_gpx", "source-a", "trace-1", MAINTENANT),
        attestation("imported_gpx", "source-a", "trace-1", MAINTENANT),
        attestation("imported_gpx", "source-b", "trace-2", MAINTENANT),
      ],
      {},
      MAINTENANT,
    );
    expect(fiche.traces).toBe(2);
    expect(fiche.reasons).toContain("2 traces importées distinctes");
    expect(fiche.byLayer.imported_gpx).toBe(KNOWLEDGE_LAYER_WEIGHTS.imported_gpx);
    expect(fiche.byLayer.osm).toBeUndefined();
  });

  it("n'accorde aucune indépendance à une attestation sans source nommée", () => {
    const anonyme = segmentConfidence(
      [attestation("osm", null, null, null), attestation("osm", null, null, null)],
      {},
      MAINTENANT,
    );
    expect(anonyme.uniqueSources).toBe(0);
    expect(anonyme.lastEvidenceAt).toBeNull();
    expect(anonyme.byLayer.osm).toBeDefined();
    expect(anonyme.score).toBeGreaterThan(0);
    expect(anonyme.score).toBeLessThan(KNOWLEDGE_EXTERNAL_SCORE_CAP);
  });

  it("ne conclut rien sans aucune attestation ni usage", () => {
    const vide = segmentConfidence([], {}, MAINTENANT);
    expect(vide.score).toBe(0);
    expect(vide.reasons).toEqual([KNOWLEDGE_NO_EVIDENCE_REASON]);
    expect(vide.byLayer).toEqual({});
    expect(vide.uniqueSources).toBe(0);
    expect(vide.traces).toBe(0);
    expect(vide.passages).toBe(0);
    expect(vide.lastEvidenceAt).toBeNull();
  });

  it("ignore les comptages d'usage aberrants sans produire de NaN", () => {
    const fiche = segmentConfidence(
      [attestation("osm", "source-a", null, Number.NaN)],
      { passages: Number.NaN, uniqueUsers: -5, lastPassageAt: Number.POSITIVE_INFINITY },
      MAINTENANT,
    );
    expect(Number.isFinite(fiche.score)).toBe(true);
    expect(fiche.passages).toBe(0);
    expect(fiche.lastEvidenceAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe("bestGeometry — choisir une couche et dire pourquoi (section 21)", () => {
  const officielle = candidat("official", ligne(0, 200), "source-parc");
  const osm = candidat("osm", ligne(0, 200, 2), "source-osm");
  const importee = candidat("imported_gpx", ligne(0, 200, 4), "source-gpx");

  it("préfère la ligne communautaire quand elle est solide", () => {
    const choix = bestGeometry([
      officielle,
      candidat("community", ligne(0, 200, 1), null, 0.8),
    ]);
    expect(choix?.layer).toBe("community");
    expect(choix?.sourceId).toBeNull();
    expect(choix?.reason).toContain("passages réels");
    expect(choix?.reason).toContain("confiance 0,80");
  });

  it("recule derrière l'officiel quand la ligne communautaire est fragile", () => {
    const choix = bestGeometry([
      officielle,
      candidat("community", ligne(0, 200, 1), null, 0.3),
    ]);
    expect(choix?.layer).toBe("official");
    expect(choix?.reason).toContain(KNOWLEDGE_NO_COMMUNITY_SUFFIX);
  });

  it("traite une confiance communautaire inconnue comme non solide", () => {
    const choix = bestGeometry([osm, candidat("community", ligne(0, 200, 1))]);
    expect(choix?.layer).toBe("osm");
  });

  it("respecte l'ordre officiel, puis OSM, puis trace importée", () => {
    expect(bestGeometry([importee, osm, officielle])?.layer).toBe("official");
    expect(bestGeometry([importee, osm])?.layer).toBe("osm");
    expect(bestGeometry([importee])?.layer).toBe("imported_gpx");
  });

  it("retient tout de même une ligne communautaire fragile faute de mieux", () => {
    const choix = bestGeometry([candidat("community", ligne(0, 200), null, 0.1)]);
    expect(choix?.layer).toBe("community");
    expect(choix?.reason).toContain("faute de mieux");
  });

  it("n'accepte jamais une géométrie de moins de deux points", () => {
    const choix = bestGeometry([
      candidat("official", [p(0)], "source-parc"),
      candidat("osm", ligne(0, 200), "source-osm"),
    ]);
    expect(choix?.layer).toBe("osm");
    expect(bestGeometry([candidat("official", [])])).toBeNull();
    expect(bestGeometry([])).toBeNull();
  });

  it("écarte une géométrie de longueur nulle ou partiellement illisible", () => {
    const illisible: LngLat[] = [p(0), [400, 95]];
    expect(bestGeometry([candidat("osm", illisible)])).toBeNull();
    expect(bestGeometry([candidat("osm", [p(0), p(0)])])).toBeNull();
  });

  it("rend une copie de la géométrie : l'appelant ne peut pas corrompre la source", () => {
    const source = ligne(0, 200);
    const choix = bestGeometry([candidat("osm", source, "source-osm")]);
    expect(choix).not.toBeNull();
    if (choix !== null) choix.coordinates[0] = [0, 0];
    expect(source[0]).toEqual(p(0));
  });

  it("départage deux candidats de même couche de façon déterministe", () => {
    const a = candidat("osm", ligne(0, 200), "source-b", 0.5);
    const b = candidat("osm", ligne(0, 200), "source-a", 0.5);
    expect(bestGeometry([a, b])?.sourceId).toBe("source-a");
    expect(bestGeometry([b, a])?.sourceId).toBe("source-a");
  });
});

/* ------------------------------------------------------------------ */

describe("potentialExistingTrails — chemins probablement existants (section 13)", () => {
  const horsReseau = ligne(0, 400, 500);

  it("propose un corridor attesté par plusieurs sources et absent de la base", () => {
    const propositions = potentialExistingTrails([faisceau("corr-1", horsReseau)], RESEAU_ABC);
    expect(propositions).toHaveLength(1);
    expect(propositions[0].id).toBe(`${KNOWLEDGE_TRAIL_ID_PREFIX}corr-1`);
    expect(propositions[0].uniqueSources).toBe(3);
    expect(propositions[0].traces).toBe(3);
    expect(propositions[0].score).toBeGreaterThan(50);
    expect(propositions[0].reasons[0]).toContain("3 sources indépendantes attestent");
    expect(propositions[0].reasons.some((r) => r.includes("aucun chemin connu sur 100 %"))).toBe(true);
  });

  it("exige plusieurs sources DISTINCTES", () => {
    const uneSeule = faisceau("corr-1", horsReseau, { uniqueSources: 1, traceIds: ["trace-1", "trace-2"] });
    expect(potentialExistingTrails([uneSeule], RESEAU_ABC)).toEqual([]);
  });

  it("ne propose rien quand un chemin de la base décrit déjà le corridor", () => {
    expect(potentialExistingTrails([faisceau("corr-1", ligne(0, 400))], RESEAU_ABC)).toEqual([]);
  });

  it("ne propose rien sous la longueur minimale", () => {
    expect(potentialExistingTrails([faisceau("corr-court", ligne(0, 80, 500))], RESEAU_ABC)).toEqual([]);
  });

  it("compte les passages de nos utilisateurs quand ils sont connus", () => {
    const propositions = potentialExistingTrails([faisceau("corr-1", horsReseau)], RESEAU_ABC, {
      passagesByCorridor: { "corr-1": 12 },
    });
    expect(propositions[0].passages).toBe(12);
    expect(propositions[0].reasons).toContain("12 passages de nos utilisateurs");
  });

  it("ne flatte pas un faisceau dont la dispersion est inconnue", () => {
    const inconnue = faisceau("corr-1", horsReseau, { dispersionM: Number.NaN });
    const propositions = potentialExistingTrails([inconnue], RESEAU_ABC);
    expect(propositions[0].dispersionM).toBe(KNOWLEDGE_TRAIL_CLEARANCE_M);
    expect(propositions[0].score).toBeLessThan(
      potentialExistingTrails([faisceau("corr-1", horsReseau, { dispersionM: 0 })], RESEAU_ABC)[0].score,
    );
  });

  it("trie les propositions par score décroissant, de façon déterministe", () => {
    const solide = faisceau("corr-solide", ligne(0, 900, 500), { uniqueSources: 4, dispersionM: 1 });
    const fragile = faisceau("corr-fragile", ligne(0, 200, 800), {
      uniqueSources: 2,
      traceIds: ["trace-1"],
      dispersionM: 20,
    });
    const ordre = potentialExistingTrails([fragile, solide], RESEAU_ABC).map((t) => t.id);
    expect(ordre).toEqual([`${KNOWLEDGE_TRAIL_ID_PREFIX}corr-solide`, `${KNOWLEDGE_TRAIL_ID_PREFIX}corr-fragile`]);
    expect(potentialExistingTrails([solide, fragile], RESEAU_ABC).map((t) => t.id)).toEqual(ordre);
  });

  it("supporte les entrées vides et les corridors illisibles", () => {
    expect(potentialExistingTrails([], RESEAU_ABC)).toEqual([]);
    expect(potentialExistingTrails([faisceau("corr-vide", [])], RESEAU_ABC)).toEqual([]);
    expect(potentialExistingTrails([faisceau("corr-point", [p(0, 500)])], RESEAU_ABC)).toEqual([]);
    expect(potentialExistingTrails([faisceau("corr-1", horsReseau)], []).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */

describe("potentialGeometryCorrections — un décalage systématique (section 14)", () => {
  const segOsm = segment("seg-a", ligne(0, 400), "osm");

  it("propose une correction quand le faisceau décale toujours du même côté", () => {
    const propositions = potentialGeometryCorrections([
      { segment: segOsm, corridor: faisceau("corr-1", ligne(0, 400, 15)) },
    ]);
    expect(propositions).toHaveLength(1);
    expect(propositions[0].segmentId).toBe("seg-a");
    expect(propositions[0].layer).toBe("osm");
    expect(propositions[0].offsetM).toBeCloseTo(15, 0);
    expect(propositions[0].maxOffsetM).toBeCloseTo(15, 0);
    expect(propositions[0].evidence).toBe(3);
    expect(propositions[0].reasons.some((r) => r.includes("15 m à gauche du tracé de référence"))).toBe(true);
    expect(propositions[0].reasons).toContain(KNOWLEDGE_CORRECTION_PROPOSAL_NOTICE);
  });

  it("donne un écart négatif quand le faisceau passe de l'autre côté", () => {
    const propositions = potentialGeometryCorrections([
      { segment: segOsm, corridor: faisceau("corr-1", ligne(0, 400, -15)) },
    ]);
    expect(propositions[0].offsetM).toBeCloseTo(-15, 0);
    expect(propositions[0].maxOffsetM).toBeGreaterThan(0);
    expect(propositions[0].reasons.some((r) => r.includes("15 m à droite du tracé de référence"))).toBe(true);
  });

  it("ne voit aucun décalage dans un faisceau qui déborde autant à gauche qu'à droite", () => {
    const symetrique = [...ligne(0, 200, 15), ...ligne(200, 400, -15)];
    expect(potentialGeometryCorrections([{ segment: segOsm, corridor: faisceau("corr-1", symetrique) }])).toEqual([]);
  });

  it("exige que les écarts aillent majoritairement du même côté", () => {
    const deSequilibre = [...ligne(0, 240, 15), ...ligne(240, 400, -15)];
    const entree = [{ segment: segOsm, corridor: faisceau("corr-1", deSequilibre) }];
    expect(potentialGeometryCorrections(entree)).toEqual([]);
    expect(potentialGeometryCorrections(entree, { minSignShare: 0 })).toHaveLength(1);
  });

  it("ne propose rien sous l'écart minimal", () => {
    expect(
      potentialGeometryCorrections([{ segment: segOsm, corridor: faisceau("corr-1", ligne(0, 400, 3)) }]),
    ).toEqual([]);
  });

  it("refuse de conclure quand la dispersion du faisceau dépasse l'écart constaté", () => {
    const disperse = faisceau("corr-1", ligne(0, 400, 15), { dispersionM: 30 });
    expect(potentialGeometryCorrections([{ segment: segOsm, corridor: disperse }])).toEqual([]);
    const resserre = faisceau("corr-1", ligne(0, 400, 15), { dispersionM: 2 });
    expect(potentialGeometryCorrections([{ segment: segOsm, corridor: resserre }])).toHaveLength(1);
  });

  it("exige plusieurs sources distinctes avant de proposer une correction", () => {
    const uneSource = faisceau("corr-1", ligne(0, 400, 15), { uniqueSources: 1 });
    expect(potentialGeometryCorrections([{ segment: segOsm, corridor: uneSource }])).toEqual([]);
  });

  it("ignore un faisceau trop éloigné : il décrit un autre chemin", () => {
    expect(
      potentialGeometryCorrections([{ segment: segOsm, corridor: faisceau("corr-1", ligne(0, 400, 200)) }]),
    ).toEqual([]);
  });

  it("ne propose rien quand le faisceau ne couvre qu'un bout du segment", () => {
    const partiel = faisceau("corr-1", ligne(0, 80, 15));
    expect(potentialGeometryCorrections([{ segment: segOsm, corridor: partiel }])).toEqual([]);
  });

  it("nomme la couche de la géométrie jugée fautive", () => {
    const officiel = segment("seg-ign", ligne(0, 400), "ign");
    const propositions = potentialGeometryCorrections([
      { segment: officiel, corridor: faisceau("corr-1", ligne(0, 400, 15)) },
    ]);
    expect(propositions[0].layer).toBe("official");
  });

  it("supporte les entrées vides et les géométries dégénérées", () => {
    expect(potentialGeometryCorrections([])).toEqual([]);
    expect(
      potentialGeometryCorrections([
        { segment: segment("seg-vide", []), corridor: faisceau("corr-1", ligne(0, 400, 15)) },
        { segment: segOsm, corridor: faisceau("corr-2", [p(0, 15)]) },
        { segment: segment("seg-nul", [p(0), p(0)]), corridor: faisceau("corr-3", ligne(0, 400, 15)) },
      ]),
    ).toEqual([]);
  });

  it("trie les propositions et reste déterministe", () => {
    const entree = [
      { segment: segment("seg-b", ligne(0, 400), "osm"), corridor: faisceau("corr-b", ligne(0, 400, 10)) },
      {
        segment: segment("seg-a", ligne(0, 400), "osm"),
        corridor: faisceau("corr-a", ligne(0, 400, 25), { uniqueSources: 5 }),
      },
    ];
    const ordre = potentialGeometryCorrections(entree).map((c) => c.segmentId);
    expect(ordre).toEqual(["seg-a", "seg-b"]);
    expect(potentialGeometryCorrections([entree[1], entree[0]]).map((c) => c.segmentId)).toEqual(ordre);
  });
});

/* ------------------------------------------------------------------ */

describe("segmentKnowledge — la fiche d'un segment (section 30)", () => {
  const seg = segment("seg-a", ligne(0, 200), "osm");
  const attestations = [
    attestation("osm", "source-a", "trace-1", MAINTENANT - 10 * JOUR),
    attestation("osm", "source-a", "trace-2", MAINTENANT - 5 * JOUR),
    attestation("official", "source-b", null, MAINTENANT - 200 * JOUR),
  ];

  it("répond « pas encore de données » pour un segment sans aucun usage", () => {
    const fiche = segmentKnowledge({ segment: seg, attestations, itineraries: [] }, MAINTENANT);
    expect(fiche.usage).toEqual({
      passages: null,
      uniqueUsers: null,
      averageDurationMs: null,
      activities: null,
      frequentation: null,
      lastPassageAt: null,
      insufficientData: true,
    });
    expect(fiche.summary).toContain(KNOWLEDGE_NO_USAGE_LABEL);
    expect(fiche.summary).not.toContain("0 passage");
  });

  it("décrit la géométrie de référence et sa couche", () => {
    const fiche = segmentKnowledge({ segment: seg, attestations, itineraries: [] }, MAINTENANT);
    expect(fiche.segmentId).toBe("seg-a");
    expect(fiche.geometry.layer).toBe("osm");
    expect(fiche.geometry.points).toBe(seg.coordinates.length);
    expect(fiche.geometry.lengthM).toBeGreaterThan(190);
    expect(fiche.geometry.lengthM).toBeLessThan(210);
  });

  it("regroupe les sources distinctes, la plus structurante d'abord", () => {
    const fiche = segmentKnowledge({ segment: seg, attestations, itineraries: [] }, MAINTENANT);
    expect(fiche.sources).toEqual([
      { sourceId: "source-b", layer: "official", attestations: 1, lastAt: MAINTENANT - 200 * JOUR },
      { sourceId: "source-a", layer: "osm", attestations: 2, lastAt: MAINTENANT - 5 * JOUR },
    ]);
    expect(fiche.confidence.uniqueSources).toBe(2);
    expect(fiche.confidence.traces).toBe(2);
  });

  it("dédoublonne et trie les itinéraires qui empruntent le segment", () => {
    const fiche = segmentKnowledge(
      {
        segment: seg,
        attestations,
        itineraries: [
          { id: "itin-2", name: "Tour du plateau" },
          { id: "itin-1", name: "Boucle des bergeries" },
          { id: "itin-2", name: "Tour du plateau" },
          { id: "itin-3", name: null },
        ],
      },
      MAINTENANT,
    );
    expect(fiche.itineraries.map((i) => i.id)).toEqual(["itin-1", "itin-2", "itin-3"]);
    expect(fiche.summary).toContain("emprunté par 3 itinéraires");
  });

  it("publie l'usage dès qu'il y a assez de passages", () => {
    const fiche = segmentKnowledge(
      {
        segment: seg,
        attestations,
        itineraries: [],
        usage: {
          passages: 73,
          uniqueUsers: 11,
          lastPassageAt: MAINTENANT - JOUR,
          averageDurationMs: 900_000,
          activities: { hiking: 0.8, trail: 0.2 },
          frequentation: "high",
        },
      },
      MAINTENANT,
    );
    expect(fiche.usage.passages).toBe(73);
    expect(fiche.usage.uniqueUsers).toBe(11);
    expect(fiche.usage.averageDurationMs).toBe(900_000);
    expect(fiche.usage.activities).toEqual({ hiking: 0.8, trail: 0.2 });
    expect(fiche.usage.frequentation).toBe("high");
    expect(fiche.usage.insufficientData).toBe(false);
    expect(fiche.summary).toContain("73 passages de nos utilisateurs");
  });

  it("ne conclut rien sur deux passages : comptages exacts, indices tus", () => {
    const fiche = segmentKnowledge(
      {
        segment: seg,
        attestations,
        itineraries: [],
        usage: {
          passages: 2,
          uniqueUsers: 1,
          lastPassageAt: MAINTENANT - JOUR,
          averageDurationMs: 900_000,
          activities: { hiking: 1 },
          frequentation: "very_high",
        },
      },
      MAINTENANT,
    );
    expect(fiche.usage.passages).toBe(2);
    expect(fiche.usage.insufficientData).toBe(true);
    expect(fiche.usage.averageDurationMs).toBeNull();
    expect(fiche.usage.activities).toBeNull();
    expect(fiche.usage.frequentation).toBeNull();
    expect(fiche.summary).toContain(KNOWLEDGE_NO_USAGE_LABEL);
  });

  it("traduit « unknown » et les activités vides en absence de donnée", () => {
    const fiche = segmentKnowledge(
      {
        segment: seg,
        attestations,
        itineraries: [],
        usage: { passages: 40, frequentation: "unknown", activities: { hiking: 0 } },
      },
      MAINTENANT,
    );
    expect(fiche.usage.frequentation).toBeNull();
    expect(fiche.usage.activities).toBeNull();
    expect(fiche.usage.uniqueUsers).toBeNull();
  });

  it("rappelle la dernière validation humaine quand elle existe", () => {
    const fiche = segmentKnowledge(
      { segment: seg, attestations, itineraries: [], lastValidatedAt: MAINTENANT - JOUR },
      MAINTENANT,
    );
    expect(fiche.lastValidatedAt).toBe(MAINTENANT - JOUR);
    expect(fiche.summary).toContain("validé hier");
    const jamais = segmentKnowledge({ segment: seg, attestations, itineraries: [] }, MAINTENANT);
    expect(jamais.lastValidatedAt).toBeNull();
  });

  it("reste valide pour un segment sans source, sans nom et sans géométrie", () => {
    const orphelin = { ...segment("seg-orphelin", [p(0)]), name: null, lengthM: 42 };
    const fiche = segmentKnowledge({ segment: orphelin, attestations: [], itineraries: [] }, MAINTENANT);
    expect(fiche.name).toBeNull();
    expect(fiche.sources).toEqual([]);
    expect(fiche.geometry.points).toBe(1);
    expect(fiche.geometry.lengthM).toBe(42);
    expect(fiche.confidence.reasons).toEqual([KNOWLEDGE_NO_EVIDENCE_REASON]);
    expect(fiche.summary).toContain(KNOWLEDGE_NO_EVIDENCE_REASON);
  });

  it("produit exactement la même fiche à instant de référence égal", () => {
    const entree = {
      segment: seg,
      attestations,
      itineraries: [
        { id: "itin-2", name: "Tour du plateau" },
        { id: "itin-1", name: "Boucle des bergeries" },
      ],
      usage: { passages: 73, uniqueUsers: 11, lastPassageAt: MAINTENANT - JOUR },
      lastValidatedAt: MAINTENANT - 30 * JOUR,
    };
    expect(JSON.stringify(segmentKnowledge(entree, MAINTENANT))).toBe(
      JSON.stringify(segmentKnowledge(entree, MAINTENANT)),
    );
  });
});
