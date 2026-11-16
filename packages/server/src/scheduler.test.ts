import { describe, expect, test } from "bun:test";
import { Scheduler } from "./jobs";

/** A job that runs until `release()` is called. */
function gate() {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
}

describe("global scheduler", () => {
  test("captures run one at a time across projects, even if asked for more", async () => {
    const s = new Scheduler({ capture: 4 });
    expect(s.limits.capture).toBe(1);
    const a = gate();
    const b = gate();
    const order: string[] = [];
    const ja = s.add("p1", "capture", "sim A", async () => {
      order.push("A start");
      await a.p;
      order.push("A end");
    });
    const jb = s.add("p2", "capture", "web B", async () => {
      order.push("B start");
      await b.p;
      order.push("B end");
    });
    await Bun.sleep(10);
    expect(s.jobs().map((j) => j.status)).toEqual(["running", "queued"]);
    b.release(); // B cannot finish before it starts
    await Bun.sleep(10);
    expect(order).toEqual(["A start"]);
    a.release();
    await Promise.all([ja, jb]);
    expect(order).toEqual(["A start", "A end", "B start", "B end"]);
    expect(s.jobs("p2")[0]!.status).toBe("done");
  });

  test("several montage renders in parallel, one per project, under the global limit", async () => {
    const s = new Scheduler({ render: 2 });
    const gates = [gate(), gate(), gate(), gate()];
    const jobs = [
      s.add("p1", "render", "p1 v1", () => gates[0]!.p),
      s.add("p1", "render", "p1 v2", () => gates[1]!.p),
      s.add("p2", "render", "p2 v1", () => gates[2]!.p),
      s.add("p3", "render", "p3 v1", () => gates[3]!.p),
    ];
    await Bun.sleep(10);
    const status = () => s.jobs().map((j) => `${j.label}:${j.status}`);
    expect(status()).toEqual(["p1 v1:running", "p1 v2:queued", "p2 v1:running", "p3 v1:queued"]);
    gates[0]!.release();
    await Bun.sleep(10);
    expect(status()).toEqual(["p1 v1:done", "p1 v2:running", "p2 v1:running", "p3 v1:queued"]);
    for (const g of gates) g.release();
    await Promise.all(jobs);
    expect(s.jobs().every((j) => j.status === "done")).toBe(true);
  });

  test("each project sees its own jobs; a queued job can be cancelled; listeners per project", async () => {
    const s = new Scheduler();
    let p1Changes = 0;
    s.listen("p1", () => p1Changes++);
    const g = gate();
    const first = s.add("p1", "cutout", "a", () => g.p);
    const second = s.add("p2", "cutout", "b", async () => ({ assetId: "x" }));
    expect(s.jobs("p1").length).toBe(1);
    s.cancel(s.jobs("p2")[0]!.id);
    expect((await second).error).toBe("cancelled");
    g.release();
    expect((await first).status).toBe("done");
    expect(p1Changes).toBeGreaterThan(0);
    const failed = await s.add("p1", "ingest", "boom", async () => {
      throw new Error("boom");
    });
    expect(failed.status).toBe("error");
    expect(failed.projectId).toBe("p1");
  });
});
