import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDiagram,
  deleteStoredDiagram,
  getStoredDiagram,
  listComponentTypes,
  renderDiagram,
  updateDiagram,
  type DiagramInput,
} from "./tools";
import {
  createDiagramTool,
  deleteDiagramTool,
  getDiagramTool,
  listComponentTypesTool,
  renderDiagramTool,
  updateDiagramTool,
} from "./tool-definitions";

function errorResult(errors: string[]) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Diagram is invalid:\n${errors.map((e) => `- ${e}`).join("\n")}` }],
  };
}

function diagramSummary(action: string, diagram: DiagramInput, warnings: string[]) {
  const regionCount = diagram.regions?.length ?? 0;
  const warningText = warnings.length > 0 ? `\nWarnings:\n${warnings.map((w) => `- ${w}`).join("\n")}` : "";
  return {
    content: [
      {
        type: "text" as const,
        text:
          `${action} diagram "${diagram.diagramId}" with ${diagram.components.length} component(s), ` +
          `${diagram.connections.length} connection(s) and ${regionCount} region(s). Call render_diagram to generate an image.${warningText}`,
      },
    ],
    structuredContent: {
      diagramId: diagram.diagramId,
      regionCount,
      warnings,
      componentCount: diagram.components.length,
      connectionCount: diagram.connections.length,
    },
  };
}

export function createDiagramMcpServer(): McpServer {
  const server = new McpServer(
    { name: "electronics-diagrams", version: "1.0.0" },
    {
      instructions:
        "After calling render_diagram, always share the returned viewUrl with the user in your reply, " +
        "even when the rendered image is also shown inline — it's the link they need to revisit or share the diagram.",
    },
  );

  server.registerTool(
    createDiagramTool.name,
    {
      title: createDiagramTool.title,
      description: createDiagramTool.description,
      inputSchema: createDiagramTool.inputSchema,
    },
    async (input) => {
      const result = await createDiagram(input);
      return result.ok ? diagramSummary("Created", input, result.warnings) : errorResult(result.errors);
    },
  );

  server.registerTool(
    updateDiagramTool.name,
    {
      title: updateDiagramTool.title,
      description: updateDiagramTool.description,
      inputSchema: updateDiagramTool.inputSchema,
    },
    async (input) => {
      const result = await updateDiagram(input);
      return result.ok ? diagramSummary("Updated", input, result.warnings) : errorResult(result.errors);
    },
  );

  server.registerTool(
    renderDiagramTool.name,
    {
      title: renderDiagramTool.title,
      description: renderDiagramTool.description,
      inputSchema: renderDiagramTool.inputShape,
    },
    async ({ diagramId }) => {
      const result = await renderDiagram(diagramId);
      if (!result.ok) return errorResult(result.errors);

      return {
        content: [
          { type: "text" as const, text: `Rendered diagram. View it at ${result.viewUrl}` },
          { type: "image" as const, data: result.jpeg.toString("base64"), mimeType: "image/jpeg" },
        ],
        structuredContent: {
          diagramId: result.diagramId,
          viewUrl: result.viewUrl,
        },
      };
    },
  );

  server.registerTool(
    listComponentTypesTool.name,
    { title: listComponentTypesTool.title, description: listComponentTypesTool.description },
    async () => {
      const types = listComponentTypes();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(types, null, 2) }],
        structuredContent: { componentTypes: types },
      };
    },
  );

  server.registerTool(
    getDiagramTool.name,
    {
      title: getDiagramTool.title,
      description: getDiagramTool.description,
      inputSchema: getDiagramTool.inputShape,
    },
    async ({ diagramId }) => {
      const result = await getStoredDiagram(diagramId);
      if (!result.ok) return errorResult(result.errors);

      const { id, ...rest } = result.diagram;
      const stored = { diagramId: id, ...rest };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(stored, null, 2) }],
        structuredContent: stored,
      };
    },
  );

  server.registerTool(
    deleteDiagramTool.name,
    {
      title: deleteDiagramTool.title,
      description: deleteDiagramTool.description,
      inputSchema: deleteDiagramTool.inputShape,
    },
    async ({ diagramId }) => {
      const result = await deleteStoredDiagram(diagramId);
      if (!result.ok) return errorResult(result.errors);
      return {
        content: [{ type: "text" as const, text: `Deleted diagram "${diagramId}" and its rendered image.` }],
        structuredContent: { diagramId, deleted: true },
      };
    },
  );

  return server;
}
