// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNotificationStatus, notificationStatusLabel, notifyItemAdded, toggleNotifications } from "./notifications";

interface CapturedNotification {
  title: string;
  options?: { body?: string; tag?: string };
}

function stubNotification(permission: "default" | "granted" | "denied", requestPermissionResult: "default" | "granted" | "denied" = permission) {
  const instances: CapturedNotification[] = [];
  class FakeNotification {
    static permission = permission;
    // Reflète le vrai comportement du navigateur : une fois la permission
    // accordée/refusée, Notification.permission lui-même change, pas
    // seulement la valeur résolue par la promesse.
    static requestPermission = vi.fn().mockImplementation(async () => {
      FakeNotification.permission = requestPermissionResult;
      return requestPermissionResult;
    });
    constructor(title: string, options?: { body?: string; tag?: string }) {
      instances.push({ title, options });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { FakeNotification, instances };
}

describe("notifications", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getNotificationStatus", () => {
    it("\"unsupported\" si l'API Notification n'existe pas (jsdom ne l'implémente pas)", () => {
      expect(getNotificationStatus()).toBe("unsupported");
    });

    it("\"denied\" si la permission navigateur est refusée", () => {
      stubNotification("denied");
      expect(getNotificationStatus()).toBe("denied");
    });

    it("\"off\" si la permission est accordée mais la préférence locale désactivée", () => {
      stubNotification("granted");
      expect(getNotificationStatus()).toBe("off");
    });

    it("\"off\" si la préférence est activée mais la permission pas encore accordée", () => {
      stubNotification("default");
      localStorage.setItem("nldc:pref:notifications", "on");
      expect(getNotificationStatus()).toBe("off");
    });

    it("\"on\" si permission accordée et préférence activée", () => {
      stubNotification("granted");
      localStorage.setItem("nldc:pref:notifications", "on");
      expect(getNotificationStatus()).toBe("on");
    });

    it("\"off\" si localStorage lève (préférence illisible)", () => {
      stubNotification("granted");
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      expect(getNotificationStatus()).toBe("off");
      spy.mockRestore();
    });
  });

  describe("notificationStatusLabel", () => {
    it("traduit chaque statut en libellé affiché", () => {
      expect(notificationStatusLabel("on")).toBe("Activées");
      expect(notificationStatusLabel("denied")).toBe("Bloquées (navigateur)");
      expect(notificationStatusLabel("unsupported")).toBe("Indisponibles");
      expect(notificationStatusLabel("off")).toBe("Désactivées");
    });
  });

  describe("toggleNotifications", () => {
    it("renvoie \"unsupported\" si l'API n'existe pas, sans rien persister", async () => {
      await expect(toggleNotifications()).resolves.toBe("unsupported");
      expect(localStorage.getItem("nldc:pref:notifications")).toBeNull();
    });

    it("désactive directement si déjà \"on\", sans redemander la permission", async () => {
      const { FakeNotification } = stubNotification("granted");
      localStorage.setItem("nldc:pref:notifications", "on");
      await expect(toggleNotifications()).resolves.toBe("off");
      expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    });

    it("renvoie \"denied\" sans redemander si la permission est déjà refusée", async () => {
      const { FakeNotification } = stubNotification("denied");
      await expect(toggleNotifications()).resolves.toBe("denied");
      expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    });

    it("active directement si la permission est déjà accordée, sans la redemander", async () => {
      const { FakeNotification } = stubNotification("granted");
      await expect(toggleNotifications()).resolves.toBe("on");
      expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
      expect(localStorage.getItem("nldc:pref:notifications")).toBe("on");
    });

    it("demande la permission puis active si elle est accordée", async () => {
      const { FakeNotification } = stubNotification("default", "granted");
      await expect(toggleNotifications()).resolves.toBe("on");
      expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
      expect(localStorage.getItem("nldc:pref:notifications")).toBe("on");
    });

    it("reste désactivée si la permission demandée est refusée", async () => {
      stubNotification("default", "denied");
      await expect(toggleNotifications()).resolves.toBe("denied");
      expect(localStorage.getItem("nldc:pref:notifications")).not.toBe("on");
    });
  });

  describe("notifyItemAdded", () => {
    it("ne fait rien si les notifications ne sont pas activées", async () => {
      const { instances } = stubNotification("granted");
      await notifyItemAdded("Pommes", "2 kg", "Courses");
      expect(instances).toEqual([]);
    });

    it("utilise le constructeur Notification direct quand aucun service worker n'est actif", async () => {
      const { instances } = stubNotification("granted");
      localStorage.setItem("nldc:pref:notifications", "on");
      await notifyItemAdded("Pommes", "2 kg", "Courses");
      expect(instances).toEqual([{ title: "Courses", options: { body: "Pommes (2 kg)", tag: "nldc-new-item" } }]);
    });

    it("omet la quantité du corps du message si l'article n'en a pas", async () => {
      const { instances } = stubNotification("granted");
      localStorage.setItem("nldc:pref:notifications", "on");
      await notifyItemAdded("Pommes", "", "Courses");
      expect(instances).toEqual([{ title: "Courses", options: { body: "Pommes", tag: "nldc-new-item" } }]);
    });

    it("passe par ServiceWorkerRegistration.showNotification() quand un service worker est actif", async () => {
      const { instances } = stubNotification("granted");
      localStorage.setItem("nldc:pref:notifications", "on");
      const showNotification = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, serviceWorker: { getRegistration: () => Promise.resolve({ showNotification }) } });

      await notifyItemAdded("Pommes", "2 kg", "Courses");

      expect(showNotification).toHaveBeenCalledWith("Courses", { body: "Pommes (2 kg)", tag: "nldc-new-item" });
      expect(instances).toEqual([]);
    });

    it("n'échoue pas si l'appel à Notification lève (permission révoquée entre-temps)", async () => {
      class ThrowingNotification {
        static permission = "granted";
        constructor() {
          throw new Error("blocked");
        }
      }
      vi.stubGlobal("Notification", ThrowingNotification);
      localStorage.setItem("nldc:pref:notifications", "on");
      await expect(notifyItemAdded("Pommes", "", "Courses")).resolves.toBeUndefined();
    });
  });
});
