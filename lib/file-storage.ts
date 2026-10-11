import { del, get, list as listBlobs, put, type BlobAccessType } from "@vercel/blob";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

export type FileData = string | Buffer | Uint8Array | ArrayBuffer | Blob;

export interface StoredFile {
  pathname: string;
  url: string;
}

export interface UploadOptions {
  contentType?: string;
}

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "temp");

function isLocalFileStorageEnabled(): boolean {
  return process.env.USE_LOCAL_FILE_STORAGE === "true";
}

// A Blob store is provisioned as either public or private, and every read/write
// must declare the matching access level or the SDK rejects it outright ("Cannot
// use public access on a private store"). We can't detect this at runtime, so it's
// configurable; default to "private" since that's Vercel's current default for new
// stores. Set BLOB_ACCESS=public if the store was created with public access.
function getBlobAccess(): BlobAccessType {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

async function toBuffer(data: FileData): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === "string") return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  throw new Error("Unsupported file data type");
}

function resolveLocalPath(pathname: string): string {
  const filePath = path.join(LOCAL_STORAGE_ROOT, pathname);
  if (filePath !== LOCAL_STORAGE_ROOT && !filePath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) {
    throw new Error(`Invalid pathname: ${pathname}`);
  }
  return filePath;
}

async function uploadLocal(pathname: string, data: Buffer): Promise<StoredFile> {
  const filePath = resolveLocalPath(pathname);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return { pathname, url: `file://${filePath}` };
}

async function downloadLocal(pathname: string): Promise<Buffer> {
  return fs.readFile(resolveLocalPath(pathname));
}

async function deleteLocal(pathname: string): Promise<void> {
  await fs.rm(resolveLocalPath(pathname), { force: true });
}

async function listLocal(prefix = ""): Promise<StoredFile[]> {
  const files: StoredFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else {
        const pathname = path.relative(LOCAL_STORAGE_ROOT, entryPath);
        files.push({ pathname, url: `file://${entryPath}` });
      }
    }
  }

  await walk(resolveLocalPath(prefix));
  return files.filter((file) => file.pathname.startsWith(prefix));
}

async function uploadBlob(pathname: string, data: Buffer, options?: UploadOptions): Promise<StoredFile> {
  const blob = await put(pathname, data, {
    access: getBlobAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: options?.contentType,
  });
  return { pathname: blob.pathname, url: blob.url };
}

async function downloadBlob(pathname: string): Promise<Buffer> {
  // useCache: false reads the latest bytes from origin storage. With the default (CDN-cached,
  // up to a month) a file we just overwrote - e.g. a diagram's JSON after update_diagram - can
  // keep being served in its old form, so the next render would draw stale content.
  const result = await get(pathname, { access: getBlobAccess(), useCache: false });
  if (!result || result.statusCode !== 200) {
    throw new Error(`File not found: ${pathname}`);
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function deleteBlob(pathname: string): Promise<void> {
  await del(pathname);
}

async function listBlobFiles(prefix = ""): Promise<StoredFile[]> {
  const { blobs } = await listBlobs({ prefix });
  return blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url }));
}

/**
 * Uploads a file, storing it in Vercel Blob by default. Set USE_LOCAL_FILE_STORAGE=true
 * (e.g. in .env.local) to write to the local ./temp folder instead during development.
 */
export async function uploadFile(pathname: string, data: FileData, options?: UploadOptions): Promise<StoredFile> {
  const buffer = await toBuffer(data);
  return isLocalFileStorageEnabled() ? uploadLocal(pathname, buffer) : uploadBlob(pathname, buffer, options);
}

export async function downloadFile(pathname: string): Promise<Buffer> {
  return isLocalFileStorageEnabled() ? downloadLocal(pathname) : downloadBlob(pathname);
}

export async function deleteFile(pathname: string): Promise<void> {
  return isLocalFileStorageEnabled() ? deleteLocal(pathname) : deleteBlob(pathname);
}

export async function listFiles(prefix?: string): Promise<StoredFile[]> {
  return isLocalFileStorageEnabled() ? listLocal(prefix) : listBlobFiles(prefix);
}
