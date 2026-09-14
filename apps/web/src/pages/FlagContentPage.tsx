/**
 * Signalement d'un contenu problématique (section 17) : motif parmi six, précisions,
 * envoi à la modération.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, Send } from "lucide-react";
import { FLAG_REASONS, fr, type FlagReason } from "@mountain-live/core";
import { Button, Field, IconButton, Textarea, TopBar, toast, cn } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function FlagContentPage() {
  const { reportId = "" } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => api.flags.create({ reportId, reason: reason as FlagReason, details: details.trim() || null }),
    onSuccess: () => {
      toast.success(fr.moderation.sent);
      navigate(`/reports/${reportId}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) {
        toast.info(fr.errors.unauthorized);
        navigate("/auth/login", { state: { from: `/flag/${reportId}` } });
        return;
      }
      toast.danger(e instanceof ApiError ? e.message : fr.errors.network);
    },
  });

  const submit = () => {
    if (!reason) {
      setError("Choisissez un motif.");
      return;
    }
    setError(null);
    send.mutate();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TopBar
        variant="solid"
        title={fr.moderation.flagTitle}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <form
          className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-8 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[16px] font-bold text-fg">{fr.moderation.reasonLabel}</legend>
            {FLAG_REASONS.map((r) => {
              const selected = reason === r.id;
              return (
                <label
                  key={r.id}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 text-[16px] font-medium text-fg transition-colors",
                    selected ? "border-primary bg-primary-soft" : "border-line bg-surface",
                  )}
                >
                  <input type="radio" name="reason" value={r.id} checked={selected} onChange={() => setReason(r.id)} className="size-5 accent-[var(--primary)]" />
                  {fr.moderation.reasons[r.id]}
                </label>
              );
            })}
            {error ? (
              <p role="alert" className="text-[14px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </fieldset>
          <Field label={fr.moderation.detailsLabel}>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={600} placeholder="Décrivez le problème…" />
          </Field>
          <p className="text-[13px] text-muted">Votre signalement est transmis à l'équipe de modération. Les abus répétés peuvent entraîner une suspension.</p>
          <Button type="submit" size="xl" fullWidth leftIcon={<Send />} loading={send.isPending}>
            {fr.moderation.submit}
          </Button>
        </form>
      </main>
    </div>
  );
}
