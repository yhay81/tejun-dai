import { Hono } from "hono";
import type { Context } from "hono";
import { requestId } from "hono/request-id";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
};

type Variables = { requestId: string };
type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 413 | 415,
  ) {
    super(code);
  }
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventNames = new Set([
  "visited",
  "manual_started",
  "photo_added",
  "step_edited",
  "printed",
  "project_exported",
  "project_imported",
  "returned",
]);

const nowSeconds = () => Math.floor(Date.now() / 1000);
const jstDay = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const enforceSameOrigin = (c: AppContext) => {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new ApiError("cross_site_request", 403);
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    throw new ApiError("cross_site_request", 403);
  }
};

const parseJson = async (c: AppContext) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError("unsupported_media_type", 415);
  }
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > 1024) throw new ApiError("payload_too_large", 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 1024) {
    throw new ApiError("payload_too_large", 413);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("invalid_json", 400);
  }
};

const Layout = ({
  canonical,
  children,
  description,
  script,
  title,
}: {
  canonical: string;
  children: unknown;
  description: string;
  script?: string;
  title: string;
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta content="width=device-width, initial-scale=1" name="viewport" />
      <title>{title}</title>
      <meta content={description} name="description" />
      <link href={canonical} rel="canonical" />
      <meta content="index,follow" name="robots" />
      <meta content="website" property="og:type" />
      <meta content={title} property="og:title" />
      <meta content={description} property="og:description" />
      <meta content={canonical} property="og:url" />
      <meta content="https://tejun-dai.yhay81.com/og.svg" property="og:image" />
      <meta content="#30465b" name="theme-color" />
      <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/manifest.webmanifest" rel="manifest" />
      <link href="/styles.css" rel="stylesheet" />
      {script ? <script defer src={script}></script> : null}
    </head>
    <body>
      <header class="site-header">
        <a class="brand" href="/" aria-label="手順台 ホーム">
          <span class="brand-mark" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>手順台</span>
        </a>
        <nav aria-label="補助ページ">
          <a href="/guide">使い方</a>
          <a href="/privacy">写真の扱い</a>
        </nav>
      </header>
      {children}
      <footer>
        <span>手順台</span>
        <span>写真も本文も端末の中だけ</span>
        <a href="https://github.com/yhay81/tejun-dai">GitHub</a>
      </footer>
    </body>
  </html>
);

const ToolIcon = ({ children, label }: { children: unknown; label: string }) => (
  <div class="tool-icon">
    <span aria-hidden="true">{children}</span>
    <small>{label}</small>
  </div>
);

const EditorPage = () => (
  <Layout
    canonical="https://tejun-dai.yhay81.com/"
    description="写真、番号、注意札を並べ、作業手順をA4・PDFへ整えます。入力は端末の中だけで処理します。"
    script="/app.js"
    title="手順台｜写真から作業手順書をつくる"
  >
    <main class="workbench" data-page="editor">
      <section class="workbench-toolbar" aria-label="手順書の操作">
        <div class="toolbar-group">
          <button class="tool-button" data-action="sample" type="button">
            <span aria-hidden="true">▦</span>見本
          </button>
          <button class="tool-button" data-action="import" type="button">
            <span aria-hidden="true">↙</span>読込
          </button>
          <button class="tool-button" data-action="export" type="button">
            <span aria-hidden="true">↗</span>編集用保存
          </button>
          <input accept=".tejundai,application/json" data-import-input hidden type="file" />
        </div>
        <div class="save-state" aria-live="polite" data-save-state>
          <i></i>
          <span>端末内に自動保存</span>
        </div>
        <div class="toolbar-group right">
          <button class="tool-button muted" data-action="reset" type="button">
            白紙
          </button>
          <button class="print-button" data-action="print" type="button">
            <span aria-hidden="true">▣</span>印刷・PDF
          </button>
        </div>
      </section>

      <div class="workbench-grid">
        <aside class="parts-rail" aria-label="手順書の要素">
          <p class="rail-label">PARTS</p>
          <ToolIcon label="写真">▧</ToolIcon>
          <ToolIcon label="番号">①</ToolIcon>
          <ToolIcon label="注意">!</ToolIcon>
          <ToolIcon label="完了">✓</ToolIcon>
          <div class="privacy-lock">
            <span aria-hidden="true">⌂</span>
            <small>端末内</small>
          </div>
        </aside>

        <section class="edit-panel" aria-label="手順書の編集">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">MANUAL PARTS</p>
              <h1>手順の材料</h1>
            </div>
            <span class="step-count" data-step-count>
              1 / 12
            </span>
          </div>

          <div class="meta-fields">
            <label>
              手順書名
              <input data-field="title" maxlength={64} placeholder="例：閉店後のレジ締め" />
            </label>
            <div class="two-fields">
              <label>
                対象
                <input data-field="audience" maxlength={40} placeholder="例：遅番担当" />
              </label>
              <label>
                目安
                <input data-field="duration" maxlength={24} placeholder="例：10分" />
              </label>
            </div>
            <label>
              準備するもの
              <input data-field="tools" maxlength={120} placeholder="例：集計表、鍵、封筒" />
            </label>
          </div>

          <div class="step-list" data-step-list></div>
          <button class="add-step" data-action="add-step" type="button">
            <span aria-hidden="true">＋</span>手順を追加
          </button>

          <label class="completion-field">
            <span>✓ 完了の目印</span>
            <textarea
              data-field="completion"
              maxlength={180}
              placeholder="例：日計と現金が一致し、金庫を施錠したら完了"
            ></textarea>
          </label>
          <p class="local-note">
            写真と文字はアップロードされません。安全や法令に関わる手順は責任者が確認してください。
          </p>
        </section>

        <section class="preview-panel" aria-label="A4プレビュー">
          <div class="preview-bar">
            <div>
              <p class="eyebrow">A4 PREVIEW</p>
              <strong>仕上がり</strong>
            </div>
            <div class="zoom-control">
              <button aria-label="縮小" data-action="zoom-out" type="button">
                −
              </button>
              <span data-zoom-label>72%</span>
              <button aria-label="拡大" data-action="zoom-in" type="button">
                ＋
              </button>
            </div>
          </div>
          <div class="paper-scroll">
            <div class="manual-paper" data-manual-paper>
              <div class="manual-head">
                <div class="manual-code">
                  <span>WORK</span>
                  <b>01</b>
                </div>
                <div>
                  <p data-preview-audience>対象を入力</p>
                  <h2 data-preview-title>手順書名を入力</h2>
                </div>
                <div class="manual-duration">
                  <small>目安</small>
                  <strong data-preview-duration>—</strong>
                </div>
              </div>
              <div class="manual-tools">
                <span>準備</span>
                <p data-preview-tools>必要な道具を入力</p>
              </div>
              <div class="manual-steps" data-preview-steps></div>
              <div class="manual-completion">
                <span class="complete-seal">完</span>
                <div>
                  <small>完了の目印</small>
                  <p data-preview-completion>完了条件を入力</p>
                </div>
              </div>
              <div class="manual-foot">
                <span>手順台で作成</span>
                <span data-preview-date></span>
                <span>写真・本文は端末内処理</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <template id="step-editor-template">
        <article class="step-editor">
          <div class="step-editor-head">
            <span class="drag-handle" aria-hidden="true">
              ⠿
            </span>
            <strong data-step-number></strong>
            <div class="step-actions">
              <button aria-label="一つ上へ" data-step-action="up" type="button">
                ↑
              </button>
              <button aria-label="一つ下へ" data-step-action="down" type="button">
                ↓
              </button>
              <button aria-label="手順を複製" data-step-action="duplicate" type="button">
                ＋
              </button>
              <button aria-label="手順を削除" data-step-action="remove" type="button">
                ×
              </button>
            </div>
          </div>
          <div class="step-editor-body">
            <label class="photo-drop">
              <input
                accept="image/jpeg,image/png,image/webp"
                data-step-field="photo"
                hidden
                type="file"
              />
              <span class="photo-placeholder">
                <b>＋</b>
                <small>写真を置く</small>
              </span>
              <img alt="" data-step-photo />
              <span class="focus-hint">写真を押して見せたい位置を指定</span>
              <i class="focus-dot" data-focus-dot></i>
            </label>
            <div class="step-fields">
              <label>
                見出し
                <input data-step-field="title" maxlength={48} placeholder="何をするか" />
              </label>
              <label>
                やり方
                <textarea
                  data-step-field="body"
                  maxlength={220}
                  placeholder="迷わない短い文で"
                ></textarea>
              </label>
              <label>
                注意札
                <select data-step-field="flag">
                  <option value="none">なし</option>
                  <option value="check">確認</option>
                  <option value="caution">注意</option>
                  <option value="stop">禁止</option>
                </select>
              </label>
              <label data-note-label hidden>
                注意内容
                <input data-step-field="note" maxlength={100} placeholder="間違えやすい点" />
              </label>
            </div>
          </div>
        </article>
      </template>
    </main>
  </Layout>
);

const GuidePage = () => (
  <Layout
    canonical="https://tejun-dai.yhay81.com/guide"
    description="写真つき作業手順書を作り、印刷・PDF・編集用ファイルへ保存する流れです。"
    title="使い方｜手順台"
  >
    <main class="info-page">
      <div class="info-heading">
        <div class="mini-paper" aria-hidden="true">
          <i>1</i>
          <i>2</i>
          <i>3</i>
        </div>
        <div>
          <p class="eyebrow">FOUR MOVES</p>
          <h1>写真を置いて、番号で渡す。</h1>
        </div>
      </div>
      <ol class="guide-grid">
        <li>
          <b>01</b>
          <div>
            <h2>写真を選ぶ</h2>
            <p>各手順へ1枚ずつ。写真は端末内で縮小し、外へ送りません。</p>
          </div>
        </li>
        <li>
          <b>02</b>
          <div>
            <h2>短い文を添える</h2>
            <p>「何をするか」と「どうするか」を分け、確認・注意・禁止の札を付けます。</p>
          </div>
        </li>
        <li>
          <b>03</b>
          <div>
            <h2>仕上がりを確かめる</h2>
            <p>A4プレビューを見ながら順番、準備物、完了条件を揃えます。</p>
          </div>
        </li>
        <li>
          <b>04</b>
          <div>
            <h2>手元へ保存する</h2>
            <p>印刷/PDFは配布用、編集用保存は後日直すための控えです。</p>
          </div>
        </li>
      </ol>
      <section class="boundary-card">
        <span class="boundary-icon">!</span>
        <div>
          <h2>承認済みの正本は別に保つ</h2>
          <p>
            医療、食品衛生、危険物、機械安全、法定点検などは、責任者が承認した正本と改訂履歴を使ってください。手順台は内容の安全性や法令適合性を判断しません。
          </p>
        </div>
      </section>
    </main>
  </Layout>
);

const PrivacyPage = () => (
  <Layout
    canonical="https://tejun-dai.yhay81.com/privacy"
    description="手順台で写真と本文を端末内だけに保つ仕組みと削除方法です。"
    title="写真の扱い｜手順台"
  >
    <main class="info-page">
      <div class="info-heading">
        <div class="device-lock" aria-hidden="true">
          <span>▧</span>
          <i>⌂</i>
        </div>
        <div>
          <p class="eyebrow">STAYS ON DEVICE</p>
          <h1>作業写真は、送らない。</h1>
        </div>
      </div>
      <div class="data-flow">
        <div>
          <span class="flow-photo">▧</span>
          <b>写真・本文</b>
          <small>選んだ端末</small>
        </div>
        <span class="flow-arrow">→</span>
        <div class="flow-device">
          <span>⌂</span>
          <b>ブラウザ内</b>
          <small>縮小・編集・自動保存</small>
        </div>
        <span class="flow-arrow blocked">×</span>
        <div class="flow-server">
          <span>☁</span>
          <b>サーバー</b>
          <small>内容は送信しない</small>
        </div>
      </div>
      <section class="privacy-copy">
        <h2>保存と削除</h2>
        <p>
          編集内容はこのブラウザのサイトデータにだけ自動保存されます。共有端末では「白紙」を実行してください。ブラウザ設定からサイトデータを削除しても消去できます。
        </p>
        <h2>匿名の利用計測</h2>
        <p>
          改善判断のため、ランダムなブラウザID、許可済みの操作名、日付だけを45日間保存します。写真、本文、ファイル名、画像サイズ、手順数、会社名は含めません。
        </p>
      </section>
    </main>
  </Layout>
);

app.use("*", requestId());
app.use("*", async (c, next) => {
  await next();
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});

app.get("/", (c) => c.html(<EditorPage />));
app.get("/guide", (c) => c.html(<GuidePage />));
app.get("/privacy", (c) => c.html(<PrivacyPage />));

app.post("/api/events", async (c) => {
  enforceSameOrigin(c);
  const sessionId = c.req.header("x-tejun-session") ?? "";
  if (!sessionPattern.test(sessionId)) throw new ApiError("invalid_session", 400);
  const payload = await parseJson(c);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError("invalid_request", 400);
  }
  const name = (payload as Record<string, unknown>).name;
  if (typeof name !== "string" || !eventNames.has(name)) {
    throw new ApiError("invalid_event", 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      sessionId.toLowerCase(),
      jstDay(),
      nowSeconds(),
      c.req.header("x-tejun-qa") === "1" ? 1 : 0,
    )
    .run();
  return c.json({ accepted: true }, 202);
});

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/") || !/\.[a-z0-9]{2,8}$/iu.test(c.req.path)) {
    return c.html(
      <Layout
        canonical="https://tejun-dai.yhay81.com/"
        description="指定されたページは見つかりませんでした。"
        title="見つかりません｜手順台"
      >
        <main class="not-found">
          <div class="mini-paper" aria-hidden="true">
            <i>?</i>
          </div>
          <h1>その手順は見つかりません。</h1>
          <a class="home-link" href="/">
            作業台へ戻る
          </a>
        </main>
      </Layout>,
      404,
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, requestId: c.get("requestId") }, error.status);
  }
  console.error("unhandled_error", {
    message: error instanceof Error ? error.message : String(error),
    requestId: c.get("requestId"),
  });
  return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at <= ?")
    .bind(nowSeconds() - 45 * 86400)
    .run();
};

export { app, scheduled };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
