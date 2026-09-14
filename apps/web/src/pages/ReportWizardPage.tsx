/**
 * Assistant de signalement en moins de 20 secondes (sections 4 et 32).
 *
 * Routes : /report → /report/category (redirection), puis /report/subtype,
 * /report/details, /report/done. Toutes les étapes vivent sous /report/:step :
 * le composant reste monté d'un bout à l'autre, le brouillon est en mémoire
 * (et en sessionStorage, sans la photo, pour survivre à un détour par la
 * connexion). Plein écran, sans barre de navigation.
 *
 * Liens profonds acceptés : /report/details?subtype=fallen_tree&lat=42.3&lng=9.15
 * (par exemple depuis un appui long sur la carte).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronLeft, Send, X } from "lucide-react";
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, fr, isSubtype, type ReportSubtype } from "@mountain-live/core";
import { Button, IconButton, TopBar, toast, useEscapeKey } from "@/components/ui";
import { newClientId } from "@/lib/outbox";
import { useUiStore } from "@/store/ui";
import { StepIndicator } from "@/features/report/StepIndicator";
import { clearDraft, loadDraft, saveDraft } from "@/features/report/draftStorage";
import { useFrequentSubtypes } from "@/features/report/frequentSubtypes";
import { useReportPosition } from "@/features/report/useReportPosition";
import { describePublishError, usePublishReport, type PublishOutcome } from "@/features/report/usePublishReport";
import {
  applySubtype,
  createDraft,
  draftReducer,
  isPositionValid,
  parseStep,
  validateDraft,
  type DraftErrors,
  type DraftPosition,
  type WizardDraft,
  type WizardStep,
} from "@/features/report/wizardState";
import { CategoryStep } from "@/features/report/steps/CategoryStep";
import { SubtypeStep } from "@/features/report/steps/SubtypeStep";
import { DetailsStep } from "@/features/report/steps/DetailsStep";
import { DoneStep } from "@/features/report/steps/DoneStep";

/** État de navigation transmis à /map après une publication (recentrage et mise en avant). */
export interface MapNavigationState {
  focus?: { lat: number; lng: number };
  publishedReportId?: string;
  queuedClientId?: string;
}

export const MAP_FOCUS_ZOOM = 15;
export const TOAST_PUBLISHED = "Signalement publié — merci !";
export const TOAST_QUEUED = "Enregistré. Il sera publié dès le retour du réseau.";

const TITLES: Record<WizardStep, string> = {
  category: "Signaler",
  subtype: fr.wizard.chooseSubtype,
  details: "Détails du signalement",
  done: "Merci !",
};

/** Index de l'entrée d'historique courante (react-router le stocke dans history.state.idx). */
function historyIndex(): number {
  if (typeof window === "undefined") return 0;
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : 0;
}

/** Brouillon initial : lien profond (query), sinon brouillon restauré (hors étape 1), sinon vierge. */
function initialDraft(step: WizardStep, params: URLSearchParams): WizardDraft {
  const subtypeParam = params.get("subtype");
  const hasSubtype = subtypeParam !== null && isSubtype(subtypeParam);
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasCoords = params.has("lat") && params.has("lng") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  let draft: WizardDraft | null = null;
  if (!hasSubtype && !hasCoords && step !== "category") draft = loadDraft();
  draft ??= createDraft(newClientId());
  if (hasSubtype) draft = applySubtype(draft, subtypeParam as ReportSubtype);
  if (hasCoords) draft = { ...draft, position: { lat, lng, accuracy: null, source: "map", adjusted: true } };
  return draft;
}

export default function ReportWizardPage() {
  const { step: rawStep } = useParams<{ step?: string }>();
  const step = parseStep(rawStep);
  if (!step) return <Navigate to="/report/category" replace />;
  return <ReportWizard step={step} />;
}

function ReportWizard({ step }: { step: WizardStep }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setView = useUiStore((s) => s.setView);
  const shortcuts = useFrequentSubtypes();
  const [draft, dispatch] = useReducer(draftReducer, undefined, () => initialDraft(step, searchParams));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [outcome, setOutcome] = useState<Extract<PublishOutcome, { kind: "published" }> | null>(null);
  const { publish, pending } = usePublishReport();
  const entryIdxRef = useRef(historyIndex());

  const setPosition = useCallback((position: DraftPosition) => dispatch({ type: "position", position }), []);
  // La géolocalisation démarre dès l'ouverture : la position est prête quand on arrive aux détails.
  const positionState = useReportPosition(draft.position, setPosition);

  // Brouillon persistant (sans photo) tant qu'on n'a pas publié.
  useEffect(() => {
    if (step === "done") return;
    saveDraft(draft);
  }, [draft, step]);

  // Après publication : le brouillon est purgé (le clientId ne doit pas être réutilisé).
  useEffect(() => {
    if (step !== "done") return;
    clearDraft();
    dispatch({ type: "reset", draft: createDraft(newClientId()) });
  }, [step]);

  // Cohérence étape / brouillon (rafraîchissement, lien direct, retour arrière).
  useEffect(() => {
    if (step === "subtype" && !draft.category) navigate("/report/category", { replace: true });
    else if (step === "details" && !draft.subtype) navigate(draft.category ? "/report/subtype" : "/report/category", { replace: true });
    else if (step === "done" && !outcome) navigate("/report/category", { replace: true });
  }, [step, draft.category, draft.subtype, outcome, navigate]);

  const go = useCallback((s: WizardStep, replace = false) => navigate(`/report/${s}`, { replace }), [navigate]);

  /** Ferme l'assistant et revient à l'écran d'origine (ou à la carte). */
  const close = useCallback(() => {
    clearDraft();
    const entry = entryIdxRef.current;
    const current = historyIndex();
    if (entry > 0 && current >= entry) navigate(-(current - entry + 1));
    else navigate("/map", { replace: true });
  }, [navigate]);
  useEscapeKey(!pending, close);

  const back = useCallback(() => {
    if (step === "details") go(draft.category ? "subtype" : "category");
    else if (step === "subtype") go("category");
  }, [step, draft.category, go]);

  const goToMap = useCallback(
    (state: MapNavigationState) => {
      if (state.focus) setView({ lat: state.focus.lat, lng: state.focus.lng, zoom: MAP_FOCUS_ZOOM });
      navigate("/map", { replace: true, state });
    },
    [navigate, setView],
  );

  const handlePublish = useCallback(async () => {
    const validation = validateDraft(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      toast.warning(Object.values(validation.errors)[0] ?? fr.errors.validation);
      return;
    }
    setErrors({});
    const { lat, lng } = validation.input;
    try {
      const result = await publish({ input: validation.input, photo: draft.photo });
      if (result.kind === "queued") {
        clearDraft();
        toast.info(TOAST_QUEUED);
        goToMap({ focus: { lat, lng }, queuedClientId: result.clientId });
        return;
      }
      setOutcome(result);
      setView({ lat: result.report.lat, lng: result.report.lng, zoom: MAP_FOCUS_ZOOM });
      toast.success(TOAST_PUBLISHED);
      go("done", true);
    } catch (e) {
      const failure = describePublishError(e);
      if (failure.kind === "auth") {
        // Le brouillon (sans photo) reste en sessionStorage : on revient aux détails après connexion.
        toast.warning(failure.title);
        navigate("/auth/login", { state: { from: "/report/details" } });
        return;
      }
      if (failure.errors) setErrors(failure.errors);
      const notify = failure.kind === "validation" || failure.kind === "rate_limited" || failure.kind === "network" ? toast.warning : toast.danger;
      notify({ title: failure.title, description: failure.description });
    }
  }, [draft, publish, goToMap, go, navigate, setView]);

  const positionOk = isPositionValid(draft.position);
  const subtitle =
    step === "subtype" && draft.category ? CATEGORY_BY_ID[draft.category].label : step === "details" && draft.subtype ? SUBTYPE_BY_ID[draft.subtype].label : undefined;

  let body: React.ReactNode = null;
  if (step === "category") {
    body = (
      <CategoryStep
        shortcuts={shortcuts}
        onPickCategory={(category) => {
          dispatch({ type: "category", category });
          go("subtype");
        }}
        onPickSubtype={(subtype) => {
          dispatch({ type: "subtype", subtype });
          go("details");
        }}
      />
    );
  } else if (step === "subtype" && draft.category) {
    body = (
      <SubtypeStep
        category={draft.category}
        selected={draft.subtype}
        onPick={(subtype) => {
          dispatch({ type: "subtype", subtype });
          go("details");
        }}
      />
    );
  } else if (step === "details" && draft.subtype) {
    body = (
      <DetailsStep
        draft={{ ...draft, subtype: draft.subtype }}
        dispatch={dispatch}
        errors={errors}
        positionStatus={positionState.status}
        positionMessage={positionState.message}
        fix={positionState.fix}
        onLocate={positionState.locate}
        onChangeSubtype={() => go("subtype")}
        disabled={pending}
      />
    );
  } else if (step === "done" && outcome) {
    body = (
      <DoneStep
        report={outcome.report}
        photoError={outcome.photoError}
        onSeeMap={() => goToMap({ focus: { lat: outcome.report.lat, lng: outcome.report.lng }, publishedReportId: outcome.report.id })}
        onNew={() => {
          setOutcome(null);
          setErrors({});
          go("category", true);
        }}
      />
    );
  }

  let footer: React.ReactNode = null;
  if (step === "details" && draft.subtype) {
    footer = (
      <>
        {!positionOk ? (
          <p className="text-center text-[14px] font-medium text-muted" aria-live="polite">
            {positionState.status === "locating" ? "Recherche de votre position…" : "Précisez la position sur la carte pour publier."}
          </p>
        ) : null}
        <Button size="xl" fullWidth leftIcon={<Send />} loading={pending} loadingLabel={fr.wizard.publishing} disabled={!positionOk} onClick={handlePublish}>
          {fr.wizard.publish}
        </Button>
      </>
    );
  } else if (step === "subtype") {
    footer = (
      <Button size="lg" variant="outline" fullWidth leftIcon={<ChevronLeft />} onClick={back}>
        {fr.common.back}
      </Button>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" data-wizard-step={step}>
      <TopBar
        variant="solid"
        title={TITLES[step]}
        subtitle={subtitle}
        leading={
          <IconButton aria-label={fr.common.close} size={44} variant="ghost" onClick={close} disabled={pending}>
            <X />
          </IconButton>
        }
        actions={
          step === "subtype" || step === "details" ? (
            <Button variant="ghost" size="md" leftIcon={<ChevronLeft />} onClick={back} disabled={pending}>
              {fr.common.back}
            </Button>
          ) : undefined
        }
      >
        {step !== "done" ? <StepIndicator current={step} className="py-1" /> : null}
      </TopBar>

      <main id="main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 pb-8 pt-4">{body}</div>
      </main>

      {footer ? (
        <footer className="glass-strong shrink-0 border-t border-line px-4 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">{footer}</div>
        </footer>
      ) : null}
    </div>
  );
}
