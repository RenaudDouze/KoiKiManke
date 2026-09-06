// Confirmation "au même endroit" pour les actions destructrices : un premier
// clic arme le bouton (retour visuel + libellé changés), un second clic au
// même endroit confirme réellement l'action. Sans second clic dans le délai
// imparti, le bouton revient à son état normal — rien n'est fait. L'action
// confirmée reste par ailleurs annulable via le système d'undo existant
// (voir pushUndo dans list.ts) : ceci n'est qu'une étape avant l'envoi.
export interface ConfirmClickOptions {
  /** aria-label affiché une fois le bouton armé (boutons icône). */
  armedLabel?: string;
  /** Texte affiché une fois le bouton armé (boutons texte, ex: menu). */
  armedText?: string;
  timeoutMs?: number;
  /** Si vrai au moment du clic, ignore l'armement (l'action n'a rien à faire). */
  isDisabled?: () => boolean;
  onConfirm: () => void;
}

const DEFAULT_TIMEOUT_MS = 3000;

export function wireConfirmClick(el: HTMLElement, opts: ConfirmClickOptions): void {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const originalLabel = el.getAttribute("aria-label");
  const originalText = el.textContent;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    el.classList.remove("confirm-armed");
    if (originalLabel !== null) el.setAttribute("aria-label", originalLabel);
    if (opts.armedText !== undefined) el.textContent = originalText;
  };

  el.addEventListener("click", (e) => {
    const armed = el.classList.contains("confirm-armed");
    if (!armed && opts.isDisabled?.()) return;
    e.stopPropagation();
    if (armed) {
      disarm();
      opts.onConfirm();
      return;
    }
    el.classList.add("confirm-armed");
    if (opts.armedLabel) el.setAttribute("aria-label", opts.armedLabel);
    if (opts.armedText !== undefined) el.textContent = opts.armedText;
    timer = setTimeout(disarm, timeoutMs);
  });
}
