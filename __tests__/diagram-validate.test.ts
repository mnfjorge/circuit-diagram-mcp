import { validateDiagram } from "../lib/diagram/validate";

const baseDiagram = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  components: [
    { id: "sensor-1", type: "hall_sensor" },
    { id: "mcu-1", type: "esp32" },
  ],
  connections: [{ from: { component: "sensor-1", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } }],
};

describe("validateDiagram", () => {
  test("accepts a well-formed diagram", () => {
    const result = validateDiagram(baseDiagram);
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  test("rejects a diagram that fails the JSON Schema (missing required field)", () => {
    const result = validateDiagram({ id: baseDiagram.id, components: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("rejects an unknown component type", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [{ id: "x1", type: "not_a_real_type" }],
      connections: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown type "not_a_real_type"'))).toBe(true);
  });

  test("rejects a connection referencing a pin that doesn't exist on the component's type", () => {
    const result = validateDiagram({
      ...baseDiagram,
      connections: [{ from: { component: "sensor-1", pin: "NOT_A_PIN" }, to: { component: "mcu-1", pin: "D4" } }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pin "NOT_A_PIN"'))).toBe(true);
  });

  test("rejects a connection referencing a component id that doesn't exist in the diagram", () => {
    const result = validateDiagram({
      ...baseDiagram,
      connections: [{ from: { component: "ghost", pin: "OUT" }, to: { component: "mcu-1", pin: "D4" } }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown component id "ghost"'))).toBe(true);
  });

  test("rejects duplicate component ids", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        { id: "dup", type: "hall_sensor" },
        { id: "dup", type: "esp32" },
      ],
      connections: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate component id "dup"'))).toBe(true);
  });

  test("accepts an unknown type when given a valid inline definition", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        {
          id: "x1",
          type: "bmp280",
          definition: {
            label: "BMP280 Pressure Sensor",
            category: "sensor",
            pins: [{ name: "VCC" }, { name: "GND" }, { name: "SDA" }, { name: "SCL" }],
          },
        },
        { id: "mcu-1", type: "esp32" },
      ],
      connections: [{ from: { component: "x1", pin: "SDA" }, to: { component: "mcu-1", pin: "D4" } }],
    });
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  test("rejects an inline definition with duplicate pin names", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        {
          id: "x1",
          type: "bmp280",
          definition: {
            label: "BMP280 Pressure Sensor",
            category: "sensor",
            pins: [{ name: "VCC" }, { name: "VCC" }],
          },
        },
      ],
      connections: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate pin names"))).toBe(true);
  });

  test("rejects an inline definition that shadows an already-registered type", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        {
          id: "x1",
          type: "esp32",
          definition: {
            label: "Fake ESP32",
            category: "microcontroller",
            pins: [{ name: "FOO" }],
          },
        },
      ],
      connections: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("already registered"))).toBe(true);
  });

  test("rejects conflicting inline definitions for the same ad-hoc type", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        {
          id: "x1",
          type: "bmp280",
          definition: { label: "BMP280", category: "sensor", pins: [{ name: "VCC" }] },
        },
        {
          id: "x2",
          type: "bmp280",
          definition: { label: "BMP280", category: "sensor", pins: [{ name: "GND" }] },
        },
      ],
      connections: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("different inline"))).toBe(true);
  });

  test("rejects an inline definition with an invalid category", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        {
          id: "x1",
          type: "bmp280",
          definition: { label: "BMP280", category: "not_a_real_category", pins: [{ name: "VCC" }] },
        },
      ],
      connections: [],
    });
    expect(result.valid).toBe(false);
  });

  test("allows multiple connections to share the same pin (e.g. a shared ground)", () => {
    const result = validateDiagram({
      ...baseDiagram,
      components: [
        { id: "sensor-1", type: "hall_sensor" },
        { id: "sensor-2", type: "hall_sensor" },
        { id: "mcu-1", type: "esp32" },
      ],
      connections: [
        { from: { component: "sensor-1", pin: "GND" }, to: { component: "mcu-1", pin: "GND" } },
        { from: { component: "sensor-2", pin: "GND" }, to: { component: "mcu-1", pin: "GND" } },
      ],
    });
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });
});
