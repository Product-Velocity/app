import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Where file bytes live. The database row says who may see a file; the store only holds bytes. */
export interface FileStore {
  put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
}

export const FILE_BUCKET = "item-files";

/** A private Supabase Storage bucket, reached only with the service role from the server. Created the first time it is needed. */
export function supabaseFileStore(): FileStore {
  const admin = createAdminClient({ via: "UI" });
  let ready: Promise<void> | null = null;
  const ensure = () =>
    (ready ??= (async () => {
      const { error } = await admin.storage.createBucket(FILE_BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024 });
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Could not prepare file storage: ${error.message}`);
    })());
  return {
    async put(path, bytes, mime) {
      await ensure();
      const { error } = await admin.storage.from(FILE_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (error) throw new Error(`Could not store the file: ${error.message}`);
    },
    async get(path) {
      await ensure();
      const { data, error } = await admin.storage.from(FILE_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) {
      await ensure();
      await admin.storage.from(FILE_BUCKET).remove([path]);
    },
  };
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  async put(path: string, bytes: Uint8Array) { this.files.set(path, bytes); }
  async get(path: string) { return this.files.get(path) ?? null; }
  async remove(path: string) { this.files.delete(path); }
}
