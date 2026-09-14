/**
 * Guidage vocal : synthèse vocale du navigateur en français. Les messages
 * importants (alertes, manœuvres imminentes) interrompent le message en cours.
 */
let voice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (voice !== undefined) return voice;
  if (typeof speechSynthesis === "undefined") return (voice = null);
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang.toLowerCase().startsWith("fr") && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith("fr")) ?? null;
  return voice;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function speak(text: string, opts: { priority?: "high" | "normal" } = {}): void {
  if (!speechSupported()) return;
  try {
    if (opts.priority === "high" || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {
    /* synthèse indisponible */
  }
}

export function stopSpeaking(): void {
  if (speechSupported()) {
    try {
      speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
