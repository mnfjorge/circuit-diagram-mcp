process.env.USE_LOCAL_FILE_STORAGE = "true";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { randomUUID } from "node:crypto";
import { deleteFile } from "../lib/file-storage";
import { getDiagramImage } from "../lib/diagram/store";
import { createDiagramMcpServer } from "../lib/mcp/server";

const ids: string[] = [];
const newId = () => {
  const id = randomUUID();
  ids.push(id);
  return id;
};

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createDiagramMcpServer().connect(serverTransport);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  for (const id of ids) {
    await deleteFile(`diagrams/${id}.json`).catch(() => {});
    await deleteFile(`diagrams/${id}.jpg`).catch(() => {});
  }
});

const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
const textOf = (result: Awaited<ReturnType<typeof call>>) =>
  (result.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");

const mcu = { id: "mcu-1", type: "esp32" };
const sensor = { id: "sensor-1", type: "hall_sensor" };
const wire = { from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } };

describe("input validation", () => {
  test("rejects unknown keys instead of silently dropping them", async () => {
    const result = await call("create_diagram", {
      diagramId: newId(),
      // The wrong shape from the bug report: members listed on the region itself.
      regions: [{ id: "r", label: "R", components: ["mcu-1"] }],
      components: [mcu],
      connections: [],
    }).catch((error: Error) => ({ isError: true, content: [{ type: "text", text: error.message }] }));
    expect(result.isError).toBe(true);
    expect(textOf(result as Awaited<ReturnType<typeof call>>)).toMatch(/components/i);
  });

  test("rejects unknown keys on components, connections and at the top level", async () => {
    for (const args of [
      { components: [{ ...mcu, regionId: "r" }], connections: [] },
      { components: [mcu, sensor], connections: [{ ...wire, wireColor: "red" }] },
      { components: [mcu], connections: [], notes: "hi" },
    ]) {
      const result = await call("create_diagram", { diagramId: newId(), ...args }).catch(
        (error: Error) => ({ isError: true, content: [{ type: "text", text: error.message }] }),
      );
      expect(result.isError).toBe(true);
    }
  });

  test("errors when a component references an undeclared region", async () => {
    const result = await call("create_diagram", {
      diagramId: newId(),
      components: [{ ...mcu, region: "nope" }],
      connections: [],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('unknown region "nope"');
  });

  test("warns (but still saves) when a declared region has no components", async () => {
    const result = await call("create_diagram", {
      diagramId: newId(),
      regions: [{ id: "empty", label: "Empty" }],
      components: [mcu],
      connections: [],
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Region "empty" has no components');
    expect((result.structuredContent as { warnings: string[] }).warnings).toHaveLength(1);
  });
});

describe("update_diagram then render_diagram", () => {
  async function renderSvgSource(diagramId: string) {
    const rendered = await call("render_diagram", { diagramId });
    expect(rendered.isError).toBeFalsy();
    // The stored diagram is what gets rendered, so read it back via get_diagram.
    return (await call("get_diagram", { diagramId })).structuredContent as {
      components: { id: string; type: string; region?: string }[];
      regions?: { id: string }[];
    };
  }

  test("reflects a component type change, removals and region changes", async () => {
    const diagramId = newId();
    await call("create_diagram", { diagramId, components: [mcu, sensor], connections: [wire] });
    await renderSvgSource(diagramId);

    // Same ids, different type for mcu-1.
    await call("update_diagram", {
      diagramId,
      components: [{ id: "mcu-1", type: "xiao_esp32c3" }, sensor],
      connections: [{ ...wire, to: { component: "mcu-1", pin: "D3" } }],
    });
    let stored = await renderSvgSource(diagramId);
    expect(stored.components.find((c) => c.id === "mcu-1")?.type).toBe("xiao_esp32c3");

    // Remove a component, add a region.
    await call("update_diagram", {
      diagramId,
      regions: [{ id: "dev", label: "Device" }],
      components: [{ id: "mcu-1", type: "xiao_esp32c3", region: "dev" }],
      connections: [],
    });
    stored = await renderSvgSource(diagramId);
    expect(stored.components.map((c) => c.id)).toEqual(["mcu-1"]);
    expect(stored.regions).toEqual([{ id: "dev", label: "Device" }]);
    expect(stored.components[0].region).toBe("dev");
  });

  test("update_diagram drops the previously rendered image so it can't be served stale", async () => {
    const diagramId = newId();
    await call("create_diagram", { diagramId, components: [mcu, sensor], connections: [wire] });
    await call("render_diagram", { diagramId });
    expect(await getDiagramImage(diagramId)).not.toBeNull();

    await call("update_diagram", { diagramId, components: [mcu], connections: [] });
    expect(await getDiagramImage(diagramId)).toBeNull();
  });
});

describe("get_diagram and delete_diagram", () => {
  test("get_diagram returns what was stored, in create_diagram's shape", async () => {
    const diagramId = newId();
    await call("create_diagram", {
      diagramId,
      title: "T",
      regions: [{ id: "r", label: "R", kind: "virtual" }],
      components: [{ ...mcu, region: "r" }, sensor],
      connections: [wire],
    });
    const result = await call("get_diagram", { diagramId });
    expect(result.structuredContent).toEqual({
      diagramId,
      title: "T",
      regions: [{ id: "r", label: "R", kind: "virtual" }],
      components: [{ ...mcu, region: "r" }, sensor],
      connections: [wire],
    });
  });

  test("get_diagram errors for an unknown id", async () => {
    expect((await call("get_diagram", { diagramId: randomUUID() })).isError).toBe(true);
  });

  test("delete_diagram removes the diagram and its image", async () => {
    const diagramId = newId();
    await call("create_diagram", { diagramId, components: [mcu], connections: [] });
    await call("render_diagram", { diagramId });

    const deleted = await call("delete_diagram", { diagramId });
    expect(deleted.isError).toBeFalsy();
    expect((await call("get_diagram", { diagramId })).isError).toBe(true);
    expect(await getDiagramImage(diagramId)).toBeNull();
    // Deleting again reports that it's gone rather than silently succeeding.
    expect((await call("delete_diagram", { diagramId })).isError).toBe(true);
  });
});
