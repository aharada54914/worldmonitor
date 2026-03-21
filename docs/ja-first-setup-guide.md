# World Monitor 最初のセットアップを1行ずつ説明

このページは、`World Monitor` をはじめて動かす人向けの説明です。

難しい言葉はできるだけ減らしてあります。

- `ターミナル`:
  黒い画面や白い画面に文字を打ち込む道具です。
- `コマンド`:
  ターミナルに打ち込む命令です。
- `Docker`:
  アプリをまとめて動かす箱のような道具です。
- `VPS`:
  インターネット上にある、自分専用のパソコンです。

このガイドでは、いちばん失敗しにくい `Docker` を使うやり方で説明します。

---

## 1. まず何ができるアプリなのか

`World Monitor` は、世界のニュース、災害、紛争、航空、船、マーケットなどをまとめて見るダッシュボードです。

開くと、次のようなものが見られます。

- 世界地図や地球儀
- リアルタイムに近いニュース
- 国ごとのリスクや変化
- 飛行機や船の情報
- 設定画面

最初は API キーがなくても一部は動きます。
API キーを入れると、使える機能が増えます。

---

## 2. セットアップ前に必要なもの

最低限これを用意してください。

- パソコン
- インターネット接続
- Docker
- Git

`Node.js` もあると便利ですが、Docker で動かすだけなら必須ではありません。

---

## 3. 最初のセットアップを1行ずつ説明

ここからは、実際に打つコマンドを1行ずつ説明します。

### 3-1. リポジトリをコピーする

```bash
git clone https://github.com/koala73/worldmonitor.git
```

この1行は、GitHub にある `World Monitor` の中身を自分のパソコンにコピーする命令です。

```bash
cd worldmonitor
```

この1行は、今コピーした `worldmonitor` フォルダの中に入る命令です。

### 3-2. 設定ファイルを作る

```bash
cp .env.example .env.local
```

この1行は、設定の見本ファイルをコピーして、自分用の設定ファイルを作る命令です。

`API キー` を使わないなら、この時点では空のままでもかまいません。

### 3-3. Docker でアプリを起動する

```bash
docker compose up -d --build
```

この1行は、アプリに必要なものをまとめて作って、バックグラウンドで起動する命令です。

それぞれの意味はこうです。

- `docker compose`:
  複数の部品をまとめて動かす
- `up`:
  起動する
- `-d`:
  ターミナルを占領せず、裏側で動かす
- `--build`:
  必要なら作り直してから起動する

### 3-4. データを入れる

```bash
./scripts/run-seeders.sh
```

この1行は、Redis に初期データやキャッシュを入れる命令です。

これをしないと、画面は開いても一部のパネルが空に見えることがあります。

### 3-5. ブラウザで開く

```bash
open http://localhost:3000
```

Mac ではこの1行でブラウザが開きます。

Windows の場合は、ブラウザで `http://localhost:3000` を直接開いてください。

Linux の場合は、使っているデスクトップ環境によって `xdg-open http://localhost:3000` が使えます。

---

## 4. 起動できたか確認する

次のコマンドで、Docker の箱がちゃんと動いているか確認できます。

```bash
docker compose ps
```

ここで `Up` や `healthy` と出ていれば、だいたいうまく動いています。

もし詳しいメッセージを見たいなら、次を使います。

```bash
docker compose logs -f
```

この1行は、アプリが今なにをしているかを流し続けて表示します。

止めたいときは `Ctrl + C` を押します。

---

## 5. APIキーを入れたいとき

もっと多くの機能を使いたいときは、`.env.local` か `docker-compose.override.yml` に API キーを入れます。

たとえば次のようなものです。

- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `AISSTREAM_API_KEY`
- `AVIATIONSTACK_API`
- `UCDP_ACCESS_TOKEN`
- `ICAO_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

値を変えたあとには、もう一度起動し直します。

```bash
docker compose up -d --build
```

---

## 6. よく使う基本コマンド

### 起動

```bash
docker compose up -d
```

前に作ったものをそのまま起動します。

### 作り直して起動

```bash
docker compose up -d --build
```

コードや設定を変えたあとはこちらが安全です。

### 止める

```bash
docker compose down
```

アプリを止めます。

### 完全に消す

```bash
docker compose down -v
```

データ用の volume も消します。
`Redis` の中身も消えるので、あとでまた `./scripts/run-seeders.sh` が必要になります。

### 状態を見る

```bash
docker compose ps
```

どの部品が動いているか見ます。

### ログを見る

```bash
docker compose logs -f worldmonitor
```

`worldmonitor` 本体のログだけ見ます。

```bash
docker compose logs -f ais-relay
```

飛行機・船・各種収集まわりのログを見ます。

---

## 7. 画面の使い方

最初に覚えるとよいポイントだけ説明します。

### 地図

- 世界の動きを地図上で見る場所です
- 2D と 3D の見え方があります
- 地図の種類や色は設定から変えられます

### パネル

- ニュース
- マーケット
- 災害
- 軍事
- 航空
- 船

などを箱ごとに見られます。

### 設定

設定では次のようなものを変えられます。

- テーマ
- 文字の見た目
- 地図の見た目
- 言語
- 通知
- AI の挙動

---

## 8. 困ったときの見方

### 画面が開かない

次を打ちます。

```bash
docker compose ps
```

`worldmonitor` が `Up` になっているか確認します。

### 画面は開くけど中身が少ない

次を打ちます。

```bash
./scripts/run-seeders.sh
```

初期データが入っていないことがあります。

### API キーが反映されない

設定を書き換えたあとに、次を打ちます。

```bash
docker compose up -d --build
```

### くわしいエラーを見たい

```bash
docker compose logs -f
```

---

## 9. 初心者向けのおすすめ進め方

最初は次の順番が安全です。

1. API キーなしで起動してみる
2. 画面が開くことを確認する
3. `run-seeders.sh` を実行する
4. そのあとで API キーを1つずつ足す
5. 変えるたびに `docker compose up -d --build` を実行する

いきなり全部の API キーを入れるより、1個ずつ確認した方が原因を見つけやすいです。

---

## 10. このあと次に読むとよいもの

- VPS に置きたいなら:
  `VPS 本番運用マニュアル`
- 設定を分類して見たいなら:
  `docs/SETTINGS_MANAGEMENT.md`
- 詳しい自己ホスト説明を見たいなら:
  `SELF_HOSTING.md`
