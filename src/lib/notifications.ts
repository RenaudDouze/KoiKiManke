// Préférence + permission pour les notifications système signalant qu'un
// autre appareil a ajouté un article. Contrairement aux autres modules de
// préférence de src/lib/ (theme.ts, accessibility.ts…), le réglage local ne
// suffit pas : la permission du navigateur (Notification.permission) prime
// toujours dessus — impossible de notifier sans elle, et impossible de la
// redemander tant qu'elle est explicitement refusée.

const STORAGE_KEY = "nldc:pref:notifications";

export type NotificationStatus = "unsupported" | "off" | "denied" | "on";

function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function getStoredPreference(): "on" | "off" {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}

function setStoredPreference(pref: "on" | "off"): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // localStorage indisponible (navigation privée stricte, quota) : le
    // réglage ne persiste pas mais l'app reste fonctionnelle.
  }
}

export function getNotificationStatus(): NotificationStatus {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && getStoredPreference() === "on") return "on";
  return "off";
}

export function notificationStatusLabel(status: NotificationStatus): string {
  switch (status) {
    case "on":
      return "Activées";
    case "denied":
      return "Bloquées (navigateur)";
    case "unsupported":
      return "Indisponibles";
    default:
      return "Désactivées";
  }
}

// Bascule on/off ; ne demande la permission navigateur qu'au passage à
// "on", jamais au chargement de la page (aucune demande de permission non
// sollicitée). Le statut retourné reflète le résultat réel, pas juste
// l'intention : "denied" si le navigateur refuse malgré tout.
export async function toggleNotifications(): Promise<NotificationStatus> {
  if (!isSupported()) return "unsupported";
  if (getNotificationStatus() === "on") {
    setStoredPreference("off");
    return getNotificationStatus();
  }
  if (Notification.permission === "denied") return "denied";
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return getNotificationStatus();
  setStoredPreference("on");
  return getNotificationStatus();
}

// Toujours notifiée, même onglet/appli au premier plan : l'utilisateur l'a
// explicitement demandé (l'article apparaît de toute façon déjà en direct
// dans la liste, mais la notification système reste voulue en plus).
export async function notifyItemAdded(itemName: string, quantity: string, listName: string): Promise<void> {
  if (getNotificationStatus() !== "on") return;
  const title = listName;
  const options = { body: quantity ? `${itemName} (${quantity})` : itemName, tag: "nldc-new-item" };
  try {
    // Une fois l'app installée (PWA) avec un service worker actif, Chrome
    // sur Android (et d'autres navigateurs mobiles) refuse le constructeur
    // Notification direct ("Illegal constructor: use
    // ServiceWorkerRegistration.showNotification() instead") — seule cette
    // API fonctionne alors de façon fiable. En dev (`vite dev`, y compris
    // sous Playwright), aucun service worker n'est enregistré
    // (devOptions.enabled par défaut à false dans vite.config.ts), donc ce
    // repli sur le constructeur direct reste la voie normale des tests e2e.
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch {
    // Permission révoquée entre-temps, contexte non sécurisé (http non
    // local)... ne doit jamais faire échouer la synchronisation temps réel.
  }
}
