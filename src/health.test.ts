import { describe, it, expect } from "vitest";
import { server } from "./index";

describe("health server", () => {
  it("creates an http server instance", () => {
    expect(server).toBeDefined();
  });
});
