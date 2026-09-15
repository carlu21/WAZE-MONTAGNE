/**
 * Onboarding très court (section 21) : trois écrans, choix des pratiques,
 * autorisation de localisation expliquée, puis compte ou consultation libre.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronRight, LocateFixed } from "lucide-react";
import { PRACTICES, fr, type Practice } from "@mountain-live/core";
import { Button, CategoryIcon, Chip, LinkButton, cn } from "@/components/ui";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { MountainArt } from "@/features/account/MountainArt";
import { ONBOARDING_PRACTICES, filtersForPractices, loadPractices, savePractices } from "@/features/account/practices";

type Step = 0 | 1 | 2 | 3 | 4 | 5;

const SLIDES: { text: string; art: "ridge" | "contours" | "signal" }[] = [
  { text: fr.onboarding.slide1, art: "ridge" },
  { text: fr.onboarding.slide2, art: "contours" },
  { text: fr.onboarding.slide3, art: "signal" },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const setOnboardingDone = useSessionStore((s) => s.setOnboardingDone);
  const setFilters = useUiStore((s) => s.setFilters);
  const setPosition = useUiStore((s) => s.setPosition);
  const [step, setStep] = useState<Step>(0);
  const [practices, setPractices] = useState<Practice[]>(() => loadPractices());
  const [locating, setLocating] = useState(false);
  const [locationMsg, setLocationMsg] = useState<string | null>(null);

  const finishPractices = () => {
    savePractices(practices);
    setFilters(filtersForPractices(practices));
    setStep(4);
  };

  const askLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationMsg(fr.errors.locationUnavailable);
      setStep(5);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() });
        setLocating(false);
        setStep(5);
      },
      (err) => {
        setLocating(false);
        setLocationMsg(err.code === err.PERMISSION_DENIED ? fr.errors.locationDenied : fr.errors.locationUnavailable);
        setStep(5);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const done = (to: string) => {
    setOnboardingDone(true);
    navigate(to, { replace: true });
  };

  const togglePractice = (p: Practice) => setPractices((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>
      <header className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-bold text-primary">{fr.appName}</span>
        {step < 3 ? (
          <button type="button" className="min-h-12 px-2 text-[15px] font-semibold text-muted" onClick={() => setStep(3)}>
            {fr.onboarding.skip}
          </button>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
        {step <= 2 ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-8 text-center" aria-live="polite">
            <MountainArt variant={SLIDES[step].art} className="w-full max-w-sm" />
            <h1 className="max-w-md text-[28px] font-extrabold leading-tight text-fg">{SLIDES[step].text}</h1>
            <div className="flex gap-2" aria-hidden="true">
              {SLIDES.map((_, i) => (
                <span key={i} className={cn("h-2 rounded-full transition-all", i === step ? "w-8 bg-primary" : "w-2 bg-line-strong")} />
              ))}
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="flex flex-1 flex-col gap-4 py-4">
            <h1 className="text-[26px] font-extrabold leading-tight text-fg">{fr.onboarding.practicesTitle}</h1>
            <p className="text-[15px] text-muted">{fr.onboarding.practicesHint}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={fr.onboarding.practicesTitle}>
              {ONBOARDING_PRACTICES.map((id) => {
                const def = PRACTICES.find((p) => p.id === id)!;
                return (
                  <Chip key={id} size="lg" selected={practices.includes(id)} icon={<CategoryIcon name={def.icon} />} onClick={() => togglePractice(id)}>
                    {def.label}
                  </Chip>
                );
              })}
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="flex flex-1 flex-col gap-4 py-4">
            <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <LocateFixed className="size-8" aria-hidden="true" />
            </span>
            <h1 className="text-[26px] font-extrabold leading-tight text-fg">{fr.onboarding.locationTitle}</h1>
            <p className="text-[16px] leading-relaxed text-fg">{fr.onboarding.locationBody}</p>
            <ul className="list-disc space-y-1 pl-5 text-[15px] text-muted">
              <li>Voir immédiatement ce qui se passe autour de vous.</li>
              <li>Recevoir une alerte à l'approche d'une battue, d'un troupeau ou d'un danger.</li>
              <li>Placer vos signalements au bon endroit, sans saisie.</li>
            </ul>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="flex flex-1 flex-col gap-4 py-4">
            <h1 className="text-[26px] font-extrabold leading-tight text-fg">Vous êtes prêt·e</h1>
            {locationMsg ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-[14px] text-fg">{locationMsg}</p> : null}
            <p className="text-[16px] text-fg">
              Un compte est nécessaire pour signaler et confirmer. La consultation de la carte est libre.
            </p>
            <p className="text-[14px] text-muted">
              En créant un compte, vous acceptez la <Link to="/legal" className="font-semibold text-primary underline-offset-2 hover:underline">politique de confidentialité et les règles de sécurité</Link>.
            </p>
          </section>
        ) : null}
      </main>

      <footer className="flex flex-col gap-2 px-6 pb-4 pt-2">
        {step <= 2 ? (
          <Button size="xl" fullWidth rightIcon={<ChevronRight />} onClick={() => setStep((step + 1) as Step)}>
            {step === 2 ? fr.onboarding.start : fr.common.next}
          </Button>
        ) : null}
        {step === 3 ? (
          <Button size="xl" fullWidth onClick={finishPractices} disabled={practices.length === 0}>
            {fr.common.continue}
          </Button>
        ) : null}
        {step === 4 ? (
          <>
            <Button size="xl" fullWidth leftIcon={<LocateFixed />} loading={locating} onClick={askLocation}>
              {fr.onboarding.locationAllow}
            </Button>
            <Button size="lg" variant="ghost" fullWidth onClick={() => setStep(5)}>
              {fr.onboarding.locationLater}
            </Button>
          </>
        ) : null}
        {step === 5 ? (
          <>
            <LinkButton to="/auth/register" size="xl" fullWidth onClick={() => setOnboardingDone(true)}>
              {fr.auth.registerTitle}
            </LinkButton>
            <LinkButton to="/auth/login" size="lg" variant="outline" fullWidth onClick={() => setOnboardingDone(true)}>
              {fr.auth.login}
            </LinkButton>
            <Button size="lg" variant="ghost" fullWidth onClick={() => done("/home")}>
              {fr.auth.continueAsGuest}
            </Button>
          </>
        ) : null}
      </footer>
    </div>
  );
}
