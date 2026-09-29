"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The slice of the Web Speech API this button uses (TypeScript's DOM types don't include it). */
interface SpeechResultList {
  length: number;
  [index: number]: { isFinal: boolean; [alternative: number]: { transcript: string } };
}
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognizerClass = new () => Recognizer;

/** Chrome, Edge and Safari have speech recognition (Chrome and Safari prefixed); Firefox doesn't. */
function recognizerClass(): RecognizerClass | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// Support never changes while the page is open; the server snapshot keeps the button out of the HTML.
const subscribeNever = () => () => {};
const useSpeechSupported = () =>
  useSyncExternalStore(
    subscribeNever,
    () => Boolean(recognizerClass()),
    () => false,
  );

const NO_MIC = "Microphone access is off. Allow it in your browser's site settings, or type instead.";
const ERRORS: Record<string, string> = {
  "not-allowed": NO_MIC,
  "service-not-allowed": NO_MIC,
  "audio-capture": "No microphone was found. Connect one, or type instead.",
  network: "Speech needs an internet connection. Try again, or type instead.",
  "no-speech": "Didn't hear anything. Press Speak and try again.",
};
const UNKNOWN_ERROR = "Speech stopped unexpectedly. Try again, or type instead.";

/**
 * Speak the request instead of typing it. Words still being recognised go to `onInterim` (shown
 * greyed); each finished phrase goes to `onFinal`. Escape or a second press stops listening.
 * Hidden where the browser can't recognise speech.
 */
export function VoiceButton({ onInterim, onFinal }: { onInterim: (text: string) => void; onFinal: (text: string) => void }) {
  const supported = useSpeechSupported();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognizer = useRef<Recognizer | null>(null);

  const stop = () => recognizer.current?.stop();

  const start = () => {
    const Recognition = recognizerClass();
    if (!Recognition) return;
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language;
    r.onresult = ({ resultIndex, results }) => {
      let interim = "";
      for (let i = resultIndex; i < results.length; i++) {
        const result = results[i]!;
        const text = result[0]?.transcript.trim() ?? "";
        if (!result.isFinal) interim += `${text} `;
        else if (text) onFinal(text);
      }
      onInterim(interim.trim());
    };
    r.onerror = ({ error: code }) => {
      if (code !== "aborted") setError(ERRORS[code] ?? UNKNOWN_ERROR);
    };
    r.onend = () => {
      recognizer.current = null;
      setListening(false);
      onInterim("");
    };
    try {
      r.start();
    } catch {
      return setError(UNKNOWN_ERROR);
    }
    recognizer.current = r;
    setError(null);
    setListening(true);
  };

  // Escape stops listening wherever focus is, since people usually watch the text box, not the button.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") recognizer.current?.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening]);

  // Leaving the page turns the microphone off without calling back into an unmounted composer.
  useEffect(
    () => () => {
      const r = recognizer.current;
      if (!r) return;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.abort();
    },
    [],
  );

  if (!supported) return null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className="relative inline-flex">
        {listening && <span aria-hidden className="absolute inset-0 rounded-full bg-ink/25 motion-safe:animate-ping" />}
        <Tooltip content="Your browser turns your speech into text. Chrome does this by sending the audio to Google.">
          <button
            type="button"
            aria-pressed={listening}
            onClick={listening ? stop : start}
            className={cn(
              "relative inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-small transition-colors",
              listening ? "bg-ink text-sheet" : "text-graphite hover:bg-ink/6 hover:text-ink",
            )}
          >
            <Mic className="size-4" aria-hidden /> Speak
          </button>
        </Tooltip>
      </span>
      {listening && <p className="text-micro text-pencil">Listening. Press Esc to stop.</p>}
      {error && (
        <p role="alert" className="max-w-64 text-right text-micro text-brick">
          {error}
        </p>
      )}
    </div>
  );
}
