export interface StorageDriver {
  key: "fs" | "s3";
  put(storageKey: string, body: Uint8Array, contentType: string, opts?: { cacheControl?: string }): Promise<void>;
  get(storageKey: string): Promise<Uint8Array | null>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
  publicUrl(storageKey: string): string;   // "/media/<key>" (fs, served by Caddy) or the bucket/CDN url (s3)
}
