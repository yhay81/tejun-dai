import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { app, scheduled, type Bindings } from "../src/worker";

const migrationPath = fileURLToPath(new URL("../migrations/0001_events.sql", import.meta.url));
const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const stylesPath = fileURLToPath(new URL("../public/styles.css", import.meta.url));
const origin = "http://localhost";
const session = "a2d0e2f2-66fd-4fd4-8e87-b0ef67ad194a";

let miniflare: Miniflare;
let bindings: Bindings;

const eventRequest = (
  name: string,
  options: { body?: string; origin?: string; qa?: boolean; session?: string } = {},
) => ({
  body: options.body ?? JSON.stringify({ name }),
  headers: {
    "content-type": "application/json",
    origin: options.origin ?? origin,
    "x-tejun-qa": options.qa ? "1" : "0",
    "x-tejun-session": options.session ?? session,
  },
  method: "POST",
});

beforeEach(async () => {
  miniflare = new Miniflare({
    d1Databases: { DB: "tejun-dai-test" },
    modules: true,
    script: "export default { fetch() { return new Response('test') } }",
  });
  const database = await miniflare.getD1Database("DB");
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await database.prepare(statement).run();
  }
  bindings = {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as unknown as Fetcher,
    DB: database as unknown as D1Database,
  };
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("public pages", () => {
  it.each([
    ["/", 'class="workbench"', "https://tejun-dai.yhay81.com/"],
    ["/guide", 'class="guide-grid"', "https://tejun-dai.yhay81.com/guide"],
    ["/privacy", 'class="data-flow"', "https://tejun-dai.yhay81.com/privacy"],
  ])("%s は製品固有の画面を返す", async (path, marker, canonical) => {
    const response = await app.request(path, undefined, bindings);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(marker);
    expect(html).toContain(`href="${canonical}" rel="canonical"`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("編集画面は外部スクリプトと視覚的な作業台を使う", async () => {
    const response = await app.request("/", undefined, bindings);
    const html = await response.text();
    expect(html).toMatch(/<script defer(?:="")? src="\/app\.js"><\/script>/);
    expect(html).toContain('class="manual-paper"');
    expect(html).toContain('class="photo-drop"');
    expect(html).not.toMatch(/成功条件|市場スコア|公開実験/);
  });

  it("未知のページは404、静的アセットはASSETSへ渡す", async () => {
    const page = await app.request("/missing", undefined, bindings);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("その手順は見つかりません");
    const asset = await app.request("/unknown.css", undefined, bindings);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("asset");
  });
});

describe("anonymous telemetry", () => {
  it.each([
    "visited",
    "manual_started",
    "photo_added",
    "step_edited",
    "printed",
    "project_exported",
    "project_imported",
    "returned",
  ])("%s を許可する", async (name) => {
    const response = await app.request("/api/events", eventRequest(name), bindings);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
  });

  it("イベント名とセッションIDを許可リストで制限する", async () => {
    const event = await app.request("/api/events", eventRequest("photo_uploaded"), bindings);
    expect(event.status).toBe(400);
    expect(await event.json()).toMatchObject({ error: "invalid_event" });

    const invalidSession = await app.request(
      "/api/events",
      eventRequest("visited", { session: "not-a-session" }),
      bindings,
    );
    expect(invalidSession.status).toBe(400);
    expect(await invalidSession.json()).toMatchObject({ error: "invalid_session" });
  });

  it("JSON以外、不正JSON、1KB超の本文を拒否する", async () => {
    const media = await app.request(
      "/api/events",
      {
        body: "name=visited",
        headers: { "content-type": "text/plain", "x-tejun-session": session },
        method: "POST",
      },
      bindings,
    );
    expect(media.status).toBe(415);

    const malformed = await app.request(
      "/api/events",
      eventRequest("visited", { body: "{" }),
      bindings,
    );
    expect(malformed.status).toBe(400);

    const oversized = await app.request(
      "/api/events",
      eventRequest("visited", { body: JSON.stringify({ name: "x".repeat(1100) }) }),
      bindings,
    );
    expect(oversized.status).toBe(413);
  });

  it("別オリジンからの記録を拒否する", async () => {
    const response = await app.request(
      "/api/events",
      eventRequest("visited", { origin: "https://example.com" }),
      bindings,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "cross_site_request" });
  });

  it("自動QAイベントを実利用から分離する", async () => {
    await app.request("/api/events", eventRequest("printed", { qa: true }), bindings);
    await app.request("/api/events", eventRequest("printed"), bindings);
    const rows = await bindings.DB.prepare(
      "SELECT is_qa, COUNT(*) AS count FROM product_events GROUP BY is_qa ORDER BY is_qa",
    ).all<{ count: number; is_qa: number }>();
    expect(rows.results).toEqual([
      { count: 1, is_qa: 0 },
      { count: 1, is_qa: 1 },
    ]);
  });

  it("45日を過ぎた計測だけを削除する", async () => {
    const now = Math.floor(Date.now() / 1000);
    await bindings.DB.prepare(
      `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
       VALUES ('visited', ?, '2026-01-01', ?, 0), ('visited', ?, '2026-07-30', ?, 0)`,
    )
      .bind(session, now - 46 * 86400, session, now)
      .run();
    await scheduled({} as ScheduledController, bindings, {} as ExecutionContext);
    const row = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM product_events").first<{
      count: number;
    }>();
    expect(row?.count).toBe(1);
  });
});

describe("local-first editor contract", () => {
  it("本文と写真を送らず、端末内の編集・縮小・持ち出しだけを行う", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(source).toContain('fetch("/api/events"');
    expect(source).toContain("localStorage");
    expect(source).toContain("createImageBitmap");
    expect(source).toContain("canvas.toBlob");
    expect(source).toContain("const maximumSteps = 12");
    expect(source).toContain(".tejundai");
    expect(source).toContain("window.print()");
    expect(source).not.toMatch(/innerHTML|eval\(|new Function/);
  });

  it("A4印刷と4手順ごとの改ページを固定する", async () => {
    const [source, styles] = await Promise.all([
      readFile(appPath, "utf8"),
      readFile(stylesPath, "utf8"),
    ]);
    expect(source).toContain("const stepsPerPage = 4");
    expect(styles).toContain("size: A4");
    expect(styles).toContain("@media print");
    expect(styles).toMatch(/width:\s*210mm/);
    expect(styles).toMatch(/min-height:\s*297mm/);
  });
});
