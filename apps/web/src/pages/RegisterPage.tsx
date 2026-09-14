import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { PRACTICES, fr, registerSchema, type Practice } from "@mountain-live/core";
import { Button, CategoryIcon, Chip, Field, Input, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { clearSessionCaches, useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { AuthLayout } from "@/features/account/AuthLayout";
import { authErrorMessage } from "@/features/account/authErrors";
import { filtersForPractices, loadPractices, savePractices } from "@/features/account/practices";

type Errors = Partial<Record<"email" | "password" | "pseudo" | "consent" | "form", string>>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/map";
  const setSession = useSessionStore((s) => s.setSession);
  const setOnboardingDone = useSessionStore((s) => s.setOnboardingDone);
  const setFilters = useUiStore((s) => s.setFilters);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [region, setRegion] = useState("");
  const [practices, setPractices] = useState<Practice[]>(() => loadPractices());
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const register = useMutation({
    mutationFn: (input: Parameters<typeof api.auth.register>[0]) => api.auth.register(input),
    onSuccess: ({ token, user }) => {
      void clearSessionCaches();
      setSession(token, user);
      setOnboardingDone(true);
      savePractices(user.practices);
      if (user.preferences.filters.length) setFilters(user.preferences.filters);
      else setFilters(filtersForPractices(user.practices));
      toast.success(`Bienvenue, ${user.pseudo} ! Votre compte est créé.`);
      navigate(from, { replace: true });
    },
    onError: (e) => setErrors({ form: authErrorMessage(e) }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse({
      email: email.trim(),
      password,
      pseudo: pseudo.trim(),
      practices,
      region: region.trim() || undefined,
      consent: consent ? true : undefined,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const i of parsed.error.issues) {
        const k = i.path[0];
        if (k === "email") next.email = fr.auth.errors.emailInvalid;
        else if (k === "password") next.password = fr.auth.errors.passwordTooShort;
        else if (k === "pseudo") next.pseudo = fr.auth.errors.pseudoInvalid;
        else if (k === "consent") next.consent = fr.auth.errors.consentRequired;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    register.mutate(parsed.data);
  };

  return (
    <AuthLayout
      title={fr.auth.registerTitle}
      footer={
        <>
          {fr.auth.hasAccount}{" "}
          <Link to="/auth/login" state={{ from }} className="font-semibold text-primary underline-offset-2 hover:underline">
            {fr.auth.login}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={fr.auth.pseudo} hint={fr.auth.pseudoHint} error={errors.pseudo} required>
          <Input size="lg" autoComplete="nickname" maxLength={32} value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
        </Field>
        <Field label={fr.auth.email} error={errors.email} required>
          <Input type="email" size="lg" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={fr.auth.password} hint={fr.auth.passwordHint} error={errors.password} required>
          <Input type="password" size="lg" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-2 text-[15px] font-semibold text-fg">{fr.profilePage.practices}</legend>
          <div className="flex flex-wrap gap-2">
            {PRACTICES.map((p) => (
              <Chip key={p.id} selected={practices.includes(p.id)} icon={<CategoryIcon name={p.icon} />} onClick={() => setPractices((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}>
                {p.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field label={fr.auth.region}>
          <Input size="lg" maxLength={80} placeholder="Ex. Corse, Haute-Corse…" value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <label className="flex min-h-12 items-start gap-3 text-[15px] text-fg">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--primary)]" aria-invalid={Boolean(errors.consent)} />
          <span>
            {fr.auth.consent}{" "}
            <Link to="/legal" className="font-semibold text-primary underline-offset-2 hover:underline">
              Lire la politique
            </Link>
          </span>
        </label>
        {errors.consent ? (
          <p role="alert" className="-mt-2 text-[14px] font-medium text-danger">
            {errors.consent}
          </p>
        ) : null}
        {errors.form ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[14px] font-medium text-fg">
            {errors.form}
          </p>
        ) : null}
        <Button type="submit" size="xl" fullWidth leftIcon={<UserPlus />} loading={register.isPending}>
          {fr.auth.register}
        </Button>
      </form>
    </AuthLayout>
  );
}
