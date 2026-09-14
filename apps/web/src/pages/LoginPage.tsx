import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { fr, loginSchema } from "@mountain-live/core";
import { Button, Field, Input, LinkButton, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useSessionStore } from "@/store/session";
import { AuthLayout, DemoAccounts } from "@/features/account/AuthLayout";
import { authErrorMessage } from "@/features/account/authErrors";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/map";
  const setSession = useSessionStore((s) => s.setSession);
  const setOnboardingDone = useSessionStore((s) => s.setOnboardingDone);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});

  const login = useMutation({
    mutationFn: () => api.auth.login({ email: email.trim().toLowerCase(), password }),
    onSuccess: ({ token, user }) => {
      setSession(token, user);
      setOnboardingDone(true);
      toast.success(`Bienvenue, ${user.pseudo} !`);
      navigate(from, { replace: true });
    },
    onError: (e) => setErrors({ form: authErrorMessage(e) }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const i of parsed.error.issues) {
        if (i.path[0] === "email") next.email = fr.auth.errors.emailInvalid;
        if (i.path[0] === "password") next.password = "Saisissez votre mot de passe.";
      }
      setErrors(next);
      return;
    }
    setErrors({});
    login.mutate();
  };

  return (
    <AuthLayout
      title={fr.auth.loginTitle}
      footer={
        <>
          {fr.auth.noAccount}{" "}
          <Link to="/auth/register" state={{ from }} className="font-semibold text-primary underline-offset-2 hover:underline">
            {fr.auth.register}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={fr.auth.email} error={errors.email} required>
          <Input type="email" size="lg" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={fr.auth.password} error={errors.password} required>
          <Input type="password" size="lg" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {errors.form ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[14px] font-medium text-fg">
            {errors.form}
          </p>
        ) : null}
        <Button type="submit" size="xl" fullWidth leftIcon={<LogIn />} loading={login.isPending}>
          {fr.auth.login}
        </Button>
        <LinkButton to="/map" variant="ghost" size="lg" fullWidth onClick={() => setOnboardingDone(true)}>
          {fr.auth.continueAsGuest}
        </LinkButton>
        <p className="text-center text-[13px] text-muted">{fr.auth.guestHint}</p>
      </form>
      <DemoAccounts />
    </AuthLayout>
  );
}
