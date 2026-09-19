import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { appPath } from "../lib/basePath";
import { PRIVACY_HINT } from "../lib/privacyHint";
import { buildImportUrl, encodeListToParam } from "../lib/compactShare";
import type { ImportPayload } from "../lib/importExport";

export interface ShareModalActions {
  onExport: () => void;
  onImportFile: (file: File) => void;
}

export function openShareModal(code: string, listName: string, exportPayload: ImportPayload, actions: ShareModalActions): void {
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
      <div class="share-actions share-io-actions">
        <button class="btn" id="share-export"><span class="menu-item-icon">${icons.download}</span>Exporter (JSON)</button>
        <button class="btn" id="share-import"><span class="menu-item-icon">${icons.upload}</span>Importer…</button>
      </div>
      <input type="file" id="share-import-file" accept="application/json" hidden />
      <div class="share-actions share-io-actions">
        <button class="btn" id="toggle-compact-share" aria-expanded="false">Lien/QR compact (aperçu, sans code)…</button>
      </div>
      <div class="compact-share" id="compact-share" hidden>
        <p class="add-form-hint">
          Un instantané figé du contenu actuel : l'ouvrir ne rejoint pas cette liste en direct, il propose de
          l'importer (fusion ou remplacement) dans une liste, comme un fichier JSON.
        </p>
        <div class="qr-wrap" id="compact-qr-wrap" aria-label="QR code de l'aperçu compact"></div>
        <p class="share-link" id="compact-link"></p>
        <div class="share-actions">
          <button class="btn" id="copy-compact-link">Copier le lien compact</button>
        </div>
      </div>
      <p class="add-form-hint">${PRIVACY_HINT}</p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Chargé à la demande (un seul point d'appel, réutilisé pour le second QR
  // compact plus bas) : la lib qrcode ne sert qu'à l'ouverture de ce modal,
  // inutile de l'embarquer dans le chunk principal pour tout le monde.
  function renderQrInto(selector: string, text: string): void {
    import("./qr").then(({ renderQrSvg }) => renderQrSvg(text)).then((svg) => {
      // Toujours appelée avec un sélecteur du gabarit statique ci-dessus :
      // toujours trouvé, que la modale soit encore affichée ou déjà détachée
      // du document (le sous-arbre de overlay reste interrogeable dans les
      // deux cas).
      (overlay.querySelector(selector) as HTMLElement).innerHTML = svg;
    });
  }
  renderQrInto("#qr-wrap", url);

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

  overlay.querySelector("#share-export")?.addEventListener("click", () => {
    close();
    actions.onExport();
  });
  const importFileInput = overlay.querySelector("#share-import-file") as HTMLInputElement;
  overlay.querySelector("#share-import")?.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files?.[0];
    importFileInput.value = "";
    if (!file) return;
    close();
    actions.onImportFile(file);
  });

  // Généré à la demande (bascule d'affichage) plutôt qu'à l'ouverture de la
  // modale : évite de compresser + générer un second QR pour rien tant que
  // l'utilisateur n'a pas explicitement demandé ce lien-là. Mémorisé une fois
  // calculé pour qu'un second clic sur la bascule ne le recalcule pas.
  let compactUrl: string | null = null;
  const compactSection = overlay.querySelector("#compact-share") as HTMLElement;
  const toggleCompactBtn = overlay.querySelector("#toggle-compact-share") as HTMLButtonElement;
  toggleCompactBtn.addEventListener("click", () => {
    compactSection.hidden = !compactSection.hidden;
    toggleCompactBtn.setAttribute("aria-expanded", String(!compactSection.hidden));
    if (compactSection.hidden || compactUrl !== null) return;
    // Toujours vers la racine de l'app (pas `/l/CODE`) : ouvrir ce lien ne
    // rejoint aucune liste en direct, contrairement à `url` ci-dessus (voir
    // src/lib/compactShare.ts).
    compactUrl = buildImportUrl(`${location.origin}${appPath("/")}`, encodeListToParam(exportPayload));
    (overlay.querySelector("#compact-link") as HTMLElement).textContent = compactUrl;
    renderQrInto("#compact-qr-wrap", compactUrl);
  });
  overlay.querySelector("#copy-compact-link")?.addEventListener("click", async () => {
    if (!compactUrl) return;
    await copyText(compactUrl);
    flash(overlay, "#copy-compact-link", "Copié !");
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
  // Toujours appelée avec "#copy-link"/"#copy-code", tous deux dans le
  // gabarit statique : selector est donc toujours trouvé.
  const el = root.querySelector(selector) as HTMLElement;
  const original = el.textContent;
  el.textContent = text;
  setTimeout(() => {
    el.textContent = original;
  }, 1200);
}
