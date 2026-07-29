# 手順台

写真、番号、注意札を並べ、1件の作業手順をA4/PDFへ整える日本語Webツールです。

- 画像と本文はブラウザ内だけで処理します。
- 登録、アップロード、外部共有、受講履歴はありません。
- 編集用 `.tejundai` ファイルと印刷/PDFで手元へ持ち出せます。
- Cloudflare Workers、Hono JSX、Vite+で配信し、D1には匿名の利用イベントだけを保存します。

## 開発

```powershell
npm install
npm run check
npm test
npm run build
```
