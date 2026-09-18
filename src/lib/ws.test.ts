// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListConnection } from "./ws";
import type { ClientMessage } from "../../shared/types";

type Listener = (event?: { data?: string }) => void;

// jsdom fournit bien un WebSocket global, mais qui tente une vraie connexion
// réseau — inutilisable en test. Un faux entièrement piloté à la main plutôt
// qu'une lib de mock, pour garder le contrôle fin sur readyState/évènements
// qu'exige la logique de reconnexion de ListConnection.
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    (this.listeners[type] ??= []).push(cb);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatch("close");
  }

  dispatch(type: string, event?: { data?: string }): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open");
  }

  message(data: unknown): void {
    this.dispatch("message", { data: JSON.stringify(data) });
  }
}

function latest(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

describe("ListConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("se connecte à une URL encodant le code de liste et le nom de participant", () => {
    new ListConnection("ABCDEF", "Renard curieux").connect();
    expect(latest().url).toContain("/api/lists/ABCDEF/ws");
    expect(latest().url).toContain("name=Renard%20curieux");
  });

  it("notifie les écouteurs de connexion à l'ouverture, et vide la file d'attente", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onConn = vi.fn();
    conn.onConnectionChange(onConn);
    conn.connect();
    const msg: ClientMessage = { type: "addItem", id: "1", rawText: "Pommes", categoryId: null };
    conn.send(msg); // pas encore ouverte : mise en file

    latest().open();

    expect(onConn).toHaveBeenCalledWith(true);
    expect(latest().sent).toEqual([JSON.stringify(msg)]);
  });

  it("envoie immédiatement si la connexion est déjà ouverte", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    conn.connect();
    latest().open();
    const msg: ClientMessage = { type: "deleteItem", id: "1" };

    conn.send(msg);

    expect(latest().sent).toEqual([JSON.stringify(msg)]);
  });

  it("distribue les messages \"state\" aux écouteurs d'état", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onState = vi.fn();
    conn.onState(onState);
    conn.connect();
    const state = { code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 };

    latest().message({ type: "state", state });

    expect(onState).toHaveBeenCalledWith(state);
  });

  it("distribue les messages \"presence\" aux écouteurs de présence", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onPresence = vi.fn();
    conn.onPresence(onPresence);
    conn.connect();

    latest().message({ type: "presence", names: ["Toi", "Renard curieux"] });

    expect(onPresence).toHaveBeenCalledWith(["Toi", "Renard curieux"]);
  });

  it("distribue les messages \"error\" aux écouteurs d'erreur", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onError = vi.fn();
    conn.onError(onError);
    conn.connect();

    latest().message({ type: "error", message: "Boom" });

    expect(onError).toHaveBeenCalledWith("Boom");
  });

  it("ignore silencieusement un message qui n'est pas du JSON valide", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onState = vi.fn();
    conn.onState(onState);
    conn.connect();

    expect(() => latest().dispatch("message", { data: "{ pas du json" })).not.toThrow();
    expect(onState).not.toHaveBeenCalled();
  });

  it("ignore silencieusement un type de message reconnu par aucun écouteur", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onState = vi.fn();
    const onPresence = vi.fn();
    const onError = vi.fn();
    conn.onState(onState);
    conn.onPresence(onPresence);
    conn.onError(onError);
    conn.connect();

    // Un type de message qu'aucune branche ne reconnaît (message forgé ou
    // futur type serveur pas encore géré côté client) : pas de TS ici, le
    // JSON reçu sur le fil n'est pas garanti conforme à ServerMessage.
    expect(() => latest().dispatch("message", { data: JSON.stringify({ type: "ping" }) })).not.toThrow();

    expect(onState).not.toHaveBeenCalled();
    expect(onPresence).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("un désabonnement arrête bien les notifications futures", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onState = vi.fn();
    const unsubscribe = conn.onState(onState);
    conn.connect();
    unsubscribe();

    latest().message({ type: "state", state: { code: "ABCDEF", name: "x", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 } });

    expect(onState).not.toHaveBeenCalled();
  });

  it("un désabonnement de présence arrête bien les notifications futures", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onPresence = vi.fn();
    const unsubscribe = conn.onPresence(onPresence);
    conn.connect();
    unsubscribe();

    latest().message({ type: "presence", names: ["Toi"] });

    expect(onPresence).not.toHaveBeenCalled();
  });

  it("un désabonnement d'erreur arrête bien les notifications futures", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onError = vi.fn();
    const unsubscribe = conn.onError(onError);
    conn.connect();
    unsubscribe();

    latest().message({ type: "error", message: "Boom" });

    expect(onError).not.toHaveBeenCalled();
  });

  it("un désabonnement de connexion arrête bien les notifications futures", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onConn = vi.fn();
    const unsubscribe = conn.onConnectionChange(onConn);
    unsubscribe();
    conn.connect();
    latest().open();

    expect(onConn).not.toHaveBeenCalled();
  });

  it("une erreur socket ferme la connexion", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    conn.connect();

    latest().dispatch("error");

    expect(latest().closed).toBe(true);
  });

  it("reconnecte automatiquement après une fermeture, avec un backoff croissant plafonné, et le réinitialise à la reconnexion", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onConn = vi.fn();
    conn.onConnectionChange(onConn);
    conn.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);

    latest().close();
    expect(onConn).toHaveBeenLastCalledWith(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2); // 1000ms

    latest().close();
    vi.advanceTimersByTime(1699);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3); // 1000 * 1.7 = 1700ms

    // Une ouverture réussie réinitialise le délai à 1s pour la prochaine fois.
    latest().open();
    latest().close();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("disconnect() empêche toute reconnexion automatique", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    const onConn = vi.fn();
    conn.onConnectionChange(onConn);
    conn.connect();

    conn.disconnect();

    expect(latest().closed).toBe(true);
    onConn.mockClear();
    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onConn).not.toHaveBeenCalled();
  });

  it("disconnect() annule un reconnect déjà programmé", () => {
    const conn = new ListConnection("ABCDEF", "Toi");
    conn.connect();
    latest().close(); // programme un reconnect dans 1000ms

    conn.disconnect();
    vi.advanceTimersByTime(20_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
