import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ChevronLeft } from "lucide-react";
import { fr, type Notification } from "@mountain-live/core";
import { Button, CategoryIcon, EmptyState, IconButton, RelativeTime, SkeletonListItem, TopBar, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { NOTIFICATION_ICONS } from "@/features/notifications/icons";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.notifications, queryFn: api.notifications.list, refetchInterval: 60_000 });
  const read = useMutation({
    mutationFn: (id: string) => api.notifications.read(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
  const readAll = useMutation({
    mutationFn: () => api.notifications.readAll(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const open = (n: Notification) => {
    if (!n.readAt) read.mutate(n.id);
    if (n.reportId) navigate(`/reports/${n.reportId}`);
  };

  const items = query.data?.notifications ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.notifications.title}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}>
            <ChevronLeft />
          </IconButton>
        }
        actions={
          items.some((n) => !n.readAt) ? (
            <Button size="md" variant="ghost" leftIcon={<CheckCheck />} loading={readAll.isPending} onClick={() => readAll.mutate()}>
              {fr.notifications.markAllRead}
            </Button>
          ) : undefined
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-2">
          {query.isLoading ? (
            <div className="flex flex-col gap-2">
              <SkeletonListItem />
              <SkeletonListItem />
              <SkeletonListItem />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={<Bell />} title={fr.notifications.empty} description={fr.notifications.preferencesHint} action={<Button variant="outline" onClick={() => navigate("/profile/preferences")}>{fr.notifications.preferences}</Button>} />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn("flex w-full items-start gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40", !n.readAt && "bg-primary-soft/40 -mx-2 rounded-lg px-2")}
                    aria-label={`${n.title}${n.readAt ? "" : " (non lue)"}`}
                  >
                    <span className={cn("mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full", n.type === "official_alert" ? "bg-gold-soft text-gold" : "bg-primary-soft text-primary")} aria-hidden="true">
                      <CategoryIcon name={NOTIFICATION_ICONS[n.type]} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[15px] leading-snug text-fg", !n.readAt && "font-bold")}>{n.title}</span>
                      <span className="block text-[14px] text-muted">{n.body}</span>
                      <RelativeTime date={n.createdAt} className="text-[12px] text-muted" />
                    </span>
                    {!n.readAt ? <span className="mt-2 size-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
