/**
 * speech.ts — Síntesis de voz (Web Speech API)
 * Anuncia eventos importantes del POS en voz alta.
 */

/**
 * Emite texto en voz alta usando la Web Speech API nativa del navegador.
 * Si el navegador no soporta la API, la llamada se ignora silenciosamente.
 *
 * @param text  Texto a leer
 * @param lang  Idioma (por defecto español de Honduras)
 */
export function speak(text: string, lang = "es-HN"): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // cancelar locución anterior si existe
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.92;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}
