import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Before any module reads CEZANE_HOME (cache, library, registry): a throwaway home.
const home = mkdtempSync(join(tmpdir(), "cezane-test-home-"));
process.env.CEZANE_HOME = home;
// In a preload, afterAll runs once, after every test file.
afterAll(() => rmSync(home, { recursive: true, force: true }));
