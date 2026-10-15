import { deleteFile, downloadFile, uploadFile, type StoredFile } from "../file-storage";
import type { Diagram } from "./types";

function diagramPath(id: string): string {
  return `diagrams/${id}.json`;
}

export function diagramImagePath(id: string): string {
  return `diagrams/${id}.jpg`;
}

/**
 * Returns the diagram, or null if it doesn't exist. Any storage-layer error
 * (missing file, misconfigured token, ...) is treated as "not found" for
 * simplicity; the caller only needs to distinguish "exists" from "doesn't".
 */
export async function getDiagram(id: string): Promise<Diagram | null> {
  try {
    const buffer = await downloadFile(diagramPath(id));
    return JSON.parse(buffer.toString("utf8")) as Diagram;
  } catch {
    return null;
  }
}

export async function saveDiagram(diagram: Diagram): Promise<void> {
  await uploadFile(diagramPath(diagram.id), JSON.stringify(diagram, null, 2), {
    contentType: "application/json",
  });
}

export async function saveDiagramImage(id: string, jpeg: Buffer): Promise<StoredFile> {
  return uploadFile(diagramImagePath(id), jpeg, { contentType: "image/jpeg" });
}

/** Returns the diagram's rendered JPEG, or null if render_diagram hasn't been called for it yet. */
export async function getDiagramImage(id: string): Promise<Buffer | null> {
  try {
    return await downloadFile(diagramImagePath(id));
  } catch {
    return null;
  }
}

/** Drops the cached render so the next request re-renders from the stored diagram. No-op if there isn't one. */
export async function deleteDiagramImage(id: string): Promise<void> {
  await deleteFile(diagramImagePath(id)).catch(() => {});
}

/** Deletes a diagram and its cached render. Returns false if no such diagram existed. */
export async function deleteDiagram(id: string): Promise<boolean> {
  const existing = await getDiagram(id);
  if (!existing) return false;
  await deleteFile(diagramPath(id));
  await deleteDiagramImage(id);
  return true;
}
