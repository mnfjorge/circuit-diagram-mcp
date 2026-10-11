import { layoutDiagram } from "../lib/diagram/layout";
import { diagramToSvg } from "../lib/diagram/render";
import type { Diagram } from "../lib/diagram/types";
import { validateDiagram } from "../lib/diagram/validate";

const diagram: Diagram = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  regions: [
    { id: "device", label: "Physical device" },
    { id: "cloud", label: "Cloud & app", kind: "virtual" },
  ],
  components: [
    { id: "sensor-1", type: "hall_sensor", region: "device" },
    { id: "mcu-1", type: "esp32", region: "device" },
    { id: "psu-1", type: "power_supply" },
  ],
  connections: [
    { id: "c1", from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } },
    { id: "c2", from: { component: "psu-1", pin: "DC+" }, to: { component: "mcu-1", pin: "VIN" } },
  ],
};

const inside = (
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

describe("regions", () => {
  test("validation accepts regions and rejects unknown/duplicate ones", () => {
    expect(validateDiagram(diagram).valid).toBe(true);

    const unknown = validateDiagram({
      ...diagram,
      components: [{ id: "a", type: "esp32", region: "nope" }],
      connections: [],
    });
    expect(unknown.errors.join()).toContain('unknown region "nope"');

    const dup = validateDiagram({ ...diagram, regions: [diagram.regions![0], diagram.regions![0]] });
    expect(dup.errors.join()).toContain('Duplicate region id "device"');
  });

  test("members are laid out inside their region box; empty regions are omitted", async () => {
    const layout = await layoutDiagram(diagram);
    expect(layout.regions.map((r) => r.id)).toEqual(["device"]);
    const box = layout.regions[0];
    for (const id of ["sensor-1", "mcu-1"]) {
      expect(inside(layout.nodes.find((n) => n.componentId === id)!, box)).toBe(true);
    }
    expect(inside(layout.nodes.find((n) => n.componentId === "psu-1")!, box)).toBe(false);
  });

  test("edges still start and end on their pins, including ones inside a region", async () => {
    const layout = await layoutDiagram(diagram);
    for (const connection of diagram.connections) {
      const edge = layout.edges.find((e) => e.id === connection.id)!;
      for (const [point, ref] of [
        [edge.points[0], connection.from],
        [edge.points[edge.points.length - 1], connection.to],
      ] as const) {
        const pin = layout.nodes.find((n) => n.componentId === ref.component)!.pins.find((p) => p.name === ref.pin)!;
        expect(Math.abs(point.x - pin.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(point.y - pin.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("SVG draws region labels and dashes virtual regions", async () => {
    const virtual: Diagram = {
      ...diagram,
      regions: [{ id: "device", label: "Cloud <app>", kind: "virtual" }],
    };
    const svg = diagramToSvg(virtual, await layoutDiagram(virtual));
    expect(svg).toContain("Cloud &lt;app&gt;");
    expect(svg).toContain("stroke-dasharray");
  });

  test("each wire crossing a region border gets its own gate on the border", async () => {
    const layout = await layoutDiagram(diagram);
    const box = layout.regions[0];
    // Only c2 (psu-1 -> mcu-1) crosses; c1 is internal.
    expect(box.gates).toHaveLength(1);
    const onBorder = (g: { x: number; y: number }) =>
      Math.abs(g.x - box.x) <= 1 || Math.abs(g.x - (box.x + box.width)) <= 1;
    expect(box.gates.every(onBorder)).toBe(true);

    const crossing = layout.edges.find((e) => e.id === "c2")!;
    expect(
      crossing.points.some((p) => box.gates.some((g) => Math.abs(p.x - g.x) <= 1 && Math.abs(p.y - g.y) <= 1)),
    ).toBe(true);

    // The wire is orthogonal throughout, including across the stitched hops.
    for (let i = 1; i < crossing.points.length; i++) {
      const a = crossing.points[i - 1];
      const b = crossing.points[i];
      expect(Math.abs(a.x - b.x) <= 1 || Math.abs(a.y - b.y) <= 1).toBe(true);
    }

    // Wires fully inside the region never need a gate.
    const internal = layout.edges.find((e) => e.id === "c1")!;
    expect(internal.points.every((p) => inside({ ...p, width: 0, height: 0 }, box))).toBe(true);
  });

  test("wires from different pins get separate gates, not one shared point", async () => {
    const many: Diagram = {
      ...diagram,
      components: [
        { id: "sensor-1", type: "hall_sensor", region: "device" },
        { id: "mcu-1", type: "esp32" },
        { id: "psu-1", type: "power_supply" },
      ],
      connections: [
        { id: "a", from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } },
        { id: "b", from: { component: "sensor-1", pin: "VCC" }, to: { component: "mcu-1", pin: "3V3" } },
        { id: "c", from: { component: "sensor-1", pin: "GND" }, to: { component: "mcu-1", pin: "GND" } },
      ],
    };
    const layout = await layoutDiagram(many);
    const gates = layout.regions[0].gates;
    expect(gates).toHaveLength(3);
    expect(new Set(gates.map((g) => `${Math.round(g.x)},${Math.round(g.y)}`)).size).toBe(3);
  });

  test("wires between two regions go through a gate on each", async () => {
    const two: Diagram = {
      ...diagram,
      components: [
        { id: "sensor-1", type: "hall_sensor", region: "device" },
        { id: "mcu-1", type: "esp32", region: "cloud" },
      ],
      connections: [{ id: "c1", from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } }],
    };
    const layout = await layoutDiagram(two);
    expect(layout.regions.every((r) => r.gates.length === 1)).toBe(true);
    const points = layout.edges[0].points;
    for (const region of layout.regions) {
      const g = region.gates[0];
      expect(points.some((p) => Math.abs(p.x - g.x) <= 1 && Math.abs(p.y - g.y) <= 1)).toBe(true);
    }
  });

  test("wires leaving the same pin share one gate", async () => {
    const shared: Diagram = {
      ...diagram,
      components: [
        { id: "sensor-1", type: "hall_sensor", region: "device" },
        { id: "mcu-1", type: "esp32" },
        { id: "psu-1", type: "power_supply" },
      ],
      connections: [
        { id: "a", from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } },
        { id: "b", from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D5" } },
        { id: "c", from: { component: "sensor-1", pin: "GND" }, to: { component: "mcu-1", pin: "GND" } },
      ],
    };
    const layout = await layoutDiagram(shared);
    const gates = layout.regions[0].gates;
    expect(gates).toHaveLength(2);
    for (const id of ["a", "b"]) {
      const points = layout.edges.find((e) => e.id === id)!.points;
      expect(points.filter((p) => gates.some((g) => Math.abs(p.x - g.x) <= 1 && Math.abs(p.y - g.y) <= 1))).toHaveLength(1);
    }
  });
});
