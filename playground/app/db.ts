export type RecentSource = "local" | "url" | "template" | "new";
export type FileHandlePermissionMode = "read" | "readwrite";

export interface StoredWritableStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface StoredFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<StoredWritableStream>;
  isSameEntry?(other: StoredFileHandle): Promise<boolean>;
  queryPermission?(descriptor?: { mode?: FileHandlePermissionMode }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: FileHandlePermissionMode }): Promise<PermissionState>;
}

export interface Template {
  id: string;
  name: string;
  blob: Blob;
  date: number;
}

export interface RecentFile {
  id: string;
  name: string;
  source: RecentSource;
  url?: string;
  blob?: Blob;
  fileHandle?: StoredFileHandle;
  extension?: string;
  templateId?: string;
  date: number;
}

const DB_NAME = "OfficeViewerDB";
const DB_VERSION = 1;
const MAX_RECENT_FILES = 12;

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

class Database {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("templates")) {
          db.createObjectStore("templates", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("recent")) {
          db.createObjectStore("recent", { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        console.error("IndexedDB error:", (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.initPromise;
  }

  // --- Templates ---
  async getTemplates(): Promise<Template[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["templates"], "readonly");
      const store = transaction.objectStore("templates");
      const request = store.getAll();

      request.onsuccess = () => {
        const result = request.result.sort((a, b) => b.date - a.date);
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async addTemplate(template: Omit<Template, "id">): Promise<Template> {
    await this.init();
    const newTemplate = { ...template, id: createId() };
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["templates"], "readwrite");
      const store = transaction.objectStore("templates");
      const request = store.add(newTemplate);

      request.onsuccess = () => resolve(newTemplate);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["templates"], "readwrite");
      const store = transaction.objectStore("templates");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Recent Files ---
  async getRecentFiles(): Promise<RecentFile[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["recent"], "readonly");
      const store = transaction.objectStore("recent");
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by date descending
        const result = request.result.sort((a, b) => b.date - a.date);
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async findExistingRecent(
    allRecent: RecentFile[],
    recent: Omit<RecentFile, "id" | "date">,
  ): Promise<RecentFile | undefined> {
    if (recent.source === "local" && recent.fileHandle) {
      for (const entry of allRecent) {
        if (entry.source !== "local" || !entry.fileHandle) continue;
        if (!entry.fileHandle.isSameEntry) continue;
        try {
          if (await entry.fileHandle.isSameEntry(recent.fileHandle)) {
            return entry;
          }
        } catch {
          // Ignore handle comparison errors and fall back to weaker matching.
        }
      }
    }

    if (recent.source === "url" && recent.url) {
      return allRecent.find((entry) => entry.source === "url" && entry.url === recent.url);
    }

    if (recent.source === "template" && recent.templateId) {
      return allRecent.find(
        (entry) => entry.source === "template" && entry.templateId === recent.templateId,
      );
    }

    return allRecent.find(
      (entry) => entry.source === recent.source && entry.name === recent.name,
    );
  }

  async addRecentFile(recent: Omit<RecentFile, "id" | "date">): Promise<RecentFile> {
    await this.init();
    const allRecent = await this.getRecentFiles();
    const existing = await this.findExistingRecent(allRecent, recent);

    const newRecent = {
      ...recent,
      id: existing ? existing.id : createId(),
      date: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["recent"], "readwrite");
      const store = transaction.objectStore("recent");
      
      const request = store.put(newRecent);

      request.onsuccess = async () => {
        const updatedList = await this.getRecentFiles();
        if (updatedList.length > MAX_RECENT_FILES) {
          const toDelete = updatedList.slice(MAX_RECENT_FILES);
          const deleteTransaction = this.db!.transaction(["recent"], "readwrite");
          const deleteStore = deleteTransaction.objectStore("recent");
          for (const item of toDelete) {
            deleteStore.delete(item.id);
          }
        }
        resolve(newRecent);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateRecentFileName(id: string, newName: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["recent"], "readwrite");
      const store = transaction.objectStore("recent");
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          item.name = newName;
          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteRecentFile(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["recent"], "readwrite");
      const store = transaction.objectStore("recent");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearRecentFiles(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["recent"], "readwrite");
      const store = transaction.objectStore("recent");
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const db = new Database();
