import { fsStorage } from "./fs";
import { s3Storage } from "./s3";
import type { StorageDriver } from "./types";

export function storageDriver(env: {
  STORAGE_DRIVER: "fs" | "s3";
  MEDIA_DIR: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  SITE_ORIGIN: string;
}): StorageDriver {
  if (env.STORAGE_DRIVER === "s3") {
    const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
    if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY");
    }
    return s3Storage({
      endpoint: S3_ENDPOINT,
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      publicBase: `${env.SITE_ORIGIN}/media`,
    });
  }
  return fsStorage({ mediaDir: env.MEDIA_DIR });
}
