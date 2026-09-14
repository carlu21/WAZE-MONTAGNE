import { useNavigate } from "react-router";
import { MapPinOff } from "lucide-react";
import { fr } from "@mountain-live/core";
import { Button, EmptyState } from "@/components/ui";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <EmptyState icon={<MapPinOff />} title="Page introuvable" description="Le chemin que vous cherchez n'existe pas… ou plus." action={<Button size="lg" onClick={() => navigate("/map", { replace: true })}>{fr.common.seeOnMap}</Button>} />
    </div>
  );
}
