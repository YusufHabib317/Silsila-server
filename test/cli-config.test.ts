import { describe, expect, it } from "bun:test";

import { parsePortArgument } from "../src/config/cli.ts";

describe("parsePortArgument", () => {
  it("reads short port arguments", () => {
    expect(parsePortArgument(["bun", "src/main.ts", "-p", "3004"])).toBe(3004);
  });

  it("reads long port arguments", () => {
    expect(parsePortArgument(["bun", "src/main.ts", "--port", "3005"])).toBe(
      3005,
    );
  });

  it("reads long equals port arguments", () => {
    expect(parsePortArgument(["bun", "src/main.ts", "--port=3006"])).toBe(3006);
  });

  it("returns undefined when no port argument is present", () => {
    expect(parsePortArgument(["bun", "src/main.ts"])).toBeUndefined();
  });

  it("rejects invalid port arguments", () => {
    expect(() => parsePortArgument(["bun", "src/main.ts", "-p", "70000"]))
      .toThrow("between 1 and 65535");
  });
});
