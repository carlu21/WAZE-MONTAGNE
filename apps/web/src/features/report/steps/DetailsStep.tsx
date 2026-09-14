/**
 * Étape 3 — détails du signalement, une seule vue défilante :
 * position (mini-carte), photo, niveau de danger, validité (heure de fin ou
 * durée), commentaire. Le bouton « Publier » est rendu par la page, collé en bas.
 */
import type { Dispatch, ReactNode } from "react";
import { Clock, LocateFixed, MapPin, OctagonAlert, Pencil, TriangleAlert, WifiOff } from "lucide-react";
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, fr, type ReportSubtype } from "@mountain-live/core";
import { Banner, Button, CategoryIcon, Chip, Field, Input, Textarea, cn } from "@/components/ui";
import { useUiStore } from "@/store/ui";
import { LocationPicker } from "../LocationPicker";
import { PhotoField } from "../PhotoField";
import type { GpsFix, PositionStatus } from "../useReportPosition";
import {
  DANGER_LEVEL_OPTIONS,
  DESCRIPTION_MAX,
  defaultTtlMinutes,
  expiryText,
  fromLocalInputValue,
  isPositionValid,
  toLocalInputValue,
  ttlChoices,
  type DraftAction,
  type DraftErrors,
  type WizardDraft,
} from "../wizardState";

export interface DetailsStepProps {
  draft: WizardDraft & { subtype: ReportSubtype };
  dispatch: Dispatch<DraftAction>;
  errors: DraftErrors;
  positionStatus: PositionStatus;
  positionMessage: string;
  fix: GpsFix | null;
  onLocate: () => void;
  onChangeSubtype: () => void;
  disabled?: boolean;
}

function Section({ id, title, optional, children, error }: { id: string; title: string; optional?: boolean; children: ReactNode; error?: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h3 id={`${id}-title`} className="text-[17px] font-bold leading-tight text-fg">
        {title}
        {optional ? <span className="ml-1.5 text-[14px] font-normal text-muted">({fr.common.optional})</span> : null}
      </h3>
      {children}
      {error ? (
        <p role="alert" className="text-[15px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Raccourcis d'heure de fin : heures pour les activités courtes, jours pour fermetures et travaux. */
export function endTimePresets(subtype: ReportSubtype): { label: string; minutes: number }[] {
  const def = SUBTYPE_BY_ID[subtype];
  return def.defaultTtlMin < 24 * 60
    ? [
        { label: "+2 h", minutes: 120 },
        { label: "+6 h", minutes: 360 },
        { label: "+1 j", minutes: 24 * 60 },
      ]
    : [
        { label: "+1 j", minutes: 24 * 60 },
        { label: "+7 j", minutes: 7 * 24 * 60 },
        { label: "+30 j", minutes: 30 * 24 * 60 },
      ];
}

export function DetailsStep({ draft, dispatch, errors, positionStatus, positionMessage, fix, onLocate, onChangeSubtype, disabled = false }: DetailsStepProps) {
  const def = SUBTYPE_BY_ID[draft.subtype];
  const cat = CATEGORY_BY_ID[def.category];
  const online = useUiStore((s) => s.online);
  const now = new Date();
  const positionOk = isPositionValid(draft.position);
  const positionTone = positionStatus === "locating" ? "text-muted" : positionOk ? "text-success" : "text-warning";
  const PositionIcon = positionStatus === "locating" ? LocateFixed : positionOk ? MapPin : TriangleAlert;
  const ttl = draft.ttlMinutes ?? defaultTtlMinutes(draft.subtype);
  const endsAt = fromLocalInputValue(draft.endsAtLocal);

  return (
    <div className="flex flex-col gap-7">
      {/* Récapitulatif du type choisi */}
      <div className="flex items-center gap-3 rounded-2xl border-2 border-line bg-surface p-3" style={{ borderColor: `var(${cat.colorVar})` }}>
        <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: `var(${cat.colorVar})` }} aria-hidden="true">
          <CategoryIcon name={def.icon} size={30} strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[20px] font-bold leading-tight text-fg">{def.label}</h2>
          <p className="truncate text-[14px] text-muted">{cat.label}</p>
        </div>
        <Button variant="ghost" size="md" leftIcon={<Pencil />} onClick={onChangeSubtype} disabled={disabled} aria-label="Modifier le type de signalement">
          Modifier
        </Button>
      </div>

      {!online ? (
        <Banner tone="info" compact icon={<WifiOff />}>
          {fr.offline.mode} : le signalement sera envoyé dès le retour du réseau.
        </Banner>
      ) : null}

      {/* Position */}
      <Section id="wizard-position" title={fr.wizard.position} error={errors.position}>
        <p className={cn("flex items-center gap-2 text-[15px] font-semibold", positionTone)} aria-live="polite">
          <PositionIcon className={cn("size-5 shrink-0", positionStatus === "locating" && "animate-pulse")} aria-hidden="true" />
          <span>{positionMessage}</span>
        </p>
        <LocationPicker
          position={draft.position}
          fix={fix}
          subtype={draft.subtype}
          onChange={(position) => dispatch({ type: "position", position })}
          onRecenter={onLocate}
          locating={positionStatus === "locating"}
        />
        <p className="text-[15px] leading-snug text-muted">{fr.wizard.positionHint}</p>
      </Section>

      {/* Photo */}
      <Section id="wizard-photo" title={fr.wizard.photo} optional>
        <PhotoField photo={draft.photo} onChange={(photo) => dispatch({ type: "photo", photo })} disabled={disabled} />
      </Section>

      {/* Niveau de danger */}
      {def.askDangerLevel ? (
        <Section id="wizard-danger" title={fr.wizard.dangerLevel} error={errors.dangerLevel}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={fr.wizard.dangerLevel}>
            {DANGER_LEVEL_OPTIONS.map((level) => (
              <Chip
                key={level.id}
                size="lg"
                color={level.color}
                selected={draft.dangerLevel === level.id}
                icon={level.id === "critical" ? <OctagonAlert className="size-5" /> : level.id === "high" ? <TriangleAlert className="size-5" /> : undefined}
                onClick={() => dispatch({ type: "dangerLevel", dangerLevel: level.id })}
                disabled={disabled}
              >
                {level.label}
              </Chip>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Validité */}
      {def.askEndTime ? (
        <Section id="wizard-end" title={fr.wizard.endTime}>
          <Field hint={fr.wizard.endTimeHint} error={errors.endsAt}>
            <Input
              type="datetime-local"
              size="lg"
              leftIcon={<Clock />}
              value={draft.endsAtLocal ?? ""}
              min={toLocalInputValue(now)}
              onChange={(e) => dispatch({ type: "endsAt", endsAtLocal: e.target.value })}
              disabled={disabled}
              aria-label={fr.wizard.endTime}
            />
          </Field>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Raccourcis d'heure de fin">
            {endTimePresets(draft.subtype).map((p) => {
              const target = new Date(Date.now() + p.minutes * 60_000);
              const selected = endsAt !== null && Math.abs(endsAt.getTime() - target.getTime()) < 60_000;
              return (
                <Chip key={p.label} selected={selected} onClick={() => dispatch({ type: "endsAt", endsAtLocal: toLocalInputValue(target) })} disabled={disabled}>
                  {p.label}
                </Chip>
              );
            })}
          </div>
        </Section>
      ) : (
        <Section id="wizard-ttl" title={fr.wizard.duration} error={errors.ttlMinutes}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={fr.wizard.duration}>
            {ttlChoices(draft.subtype).map((o) => (
              <Chip key={o.minutes} size="lg" selected={ttl === o.minutes} onClick={() => dispatch({ type: "ttl", ttlMinutes: o.minutes })} disabled={disabled}>
                {o.label}
              </Chip>
            ))}
          </div>
          <p className="text-[15px] leading-snug text-muted" aria-live="polite">
            {expiryText(ttl)}
          </p>
        </Section>
      )}

      {def.sensitive ? (
        <Banner tone="info" title="Position floutée">
          {fr.wizard.sensitiveNotice} La position exacte n'est jamais publiée, pour protéger l'espèce.
        </Banner>
      ) : null}

      {/* Commentaire */}
      <Section id="wizard-description" title={fr.wizard.description} optional>
        <Field error={errors.description}>
          <Textarea
            value={draft.description}
            onChange={(e) => dispatch({ type: "description", description: e.target.value })}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder={fr.wizard.descriptionPlaceholder}
            disabled={disabled}
            aria-label={fr.wizard.description}
            enterKeyHint="done"
          />
        </Field>
      </Section>
    </div>
  );
}
