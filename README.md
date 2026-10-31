# 非常食備蓄アプリ (LINE リッチメニュー + LIFF + GAS)

リッチメニューの「購入」「消費」→ LIFFページ(GitHub Pages)でJANをカメラ読取 → GAS Web APIがスプレッドシート/カレンダーを更新。

```
LINE リッチメニュー ─ https://liff.line.me/{LIFF_ID}?mode=buy|use
   └ index.html / app.js (GitHub Pages) ── POST ──> gas/API.gs (ウェブアプリ)
                                                     ├ 「リスト」シート(D列=JAN)
                                                     └ Googleカレンダー(期限通知は既存GASが送信)
```

## セットアップ手順

### 1. GAS
1. 既存の非常食チェックのGASプロジェクトに `gas/API.gs` を新規ファイルとして追加(既存コードは触らない)
2. プロジェクトの設定 → スクリプトプロパティに追加
   - `LIFF_CHANNEL_ID` = 手順3で作る **LINEログインチャネルのチャネルID**
   - (任意) `ALLOWED_USER_IDS` = 許可するuserIdのカンマ区切り
   - 既存の `CHANNEL_TOKEN` / `GROUP_ID` はそのまま使う
3. エディタで `hjSheet_` などではなく `doGet` を一度実行し、権限を承認
4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、実行:自分、アクセス:**全員** → URLを控える
   (コードを直したら「デプロイを管理」から新バージョンで再デプロイ)
5. 「リスト」シートのD1に `JAN` と入れておく(任意。D列にJANが入る)

### 2. GitHub Pages
1. GitHubで空のリポジトリを作成(例: `hijoshoku`、Public)
2. `config.js` の `GAS_URL` を手順1のURLに、`LIFF_ID` を手順3のIDに書き換え
3. このフォルダをpush → Settings → Pages → Branch: `main` / root
4. 公開URL(`https://<user>.github.io/hijoshoku/`)を控える

### 3. LIFF
LINE Developers → 公式LINEと**同じプロバイダー**で「LINEログイン」チャネルを作成(同一プロバイダーでないとuserIdが一致せずメンバー判定に失敗します)
- LIFFタブ → 追加: エンドポイントURL=手順2のURL、サイズ=Full、スコープ=`profile`
- 発行されたLIFF ID(`2000000000-xxxxxxxx`)を `config.js` に設定
- チャネルID(LIFFの前半10桁ではなく、チャネル基本設定のもの)を GASの `LIFF_CHANNEL_ID` に設定

### 4. リッチメニュー
```bash
CHANNEL_TOKEN=<公式LINEのチャネルアクセストークン> LIFF_ID=<LIFF ID> ./richmenu/setup.sh
```
※ 既存のデフォルトリッチメニューは置き換わります。

## 仕様
- 購入: JAN読取 → 登録済みならシートの商品名、なければ Open Food Facts、なければ手入力 → 個数・期限 → 登録
  - シートに追記(期限順に並び替え) + カレンダーに「商品名：N個」の終日予定
  - 同じJAN・同じ期限が既にあれば個数を加算し予定も更新
- 消費: JAN読取 → 在庫表示(なければ「登録されていない商品です」) → 個数 → 登録
  - 期限の早いロットから減算。0になった行は取り消し線、カレンダー予定は削除
- 操作できるのは通知グループのメンバーのみ(アクセストークンをGASで検証)
- 既存の27行にはJANが無いため、消費したい商品はD列にJANを入力するか、購入から登録し直す
