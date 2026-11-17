export interface CdnDriver {
  key: "none" | "arvan";
  purgeUrls(urls: string[]): Promise<{ ok: boolean; purged: number; error?: string }>;
  purgeAll(): Promise<{ ok: boolean; error?: string }>;   // HTML only if the provider supports tags; else everything (rare, incident tool)
}
