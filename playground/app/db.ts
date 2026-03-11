export interface Template {
  id: string; // unique ID
  name: string; // display name
  blob: Blob; // file content
  date: number; // timestamp
}

export interface RecentFile {
  id: string; // unique ID
  name: string; // display name
  source: "local" | "url" | "template" | "new";
  url?: string; // if source is url
  blob?: Blob; // if local or template (we might just store local files if permitted by quota)
  date: number; // timestamp
}

const DB_NAME = "OfficeViewerDB";
const DB_VERSION = 1;

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
    const newTemplate = { ...template, id: crypto.randomUUID() };
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

  async addRecentFile(recent: Omit<RecentFile, "id" | "date">): Promise<RecentFile> {
    await this.init();
    
    const allRecent = await this.getRecentFiles();
    const existing = allRecent.find(
      (r) => 
        (r.name === recent.name && r.source === recent.source) || 
        (recent.url && r.url === recent.url)
    );

    const newRecent = {
      ...recent,
      id: existing ? existing.id : crypto.randomUUID(),
      date: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["recent"], "readwrite");
      const store = transaction.objectStore("recent");
      
      const request = store.put(newRecent);

      request.onsuccess = async () => {
        // After adding, check if we need to trim the list to 10
        const updatedList = await this.getRecentFiles(); // This is sorted by date desc
        if (updatedList.length > 10) {
          const toDelete = updatedList.slice(10);
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
}

export const db = new Database();
