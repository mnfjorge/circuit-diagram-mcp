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
});
