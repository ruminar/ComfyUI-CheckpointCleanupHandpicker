# Release Notes

## 0.1.0

初回リリースじゃ！

`Checkpoint Cleanup Handpicker` は、生成済み画像を確認しながら Checkpoint を厳選し、💛お気に入り登録や 🗑削除予約を安全に行うための ComfyUI カスタムノードです。

---

## 追加

`Checkpoint List Selector`ノードを追加。

- Checkpointの一覧表示
- Checkpointに設定されているステータスを確認
- プレビューへの接続の他、画像生成フローへの接続をサポート。

## 機能

### Checkpoint Cleanup Review ノード

- `CheckpointNameCycler` と連携し、現在選択されている Checkpoint の情報を受け取れるようにしました。
- 以下の入力に対応しました。
  - `ckpt_name_str`
  - `ckpt_name_safe`
  - `search_directory`（任意）
- `search_directory` が未接続、または空文字の場合は ComfyUI 標準の `output` ディレクトリを検索します。
- `search_directory` が指定された場合は、そのディレクトリを画像検索対象として使用します。

### 生成画像プレビュー

- `ckpt_name_safe` を含む生成済み画像を検索し、ノード上にコンタクトシートとして表示します。
- サブディレクトリを再帰検索します。
- 新しいフォルダを優先し、各フォルダ内でも新しい画像を優先して検索します。
- 最大64枚までの画像を表示します。
- 対象画像形式は以下です。
  - `.png`
  - `.jpg`
  - `.jpeg`
  - `.webp`
- プレビュー画像はメモリ上で作成され、ComfyUI の `temp` や `output` には保存されません。

### UI

- 操作ボタンをノード上部の入力ピン右側に配置しました。
- 以下の操作ボタンを追加しました。
  - `💛 お気に入り`
  - `解除`
  - `🗑 削除予約`
  - `予約取消`
- 進捗表示をノード上部に表示するようにしました。
- ノード下部は画像プレビュー専用エリアとして使います。
- ノードタイトルに現在の Checkpoint 名と状態を表示します。

### お気に入り機能

- Checkpoint をお気に入りとして登録できるようにしました。
- お気に入り登録された Checkpoint は削除予約できません。
- お気に入り情報は以下に保存されます。

```text
ComfyUI/custom_nodes/ComfyUI-CheckpointCleanupHandpicker/data/
└─ checkpoint_favorites.json
````

### 削除予約機能

* Checkpoint を直接削除せず、削除予約として記録できるようにしました。
* 削除予約は以下に記録されます。

```text
temp/
└─ checkpoint_delete_queue.jsonl
```

* 削除予約の取消にも対応しました。
* 削除予約や取消は JSON Lines 形式で追記されます。

### 安全削除スクリプト

* 削除予約に基づいて、以下のファイルを ComfyUI の `temp` ディレクトリに自動生成します。

```text
temp/
├─ checkpoint_delete_queue.jsonl
├─ delete_reserved_checkpoints.py
└─ delete_reserved_checkpoints_plan.txt
```

* `delete_reserved_checkpoints.py` を実行すると、削除対象を1件ずつ確認できます。
* 確認プロンプトは `y/N` 形式です。
* `y` を入力した場合のみ削除します。
* Enter のみ、または `y` 以外の入力では削除をスキップします。
* 削除対象は Checkpoint 本体の `.safetensors` と、同名の `.json` です。
* `output` にある生成済み画像は削除しません。

---

## 安全設計

このノードは、Checkpoint を直接削除しません。

削除は以下の流れで行われます。

```text
ノード上で削除予約
↓
temp/checkpoint_delete_queue.jsonl に記録
↓
delete_reserved_checkpoints.py を自動生成
↓
ユーザーが手動でスクリプトを実行
↓
y/N 確認後、y の場合のみ削除
```

また、以下の場合は削除予約できません。

* Checkpoint の実体ファイルを一意に解決できない場合
* プレビュー画像が見つからない場合
* Checkpoint がお気に入り登録されている場合

---

## 注意

* 0.1.0 では `CheckpointNameCycler` との連携を前提にしています。
* 今後のバージョンでは、Checkpoint 一覧から手動選択できるノードの追加を検討しています。
* `temp` ディレクトリを削除すると、削除予約情報も消えます。

---

## Known limitations

* Checkpoint の一覧選択UIはまだありません。
* 0.1.0 では `ckpt_name_str` と `ckpt_name_safe` を出力できる外部ノードとの接続が必要です。
* 複数の checkpoint root に同じ相対パスの Checkpoint がある場合、削除予約は安全のため無効になります。

