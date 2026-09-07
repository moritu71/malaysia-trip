# マレーシア研修旅行アプリ — 仕組み

バージョン 2.6 / content rev 4 時点。


## 1. 全体像

GitHub Pages に静的ファイルを置いただけのサイトです。サーバー処理も
データベースもありません。iPhone の「ホーム画面に追加」で
PWA（Progressive Web App）として動き、Service Worker が
ファイルを端末内に保持するのでオフラインでも起動します。

    GitHub リポジトリ (moritu71/malaysia-trip)
        │  git push
        ▼
    GitHub Pages (https://moritu71.github.io/malaysia-trip/)
        │  一度だけ取得 → 端末内にコピー
        ▼
    iPhone ホーム画面アプリ ── 以後オフラインで動作


## 2. ファイル構成

| ファイル | サイズ | 役割 |
|---|---|---|
| `index.html` | 112 KB | アプリ本体。HTML・CSS・JS が全部入り |
| `content.json` | 13.8 KB | やること・持ち物の中身。スマホから編集する対象 |
| `sw.js` | 2.3 KB | Service Worker。オフライン動作 |
| `version.json` | 201 B | 版番号。端末はこれを見て更新を判断 |
| `manifest.webmanifest` | 594 B | アプリ名・アイコン・全画面表示の定義 |
| `icon-180/192/512.png` | 計 25 KB | ホーム画面アイコン |

外部ライブラリはゼロ。CDN も読み込まないので、
ネットが無くても表示が崩れません。


## 3. なぜホーム画面アプリにする必要があったか

iOS には次の制約があります。

- ファイルアプリのクイックルックは **JavaScript を実行しない**
- Safari で `file://` のローカル HTML を開けない
- Service Worker は **https か localhost でしか登録できない**

3つ目は仕様です。中間者攻撃で悪意ある Service Worker を仕込まれると、
そのオリジンの通信を永続的に乗っ取られるため、平文 HTTP では禁止されています。
`file://` にはオリジンの概念がなくスコープを定義できません。

このため「一度だけ https の置き場に上げる」工程が避けられませんでした。


## 4. オフラインで動く仕組み

### Service Worker

ページとネットワークの間に挟まる、独立スレッドで動くスクリプトです。
一度 `register()` するとページを閉じても**オリジン単位で端末に常駐**します。

`install` イベントで `cache.addAll()` を呼び、6ファイルを
**Cache Storage** に丸ごと保存します。これは HTTP キャッシュとは別の、
JavaScript から明示的に操作できる領域で、有効期限もサーバーの
`Cache-Control` も関係ありません。

`fetch` イベントを購読しているので、アプリが出す GET は全部 sw.js を通ります。

```
アイコンをタップ
      ↓
Service Worker が fetch を横取り
      ↓
Cache Storage にある？ ── ある → それを返す（通信ゼロ）
      │
      └ ない → ネットワークへ（オフラインなら失敗）
```

### 通信を最小化した2つの工夫

**1. キャッシュヒットで即 return**

初期の実装は stale-while-revalidate（キャッシュを返しつつ裏で再取得）
でした。これだと起動のたびに全ファイルを取り直します。今は
ヒットしたらそこで終わりで、裏での再取得をしません。

**2. 起動時に `register()` を呼ばない**

`register()` は、それ自体が sw.js の取得を発生させます。今は
`navigator.serviceWorker.controller` を見て、すでに制御下なら
`getRegistration()` だけを呼びます。これは端末内のレジストリを
引くだけで通信しません。

**3. 外部 API は横取りしない**

```js
if (u.origin !== self.location.origin) return;
```

為替・天気の API は Service Worker を素通りさせ、
`index.html` へのフォールバックが返らないようにしています。


## 5. 通信が発生する箇所（全部で4つ）

| 操作 | 通信先 | タイミング |
|---|---|---|
| オフライン用に保存する | 自サイト | 最初の1回だけ |
| 更新を確認する | `version.json` → `content.json` | ボタンを押したとき |
| 最新の情報を取得 | Frankfurter / Open-Meteo | ボタンを押したとき |
| GitHubで編集 | github.com | リンクを開いたとき（アプリ外） |

**起動しただけでは一切通信しません。**

唯一の例外として、ブラウザ自体が sw.js の中身が変わっていないかを
24時間に1回程度チェックします。約2KB で、アプリ側からは止められません。

### 使っている外部 API

どちらも API キー不要・無料・CORS 対応です。

| 用途 | エンドポイント |
|---|---|
| 為替 | `api.frankfurter.dev/v1/latest`（ECB 基準レート） |
| 天気 | `api.open-meteo.com/v1/forecast` |
| 空気質 | `air-quality-api.open-meteo.com/v1/air-quality` |

為替は EUR 基準で返るので、`JPY / MYR` を割って
1リンギットあたりの円を求めています。


## 6. データの保存先

### localStorage（テキスト）

| キー | 中身 |
|---|---|
| `prep-data` | 自分で編集したリスト。未編集なら存在しない |
| `prep-checks` | チェック状態 |
| `prep-collapse` | 手動で開閉したグループ |
| `prep-memo` | メモ本文 |
| `prep-me` | プロフィール項目 |
| `prep-live` | 取得した為替・天気 |
| `prep-spots` | 選んだ天気の地域 |
| `prep-content` | 取得した content.json |
| `prep-contentrev` | その rev |
| `prep-rev` | 取り込み済みの rev |
| `prep-lastcheck` | 最後に更新確認した時刻 |
| `prep-admin-salt` | 管理者パスワードのソルト |
| `prep-admin-hash` | 同ハッシュ |

### IndexedDB（バイナリ）

`prep-files` データベースの `f` ストアに、添付ファイルを Blob で保存。
localStorage の 5MB 制限を受けません。1ファイル 50MB まで。

### 重要な性質

**アプリ本体（Cache Storage）とユーザーデータ（localStorage /
IndexedDB）は別の領域です。** だから本体を更新してもデータは消えません。

**どこにも送信されません。** GitHub Pages は静的ファイルを配るだけで、
受け口を持ちません。同じ URL を他人に渡しても、相手のチェックが
こちらに見えることも、その逆もありません。

**ホーム画面アプリと Safari は別ストレージです。** iOS の仕様で、
両者のデータは共有されません。


## 7. 更新の仕組み

### ライフサイクル

Service Worker は同時に2つ存在できます。

1. `reg.update()` がサーバーの sw.js を**バイト単位で比較**
2. 1バイトでも違えば新しい SW を `install`
3. 古い SW は動いたまま、新しい方は `waiting` で待機
4. 「更新する」を押すと `postMessage({type:"SKIP_WAITING"})`
5. 新 SW が `skipWaiting()` → `activate`
6. `controllerchange` が発火 → `location.reload()`

作業中に中身が入れ替わると壊れるので、押すまで切り替わりません。

### 版番号を3つ揃える

| ファイル | 変数 | いつ上げるか |
|---|---|---|
| `sw.js` | `CACHE` | **毎回必ず** |
| `index.html` | `APP_VERSION` | 毎回（表示用） |
| `version.json` | `version` | 毎回。APP_VERSION と一致させる |

`CACHE` の上げ忘れが最大の落とし穴です。比較がバイト単位なので、
sw.js が同一だと更新が誰にも届きません。同時に `activate` で
`k !== CACHE` のキャッシュを消すため、古いファイルが確実に捨てられます。

### version.json を挟む理由

GitHub Pages は `Cache-Control: max-age=600` を返します。
初期実装では、この10分間 Safari が古い sw.js を再利用してしまい、
「更新を確認する」が効きませんでした。

対策は2つ。

- `version.json?t=<timestamp>` を `cache:"no-store"` で取得し、
  HTTP キャッシュを確実に貫通させる
- `register("./sw.js", {updateViaCache:"none"})` で
  sw.js 自体をキャッシュ対象外にする

これで「サーバー側は 2.6、この端末は 1.3 です」と
具体的に表示できるようになりました。


## 8. content.json を分離した理由

やること・持ち物の中身が index.html（112KB）に埋まっていると、
スマホから編集できません。13.8KB の `content.json` に切り出したことで、
**GitHub の Web 編集画面が iPhone の Safari で実用的に使えます。**

### 二段構えのフォールバック

```js
function activeDefaults(){
  var c = get("prep-content", null);
  return (c && c.todo && c.pack) ? c : DEFAULTS;
}
```

`index.html` 内の `DEFAULTS` は、content.json をまだ一度も
取得できていないときの控えです。両者は現在同一内容です。

### 受け取る側の分岐

| 状態 | 挙動 |
|---|---|
| 未編集（`prep-data` なし） | 黙って最新に差し替わる |
| 自分で項目を足した | 「新しい項目を取り込む」ボタンが出る |

後者は `gid` と `id` で突き合わせ、**存在しないものだけを追記**します。
既存のチェックと自作項目は保持されます。

`rev` が `prep-rev` より大きいときだけ反映され、
かつ「更新を確認する」を押したときだけ判定が走ります。


## 9. 管理者モード

### 解錠フロー

```
設定タブのバージョン番号を5回タップ（1.2秒以内の連打）
      ↓
「ロック解除」の枠が出る
      ↓
つまみを右端までスライド（touch / mouse 両対応）
      ↓
パスワード入力欄が出る
      ↓
SHA-256 で照合 → 一致で管理者モード
```

初回はパスワード未設定なので、確認欄が増えてその場で登録します（4文字以上）。

### パスワードの扱い

```js
salt = randHex(16)                        // crypto.getRandomValues
hash = SHA-256(salt + "|" + password)     // crypto.subtle.digest
```

保存するのは salt と hash だけで、**平文はどこにも残りません。**
同じパスワードでも設定し直すたびに別のハッシュになります。

解錠状態は `admUnlocked` というメモリ上の変数だけで持ちます。
**アプリを開き直すと自動でロック**されます。

### 通信について

管理者モードのコードには `fetch` も `XMLHttpRequest` も
`sendBeacon` も `WebSocket` もありません。SHA-256 は Web Crypto API
によるブラウザ内蔵の計算です。

**したがって解錠・編集・書き出し・コピーはすべて完全オフラインで動きます。**
ネットが要るのは、最後に GitHub へ貼り付ける瞬間だけです。

### これは本当のセキュリティではない

静的サイトなので、ソースを読めば仕組みは分かります。
**実際の防御境界は GitHub の push 権限です。**
リンクを渡した相手は content.json を書き換えられません。

パスワードの役割は、端末を借りられたときや誤操作で
管理画面に入られるのを防ぐことです。


## 10. 配信の流れ（スマホだけで完結）

```
アプリ内で項目を編集
      ↓
管理者モード →「配信用に書き出す」（rev が自動で +1）
      ↓
「コピー」
      ↓
「GitHubで編集」→ content.json の編集画面
      ↓
全選択して削除 → 貼り付け → Commit changes
      ↓
受け取る側が「更新を確認する」を押したとき反映
```

`index.html` には触りません。


## 11. 日付と時刻の扱い

### カウントダウン

出発時刻からの経過時間で切り上げると、カウントが減るのが毎日 15:15 に
なってしまい直感に反します。**日本時間の暦日で数える**方式に変更しました。

```js
var today = partsIn("Asia/Tokyo").date;
var d = Math.round(
  (Date.parse("2026-09-07T00:00:00Z") - Date.parse(today+"T00:00:00Z"))
  / 86400000);
```

### 現地時刻

`Intl.DateTimeFormat` に `timeZone` を明示して算出しています。
**端末のタイムゾーン設定に依存しません。** 現地で時計が自動的に
マレーシア時間に変わっても、日本時間と現地時間の両方が正しく出ます。

日程データには各日に `date` と `tz` を持たせてあり、
Day 1 と Day 9 は `Asia/Tokyo`、Day 2〜8 は `Asia/Kuala_Lumpur` です。
これで「今日は Day 何日目か」「次の予定は何か」を正しく判定します。


## 12. 天気マップ

衛星画像やタイル地図はオフラインで保持しづらいため、
**自前の SVG を生成**しています。

- マレー半島とボルネオ島の輪郭は概略のポリゴン（模式図）
- 都市の位置は**実際の緯度経度**を線形投影
- 今日の降水確率で色分け（緑 30%未満 / 黄 30〜59% / 赤 60%以上）

取得済みデータから描くので、オフラインでも表示されます。


## 13. 既知の制約

- **Safari の「履歴とWebサイトデータを消去」で全部消えます。**
  チェック・メモ・プロフィール・添付・キャッシュすべて。
  旅行が終わるまで実行しないこと
- 添付ファイルはバックアップではありません。写真アプリ側の
  元データを消さないこと
- 管理者パスワードに復旧手段はありません。復旧口は抜け道になるため
  意図的に用意していません
- ブラウザによる sw.js の定期照合（約2KB / 24時間）は停止できません
- ホーム画面アプリと Safari のデータは共有されません


## 14. 復旧手順

| 症状 | 対処 |
|---|---|
| 更新が入らない | 設定タブ →「アプリ本体を入れ直す」。SW とキャッシュだけ捨てて取り直す。データは残る |
| それでもダメ | アイコンを削除して Safari から追加し直す。**データは消える** |
| 端末側が古いまま | サーバーを確認：`curl -s "https://moritu71.github.io/malaysia-trip/version.json?t=$(date +%s)"` |
