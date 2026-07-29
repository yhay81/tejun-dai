# Metrics

- `visited`: 製品を開いた
- `manual_started`: 最初の手順内容を変更した
- `photo_added`: 写真を1枚以上追加した
- `step_edited`: 2番目以降の手順を編集した
- `printed`: 印刷/PDF保存画面を開いた
- `project_exported`: 編集用ファイルを書き出した
- `project_imported`: 編集用ファイルを読み込んだ
- `returned`: 別の日に再訪した

各イベントは匿名ブラウザIDとJST日付だけを伴います。`x-tejun-qa: 1` は実利用集計から
除外し、全イベントを45日後に削除します。
