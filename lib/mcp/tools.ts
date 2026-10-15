import { listComponentDefinitions } from "../components/registry";
import { renderDiagramToJpeg } from "../diagram/render";
import { deleteDiagram as removeDiagram, deleteDiagramImage, getDiagram, saveDiagram, saveDiagramImage } from "../diagram/store";
import type { Diagram, DiagramComponent, DiagramConnection, DiagramRegion } from "../diagram/types";
import { validateDiagram } from "../diagram/validate";
import { getBaseUrl } from "../site-url";

export interface DiagramInput {
  diagramId: string;
  title?: string;
  regions?: DiagramRegion[];
  components: DiagramComponent[];
  connections: DiagramConnection[];
}

export type ToolResult =
  | { ok: true; diagram: Diagram; warnings: string[] }
  | { ok: false; errors: string[] };

function toDiagram(input: DiagramInput): Diagram {
  return {
    id: input.diagramId,
    title: input.title,
    regions: input.regions,
    components: input.components,
    connections: input.connections,
  };
}

/** Creates a new diagram. Fails if diagramId is already in use. */
export async function createDiagram(input: DiagramInput): Promise<ToolResult> {
  const existing = await getDiagram(input.diagramId);
  if (existing) {
    return {
      ok: false,
      errors: [`A diagram with id "${input.diagramId}" already exists. Use update_diagram to modify it.`],
    };
  }

  const diagram = toDiagram(input);
  const validation = validateDiagram(diagram);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  await saveDiagram(diagram);
  return { ok: true, diagram, warnings: validation.warnings };
}

/** Replaces an existing diagram's contents. Fails if diagramId doesn't exist. */
export async function updateDiagram(input: DiagramInput): Promise<ToolResult> {
  const existing = await getDiagram(input.diagramId);
  if (!existing) {
    return {
      ok: false,
      errors: [`No diagram with id "${input.diagramId}" exists yet. Use create_diagram first.`],
    };
  }

  const diagram = toDiagram(input);
  const validation = validateDiagram(diagram);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  await saveDiagram(diagram);
  // The cached render belongs to the previous contents; drop it so a view page or image
  // request made before the next render_diagram can't serve it.
  await deleteDiagramImage(diagram.id);
  return { ok: true, diagram, warnings: validation.warnings };
}

export type RenderResult =
  | { ok: true; diagramId: string; title?: string; viewUrl: string; jpeg: Buffer }
  | { ok: false; errors: string[] };

/** Renders a diagram to JPEG and stores it, returning the public view URL. */
export async function renderDiagram(diagramId: string): Promise<RenderResult> {
  const diagram = await getDiagram(diagramId);
  if (!diagram) {
    return { ok: false, errors: [`No diagram with id "${diagramId}" exists. Use create_diagram first.`] };
  }

  const jpeg = await renderDiagramToJpeg(diagram);
  await saveDiagramImage(diagramId, jpeg);

  return {
    ok: true,
    diagramId,
    title: diagram.title,
    viewUrl: `${getBaseUrl()}/view/${diagramId}`,
    jpeg,
  };
}

/** Lists every placeable component type and its pins, for the LLM to discover what it can use. */
export function listComponentTypes() {
  return listComponentDefinitions();
}

export type GetResult = { ok: true; diagram: Diagram } | { ok: false; errors: string[] };

/** Returns the stored diagram exactly as saved (regions, components, connections). */
export async function getStoredDiagram(diagramId: string): Promise<GetResult> {
  const diagram = await getDiagram(diagramId);
  if (!diagram) {
    return { ok: false, errors: [`No diagram with id "${diagramId}" exists.`] };
  }
  return { ok: true, diagram };
}

export type DeleteResult = { ok: true } | { ok: false; errors: string[] };

/** Permanently deletes a diagram and its rendered image. */
export async function deleteStoredDiagram(diagramId: string): Promise<DeleteResult> {
  const deleted = await removeDiagram(diagramId);
  return deleted ? { ok: true } : { ok: false, errors: [`No diagram with id "${diagramId}" exists.`] };
}
