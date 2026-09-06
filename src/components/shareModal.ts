import { renderQrSvg } from "./qr";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { appPath } from "../lib/basePath";

export function openShareModal(code: string, listName: string): void {
  const url = `${location.origin}${appPath(`/l/${code}`)}`;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal share-modal" role="dialog" aria-modal="true" tabindex="-1">
      <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
      <h2>Partager « ${escapeHtml(listName)} »</h2>
      <div class="share-code" title="Code de la liste">${escapeHtml(code)}</div>
      <div class="qr-wrap" id="qr-wrap" aria-label="QR code de partage"></div>
      <p class="share-link">${escapeHtml(url)}</p>
      <div class="share-actions">
        <button class="btn" id="copy-link">Copier le lien</button>
        <button class="btn" id="copy-code">Copier le code</button>
        ${"share" in navigator ? '<button class="btn primary" id="native-share">Partager…</button>' : ""}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  renderQrSvg(url).then((svg) => {
    const wrap = overlay.querySelector("#qr-wrap");
    if (wrap) wrap.innerHTML = svg;
  });

  const modal = overlay.querySelector(".modal") as HTMLElement;
  const releaseFocusTrap = trapFocus(modal);

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    releaseFocusTrap();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKeydown);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-close")?.addEventListener("click", close);

  overlay.querySelector("#copy-link")?.addEventListener("click", async () => {
    await copyText(url);
    flash(overlay, "#copy-link", "Copié !");
  });
  overlay.querySelector("#copy-code")?.addEventListener("click", async () => {
    await copyText(code);
    flash(overlay, "#copy-code", "Copié !");
  });
  overlay.querySelector("#native-share")?.addEventListener("click", async () => {
    try {
      await navigator.share({ title: listName, url });
    } catch {
      // user cancelled the share sheet, ignore
    }
  });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard API unavailable (older browser / no https), silently ignore
  }
}

function flash(root: HTMLElement, selector: string, text: string): void {
  const el = root.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  const original = el.textContent;
  el.textContent = text;
  setTimeout(() => {
    el.textContent = original;
  }, 1200);
}
