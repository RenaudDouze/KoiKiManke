export type TextSizePreference = "normal" | "large";

const KEY = "nldc:textSize";
const NEXT: Record<TextSizePreference, TextSizePreference> = { normal: "large", large: "normal" };
const LABEL: Record<TextSizePreference, string> = { normal: "Normal", large: "Grand" };

function isTextSizePreference(value: unknown): value is TextSizePreference {
  return value === "normal" || value === "large";
}

export function getTextSizePreference(): TextSizePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return isTextSizePreference(stored) ? stored : "normal";
  } catch {
    return "normal";
  }
}

// Un seul attribut sur <html> pilote tout : la quasi-totalité de style.css
// est déjà exprimée en rem/em (voir icons.ts pour les icônes en 1em), donc
// grossir la taille de police racine fait grossir en cascade textes, icônes,
// paddings et gaps sans avoir à toucher chaque règle individuellement.
export function applyTextSize(pref: TextSizePreference): void {
  if (pref === "normal") document.documentElement.removeAttribute("data-text-size");
  else document.documentElement.setAttribute("data-text-size", pref);
}

export function setTextSizePreference(pref: TextSizePreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // storage unavailable, preference just won't persist across reloads
  }
  applyTextSize(pref);
}

export function cycleTextSizePreference(): TextSizePreference {
  const next = NEXT[getTextSizePreference()];
  setTextSizePreference(next);
  return next;
}

export function textSizeLabel(pref: TextSizePreference): string {
  return LABEL[pref];
}
