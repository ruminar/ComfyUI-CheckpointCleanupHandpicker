# 🧹 Checkpoint Cleanup Handpicker for ComfyUI

おぬし！　おぬしはoutputに出力された結果画像を見ながら、

- これはいまいちな画像結果だからCheckpointを削除しようか？
- いやこれは別のプロンプトで神画像を出してくれたCheckpointだったはずだ、
- ・・・いや待てよ、それはこっちのCheckpointだったかな？？？、

と大混乱に陥ったりはしておらんか？

そんなおぬしを救うため、生成結果をその目で見ながら Checkpoint を厳選し、お気に入り登録や削除予約を安全に行えるカスタムノードを作ったのじゃ！<br/>
おぬし！ 大量にダウンロードしたモデルの整理に、もう時間やSSDを無駄にする必要はないぞ！

---

## 🌟 これで何ができるのじゃ？ (Features)

- **一目瞭然のプレビュー！**：
  - モデルごとに生成された過去の画像を自動で再帰検索し、最大64枚を1枚の軽量なコンタクトシートにしてノード上にドンと表示するぞ。
    - テキストノードでフルパスを指定することで、参照フォルダを自由に変更できるのじゃ。
      - JPEGに変換した後のファイルでも問題なく読み込めるぞ。
- **💛 お気に入り登録**：
  - 優秀なモデルは「お気に入り」に指定して、誤削除からガッチリ保護じゃ！
    - お気に入り設定はカスタムノードのディレクトリに置かれるため、永続的に有効じゃ。
    - たまたまプロンプトが拗ねた画像を出力してしまっても、間違えてお気に入りのCheckpointを削除してしまうような事故を避けられるぞ。
- **🗑️ 安全な削除予約**：
  - 不要なモデルはその場で直接消さず、まずは「削除予約」としてプール。
    - 後から人間の手で安全に大掃除できる仕組みじゃ。
    - 削除など、１度きりの判断で、そうそうするものでもないからな！

---

## 導入方法

ComfyUIの `custom_nodes` ディレクトリで、以下のコマンドを打ち込むのじゃ！

```bash
git clone https://github.com/ruminar/ComfyUI-CheckpointCleanupHandpicker.git
```

・・・早く`ComfyUI Manager`の自動巡回Botが来てくれぬかのう・・・

## 🛠️ 接続方法 (Node Input)

### 📦 Checkpoint Cleanup Review

このノードは [`ComfyUI-CheckpointNameCycler`](https://github.com/ruminar/ComfyUI-CheckpointNameCycler)** と組み合わせて使うことを前提にしておる。
先に導入しておくれなのじゃ。

**[`ComfyUI-CheckpointNameCycler`](https://github.com/ruminar/ComfyUI-CheckpointNameCycler)** から出力される以下の2本のワイヤーをそのまま接続してくりゃれ。

```text
ckpt_name_str  ──> CheckpointNameCycler が返す root からの相対パスじゃ
ckpt_name_safe ──> 画像検索のキーとして使う、ファイル名から記号を抜いた安全な名前じゃ
```

*例：*

* `ckpt_name_str`  = `data/foo_model.safetensors`
* `ckpt_name_safe` = `data_foo_model`

### 🔍 任意の検索ディレクトリ (Optional input)

* **`search_directory`**：ここにフォルダパス（STRING）を接続すると、そのディレクトリから画像を掘り起こすぞ。
* 未接続、または空文字の場合は、ComfyUI 標準の `output` ディレクトリを自動で検索する親切設計じゃ！

- ⚠️ **注意じゃ！** 自由なディレクトリ指定は「画像検索」にのみ使うぞ。Checkpoint本体の削除対象の解決には使わんから安心せよ。

<img width="1212" height="834" alt="image" src="https://github.com/user-attachments/assets/207af1e2-2b55-4a48-a426-1f3260aa0da3" />

---

## ⚙️ 賢い仕様の裏側 (How it works)

### 🕵️‍♂️ 画像を掘り起こすレーダー (Preview search)

- 対象フォルダは、サブディレクトリも含めて再帰検索するぞ。
- 「新しいフォルダ」「フォルダ内の新しい画像」を優先的にチェックするから、直近の成果を見逃さん！
- ファイル名に `ckpt_name_safe` が含まれる画像を探し出し、64件見つかった時点でスマートに探索を打ち切るのじゃ。
- 対象拡張子は `.png`, `.jpg`, `.jpeg`, `.webp` じゃ。

### 🎨 スッキリした画面構成 (UI)

操作ボタンや進捗表示は、すべてノード上部の入力ピン右側にコンパクトに横並びで表示されるぞ。
タイトルエリアに表示されたCheckpoint名を確認しながら、おぬしのお気に入りCheckpointを選べるようになっておる。
下部は画像プレビューのためだけの聖域（広大なエリア）じゃ。

### 🛡️ 鉄壁の安全設計 (Safety First!)

プロの運用保守の思想を取り入れた、エラーや誤操作でクラッシュ・激痛を見ないための防波堤じゃ！

- 🚫 **即時削除の禁止**：ノードのボタンを押しただけでは、実体ファイルは絶対に削除されん！
- 📝 **予約ログの作成**：削除予約は `temp/checkpoint_delete_queue.jsonl` に安全に記録されるだけじゃ。
- 🔒 **お気に入り保護**：💛お気に入り登録されたモデルは、システム的に削除予約ボタンが無効化されるぞ。
- 🔍 **生存確認バリデーション**：プレビュー画像が見つからない、またはファイルの実体を一意に解決できない怪しいモデルは、削除予約自体を弾く仕組みじゃ。
- 🖼️ **成果物の保護**：output にある生成済みの画像は、いかなる場合も絶対に削除せん！

---

## 💾 生成されるファイルたち (Persistent & Temporary)

### 💛 永続ファイル (Persistent)

お気に入り情報は以下のファイルにひっそり、しかし永続的に保存されるぞ（`.gitignore` に含めてあるから安心じゃ）。

```text
ComfyUI/custom_nodes/ComfyUI-CheckpointCleanupHandpicker/data/
└─ checkpoint_favorites.json
```

### ⏳ 一時ファイル (Temporary)

削除予約と、大掃除用のスクリプトは ComfyUI の `temp` ディレクトリに自動生成される。ここを掃除すると予約も綺麗に消え去るぞ。

```text
temp/
├─ checkpoint_delete_queue.jsonl
├─ delete_reserved_checkpoints.py     <-- これが魂のスクリプトじゃ！
└─ delete_reserved_checkpoints_plan.txt
```

`.jsonl` は1行に1件ずつJSONを追記するログ形式じゃ。
削除予約や取消の履歴を、安全に積み上げるために使っておる。

---

## 🚀 いざ、大掃除の時間じゃ！ (Running the delete script)

- 夜間バッチが終わり、朝の選別作業も完了したら、ComfyUI の `temp` ディレクトリに移動して、自動生成されたスクリプトをターミナルからおぬしの手で実行してくりゃれ！<br/>
  - もちろん、`temp` フォルダを消さぬ限り、スクリプトはずっと残っているから、気の向いたときに削除すれば良いように出来ておるのじゃ。

```bash
python delete_reserved_checkpoints.py
```

- 実行すると、スクリプト内でも **「本当に消してもよいな？（y/N）」** と1件ずつお伺いを立ててくる。
  - 何も入力せずに Enter を押せば削除はスキップされる。
- 最後の最後までおぬしの意思を尊重する、完璧な安全フローじゃ！
  - うまく動かない時はパスの設定を確認しておくれなのじゃ。

## 0.2.0: Checkpoint List Selector

おぬし！　おぬしはCheckpointの選択画面を見ながら、

- このCheckpoint、お気に入りに入れてたっけ？
- このCheckpoint、削除予定に入れてたっけ？
- なんでプレビューしないとステータスが判んないんだよ？
- しかもCheckpointが1行しか表示されなくて、100件以上Checkpointがあったら、選択するのが超・面倒くさいんですけど！

とか思ってはおらんかったか？

`Checkpoint List Selector` は、Checkpointに設定したステータスを、一覧の状態で確認できるCheckpoint選択ノードです。

### 出力される力

- `ckpt_name`
- `ckpt_name_str`
- `ckpt_name_safe`

`Checkpoint Cleanup Review` と接続すると、`CheckpointNameCycler` を使わずに手動で Checkpoint を選んで棚卸しできます。

また `ckpt_name` を使うことで、対応するワークフローでは選択中のCheckpointを画像生成側にも渡せます。

<img width="1215" height="796" alt="image" src="https://github.com/user-attachments/assets/20a63817-eb5e-4e52-b5ff-1499c73cd75d" />

### 状態表示

- 💛 お気に入り済み
- 🗑 削除予約済み
- 通常表示は未判定

### ボタン説明

- `🔄 Refresh All`: Checkpoint一覧の再取得、および Checkpointの設定ステータス読み込み
  - 削除バッチを使用したり、エクスプローラでCheckpointを配置するなど、ディレクトリ構成を変えた場合はこちらのボタンを押すのじゃ！
- `List Only`: Checkpointの設定ステータスだけ読み込むぞ。
  - Checkpoint Cleanup Reviewで、お気に入りの状態などを変更したら、このボタンを押してCheckpointのステータスを取り込んでおくれ。
- `▲`: リストを上にスクロールするぞ！
- `▼`: リストを下にスクロールするぞ！
  - 一応スクロールバーのドラッグやマウスホイールの回転にも対応しておるが、結局このボタンの連打が速いのじゃ（爆）


## 0.3.0 Checkpoint Status Tagger

おぬし！　おぬしは画像生成のバッチを回しながら、

- このCheckpoint、いまいちじゃん、後で確認して削除予約いれないとな
- 朝になったけど棚卸が面倒くさいな
- そもそも削除しようと思ったCheckpointの名前を忘れたぞ、画像をもう一回見ないと思い出せん！
- なんでバッチ実行中にお気に入りとか削除予定とか選べないんだよ、100個もCheckpointあったらそんなの覚えてらんないよ！

とか思ってはおらんかったか？

`Checkpoint Status Tagger` は、そんなおぬしのために、KSampler や Preview Tap で現在流れている画像を見ながら、その場で 💛 / 🗑 を付けられるカスタムノードじゃ。

Tagger はプレビュー画像探索を行わず、Checkpoint の状態操作に専念するｚｐ。

## 宣伝画像

<img width="1024" height="1536" alt="CheckpointCleanupHandpicker宣伝画像" src="https://github.com/user-attachments/assets/0477526a-a750-4e77-900f-72c1244b380c" />
<br/>
CheckpointListSelector宣伝画像
<img width="1448" height="1086" alt="CheckpointListSelector宣伝画像" src="https://github.com/user-attachments/assets/6c91580a-81eb-4215-9e81-bd7bb4f9d534" />
※ 画像生成ワークフローの開始ノードとする場合は、`ckpt_name`を`CheckpointLoaderSimple`につないでください。（そこだけ宣伝画像の図が間違ってます）
<br/>
CheckpointStatusTagger宣伝画像
<img width="1491" height="1055" alt="CheckpointStatusTagger宣伝画像" src="https://github.com/user-attachments/assets/26874b5b-1409-4be3-b292-65af8f5b52d8" />
※ CheckpointListSelectorへの反映は、`List Only`ボタンを押してください。(自動で反映する機能は将来実装予定です)
