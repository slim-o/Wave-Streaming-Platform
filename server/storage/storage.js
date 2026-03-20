import { createMinioStorageFromEnv } from "./minioStorage.js";

export function createStorageAdapterFromEnv() {
  const provider = (process.env.STORAGE_PROVIDER || "").toLowerCase();
  if (provider !== "minio") {
    throw new Error("STORAGE_PROVIDER must be minio");
  }
  return createMinioStorageFromEnv();
}
