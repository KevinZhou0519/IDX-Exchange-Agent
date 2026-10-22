import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("core package boundary", () => {
  it("core never imports openclaw", () => {
    const files = sourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => readFileSync(file, "utf8").includes('from "openclaw'));
    expect(offenders).toEqual([]);
  });
});
