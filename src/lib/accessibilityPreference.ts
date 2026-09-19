export type AccessibilityPreference = "off" | "on";

const KEY = "nldc:a11y";
const NEXT: Record<AccessibilityPreference, AccessibilityPreference> = { off: "on", on: "off" };
const LABEL: Record<AccessibilityPreference, string> = { off: "Désactivé", on: "Activé" };

function isAccessibilityPreference(value: unknown): value is AccessibilityPreference {
  return value === "off" || value === "on";
}

export function getAccessibilityPreference(): AccessibilityPreference {
  try {
    const stored = localStorage.getItem(KEY);
    return isAccessibilityPreference(stored) ? stored : "off";
  } catch {
    return "off";
  }
}

// Un seul attribut sur <html> pilote tout : texte agrandi (cascade rem/em,
// voir style.css — icons.ts définit d'ailleurs les siennes en 1em), contraste
// renforcé (couleurs de texte/bordures) et transitions/animations coupées.
export function applyAccessibilityPreference(pref: AccessibilityPreference): void {
  if (pref === "off") document.documentElement.removeAttribute("data-a11y");
  else document.documentElement.setAttribute("data-a11y", pref);
}

export function setAccessibilityPreference(pref: AccessibilityPreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // storage unavailable, preference just won't persist across reloads
  }
  applyAccessibilityPreference(pref);
}

export function toggleAccessibilityPreference(): AccessibilityPreference {
  const next = NEXT[getAccessibilityPreference()];
  setAccessibilityPreference(next);
  return next;
}

export function accessibilityLabel(pref: AccessibilityPreference): string {
  return LABEL[pref];
}
