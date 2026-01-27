import { getDocumentAssets } from "./assets";

declare const __ONLYOFFICE_VERSION__: string;
declare const __ONLYOFFICE_BUILD_NUMBER__: number;

export type SocketListener = (...args: unknown[]) => void;

type FakeSocketOptions = {
  auth?: {
    data?: unknown;
    token?: string;
    session?: string;
  };
  query?: Record<string, string>;
  path?: string;
  transports?: string[];
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  randomizationFactor?: number;
  closeOnBeforeunload?: boolean;
  [key: string]: unknown;
};

class EventHub {
  private listeners = new Map<string, Set<SocketListener>>();

  on(event: string, listener: SocketListener) {
    const set = this.listeners.get(event) ?? new Set<SocketListener>();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener?: SocketListener) {
    const set = this.listeners.get(event);
    if (!set) return;
    if (!listener) {
      set.clear();
      return;
    }
    set.delete(listener);
  }

  emit(event: string, ...args: unknown[]) {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(...args);
      } catch {
        // Ignore listener errors to keep the fake transport stable.
      }
    }
  }
}

class FakeSocketManager {
  opts: FakeSocketOptions;
  private events = new EventHub();

  constructor(opts?: FakeSocketOptions) {
    this.opts = { ...(opts ?? {}) };
  }

  on(event: string, listener: SocketListener) {
    this.events.on(event, listener);
    return this;
  }

  off(event: string, listener?: SocketListener) {
    this.events.off(event, listener);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.events.emit(event, ...args);
    return this;
  }

  reconnectionAttempts(attempts: number) {
    this.opts.reconnectionAttempts = attempts;
    return this;
  }

  reconnectionDelay(delay: number) {
    this.opts.reconnectionDelay = delay;
    return this;
  }

  reconnectionDelayMax(delay: number) {
    this.opts.reconnectionDelayMax = delay;
    return this;
  }

  randomizationFactor(factor: number) {
    this.opts.randomizationFactor = factor;
    return this;
  }

  mDg(token: string) {
    if (!this.opts.auth) this.opts.auth = {};
    this.opts.auth.token = token;
  }

  KDg(session: string) {
    if (!this.opts.auth) this.opts.auth = {};
    this.opts.auth.session = session;
  }
}

const socketRegistry = new Set<FakeSocket>();

export class FakeSocket {
  connected = false;
  io: FakeSocketManager;
  auth?: FakeSocketOptions["auth"];

  private events = new EventHub();
  private locks: Record<string, { user: string; time: number; block: unknown }> = {};
  private changesIndex = 0;
  private openCmd?: { url?: string; format?: string; id?: string; key?: string; docId?: string };
  private sessionId = `local-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  private userId = "local-user";

  constructor(options?: FakeSocketOptions) {
    this.io = new FakeSocketManager(options);
    this.auth = options?.auth;
    socketRegistry.add(this);
    queueMicrotask(() => this.connect());
  }

  on(event: string, listener: SocketListener) {
    this.events.on(event, listener);
    return this;
  }

  off(event: string, listener?: SocketListener) {
    this.events.off(event, listener);
    return this;
  }

  emit(event: string, payload?: unknown, ack?: (response: { status: string }) => void) {
    if (event === "message") {
      this.handleMessage(payload);
      return this;
    }

    if (event === "auth") {
      if (typeof ack === "function") {
        ack({ status: "ok" });
      }
      queueMicrotask(() => {
        this.emitLocal("auth_ok", payload);
      });
      return this;
    }

    if (event === "ping") {
      queueMicrotask(() => {
        this.emitLocal("pong");
      });
      return this;
    }

    if (event === "documentOpen") {
      queueMicrotask(() => {
        this.emitLocal("documentReady");
      });
      return this;
    }

    return this;
  }

  send(payload: unknown) {
    return this.emit("message", payload);
  }

  connect() {
    if (this.connected) return this;
    this.connected = true;
    this.emitLocal("connect");
    this.emitLocal("message", {
      type: "license",
      license: {
        type: 3,
        mode: 0,
        rights: 1,
        buildVersion: __ONLYOFFICE_VERSION__,
        buildNumber: __ONLYOFFICE_BUILD_NUMBER__,
        branding: true,
        customization: true,
      },
    });
    return this;
  }

  disconnect(reason = "io client disconnect") {
    if (!this.connected) return this;
    this.connected = false;
    this.emitLocal("disconnect", reason);
    socketRegistry.delete(this);
    return this;
  }

  close() {
    return this.disconnect("io client disconnect");
  }

  matchesDocId(docId: string) {
    if (!docId) return false;
    const cmd = this.openCmd;
    if (!cmd) return false;
    return (
      cmd.id === docId ||
      cmd.key === docId ||
      cmd.docId === docId ||
      cmd.url === docId
    );
  }

  emitServerMessage(message: unknown) {
    this.emitLocal("message", message);
  }

  private handleMessage(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const message = payload as Record<string, unknown>;
    const type = typeof message.type === "string" ? message.type : undefined;
    const nestedData =
      message.data && typeof message.data === "object" && !Array.isArray(message.data)
        ? (message.data as Record<string, unknown>)
        : null;
    const command =
      typeof message.c === "string"
        ? message.c
        : typeof nestedData?.c === "string"
          ? (nestedData.c as string)
          : undefined;

    if (command === "imgurls") {
      const imgMessage = nestedData ? { ...nestedData, id: message.id ?? nestedData.id } : message;
      this.handleImageUrls(imgMessage);
      return;
    }

    if (!type) return;

    switch (type) {
      case "auth":
        this.handleAuth(message);
        break;
      case "openDocument":
        this.emitDocumentOpen();
        break;
      case "imgurls":
        this.handleImageUrls(message);
        break;
      case "getLock":
        this.handleGetLock(message);
        this.releaseLocks();
        break;
      case "unLockDocument":
        this.releaseLocks();
        break;
      case "isSaveLock":
        this.emitLocal("message", { type: "saveLock", saveLock: false });
        break;
      case "saveChanges":
        this.handleSaveChanges(message);
        break;
      default:
        break;
    }
  }

  private handleAuth(message: Record<string, unknown>) {
    const openCmd = message.openCmd;
    if (openCmd && typeof openCmd === "object") {
      const cmd = openCmd as { url?: string; format?: string; fileType?: string; id?: string; key?: string; docId?: string };
      this.openCmd = cmd;
      const format = typeof cmd.format === "string" ? cmd.format : cmd.fileType;
      if (typeof format === "string") {
        this.openCmd.format = format.toLowerCase();
      }
    }

    const user = message.user;
    if (user && typeof user === "object") {
      const userId = (user as { id?: string | number }).id;
      if (userId !== undefined && userId !== null) {
        this.userId = String(userId);
      }
    }

    const sessionId = message.sessionId;
    if (typeof sessionId === "string" && sessionId) {
      this.sessionId = sessionId;
    }

    const indexUser =
      user && typeof user === "object" && typeof (user as { indexUser?: number }).indexUser === "number"
        ? (user as { indexUser?: number }).indexUser
        : 0;

    this.emitLocal("message", {
      type: "auth",
      result: 1,
      sessionId: this.sessionId,
      indexUser,
      sessionTimeConnect: Date.now(),
      participants: [],
      buildVersion: __ONLYOFFICE_VERSION__,
      buildNumber: __ONLYOFFICE_BUILD_NUMBER__,
    });

    this.emitLocal("message", { type: "authChanges", changes: [] });

    this.emitDocumentOpen();
  }

  private emitDocumentOpen() {
    if (!this.openCmd?.url) return;
    const format = this.openCmd?.format || "docx";
    const urls: Record<string, string> = {
      "Editor.bin": this.openCmd.url,
    };
    urls[`origin.${format}`] = this.openCmd.url;
    const assets = this.getAssets();
    if (assets?.images) {
      for (const [name, url] of Object.entries(assets.images)) {
        const normalized = normalizeImagePath(name);
        urls[normalized] = url;
        if (name !== normalized) {
          urls[name] = url;
        }
        const withoutMedia = normalized.startsWith("media/") ? normalized.slice("media/".length) : normalized;
        urls[withoutMedia] = url;
        if (!normalized.startsWith("media/")) {
          urls[`media/${normalized}`] = url;
        } else {
          urls[`media/${withoutMedia}`] = url;
        }
      }
    }

    this.emitLocal("message", {
      type: "documentOpen",
      data: {
        type: "open",
        status: "ok",
        openedAt: Date.now(),
        data: urls,
      },
    });
  }

  private handleImageUrls(message: Record<string, unknown>) {
    const assets = this.getAssets();
    const images = assets?.images ?? {};
    const rawList = Array.isArray(message.data)
      ? message.data
      : Array.isArray((message.data as { data?: unknown })?.data)
        ? (message.data as { data: unknown[] }).data
        : Array.isArray((message.data as { urls?: unknown })?.urls)
          ? (message.data as { urls: unknown[] }).urls
        : [];
    const urls = rawList.flatMap((entry) => {
      const name =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object" && "path" in entry
            ? String((entry as { path?: unknown }).path ?? "")
            : String(entry ?? "");
      const normalized = normalizeImagePath(name);
      const url = resolveImageUrl(images, name, normalized);
      const base = { url: url ?? null, path: normalized };
      if (normalized !== name) {
        return [base, { url: url ?? null, path: name }];
      }
      return [base];
    });

    this.emitLocal("message", {
      type: "imgurls",
      status: "ok",
      id: message.id,
      data: {
        urls,
        error: 0,
      },
    });
  }

  private getAssets() {
    if (this.openCmd?.id) {
      return getDocumentAssets(this.openCmd.id);
    }
    if (this.openCmd?.key) {
      return getDocumentAssets(this.openCmd.key);
    }
    if (this.openCmd?.docId) {
      return getDocumentAssets(this.openCmd.docId);
    }
    if (this.openCmd?.url) {
      return getDocumentAssets(this.openCmd.url);
    }
    return undefined;
  }

  private handleGetLock(message: Record<string, unknown>) {
    const rawBlocks = message.block;
    const blocks = Array.isArray(rawBlocks) ? rawBlocks : rawBlocks ? [rawBlocks] : [];
    const locks: Record<string, { user: string; time: number; block: unknown }> = {};

    for (const block of blocks) {
      const key =
        typeof block === "string"
          ? block
          : block && typeof block === "object" && "guid" in block
            ? String((block as { guid?: unknown }).guid)
            : String(block);
      locks[key] = { user: this.userId, time: Date.now(), block };
      this.locks[key] = locks[key];
    }

    this.emitLocal("message", { type: "getLock", locks });
  }

  private releaseLocks() {
    if (!Object.keys(this.locks).length) return;
    const locks = this.locks;
    this.locks = {};
    this.emitLocal("message", { type: "releaseLock", locks });
  }

  private handleSaveChanges(message: Record<string, unknown>) {
    let changesCount = 0;
    const rawChanges = message.changes;
    if (Array.isArray(rawChanges)) {
      changesCount = rawChanges.length;
    } else if (typeof rawChanges === "string") {
      try {
        const parsed = JSON.parse(rawChanges);
        if (Array.isArray(parsed)) changesCount = parsed.length;
      } catch {
        // Ignore parse errors.
      }
    }

    this.changesIndex += changesCount;
    this.emitLocal("message", {
      type: "unSaveLock",
      index: 0,
      time: Date.now(),
      syncChangesIndex: this.changesIndex,
    });
  }

  private emitLocal(event: string, ...args: unknown[]) {
    this.events.emit(event, ...args);
  }
}

export function emitServerMessage(docId: string, message: unknown) {
  let delivered = false;
  for (const socket of socketRegistry) {
    if (!socket.connected) continue;
    if (!socket.matchesDocId(docId)) continue;
    socket.emitServerMessage(message);
    delivered = true;
  }
  return delivered;
}

function normalizeImagePath(name: string) {
  const trimmed = name.replace(/^\.\//, "");
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("media/") || trimmed.includes("/")) {
    return trimmed;
  }
  return `media/${trimmed}`;
}

function resolveImageUrl(
  images: Record<string, string>,
  name: string,
  normalized: string
) {
  if (images[name]) return images[name];
  if (images[normalized]) return images[normalized];
  if (normalized.startsWith("media/")) {
    const withoutMedia = normalized.slice("media/".length);
    if (images[withoutMedia]) return images[withoutMedia];
  }
  if (name.includes("/media/")) {
    const collapsed = name.replace("/media/", "/");
    if (images[collapsed]) return images[collapsed];
  }
  if (!name.startsWith("media/")) {
    const withMedia = `media/${name}`;
    if (images[withMedia]) return images[withMedia];
  }
  return null;
}
