# World Monitor VPS 本番運用マニュアル

このページは、`World Monitor` を VPS で 24 時間 365 日動かすための実践マニュアルです。

対象読者は、次のどちらかです。

- はじめて VPS を使う人
- すでに Docker は少し触ったことがあるけれど、本番運用は不安な人

このマニュアルでは、`Debian 系の VPS` を前提に説明します。
管理方法は、次の役割分担をおすすめします。

- `Portainer`:
  アプリの設定、環境変数、再デプロイ、ログ確認
- `Cockpit`:
  VPS 自体の状態確認
- `tmux`:
  SSH 作業を切らさないための保険
- `lazydocker`:
  コンテナの様子をターミナルで見たいとき

本命は `Portainer` です。

---

## 1. 本番運用とは何をすることか

`本番運用` とは、ただ一度動かすことではありません。

次のことを続けて行う状態を作ることです。

- 起動したまま保つ
- 再起動後も戻る
- エラーが出たら気づける
- 設定変更を安全にできる
- 更新しても壊れにくい
- バックアップを持つ

---

## 2. まず決めること

本番に入る前に、次を決めます。

### ドメイン

例:

- `monitor.example.com`

### 使うポート

基本は次の 2 つです。

- `80`
- `443`

### どこで設定をいじるか

おすすめはこうです。

- アプリ設定:
  `Portainer`
- VPS 自体:
  `Cockpit`
- 緊急時の SSH 作業:
  `tmux`

---

## 3. 最初の本番セットアップ

### 3-1. VPS に SSH 接続する

```bash
ssh root@あなたのVPSのIP
```

この1行で、VPS の中に入ります。

### 3-2. OS を最新にする

```bash
apt update
```

パッケージの一覧を最新にします。

```bash
apt upgrade -y
```

古いパッケージを新しくします。

### 3-3. Docker を入れる

```bash
apt install -y docker.io docker-compose-plugin
```

Docker と Docker Compose を入れます。

### 3-4. Git を入れる

```bash
apt install -y git
```

GitHub からコードを取るために使います。

### 3-5. tmux を入れる

```bash
apt install -y tmux
```

SSH が切れても作業を続けやすくするために使います。

### 3-6. Portainer を入れる

Portainer は、Docker をブラウザで管理しやすくする道具です。

```bash
docker volume create portainer_data
```

Portainer 用の保存場所を作ります。

```bash
docker run -d --name portainer --restart=always -p 8000:8000 -p 9443:9443 -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:lts
```

この1行で Portainer を起動します。

ブラウザでは次を開きます。

- `https://あなたのVPSのIP:9443`

### 3-7. Cockpit を入れる

Cockpit は、VPS 自体の状態を見るための管理画面です。

```bash
apt install -y cockpit
```

```bash
systemctl enable --now cockpit.socket
```

ブラウザでは次を開きます。

- `https://あなたのVPSのIP:9090`

### 3-8. アプリを配置する

```bash
git clone https://github.com/koala73/worldmonitor.git
```

```bash
cd worldmonitor
```

### 3-9. 環境変数を用意する

方法は2つあります。

1. `docker-compose.override.yml` を作る
2. `Portainer` の Stack 画面で環境変数を入れる

本番では `Portainer` の方が管理しやすいです。

最低限よく使うものは次です。

- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `AISSTREAM_API_KEY`
- `AVIATIONSTACK_API`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `DISCORD_WEBHOOK_URL`

既定の見た目や動きも `WM_INSTANCE_*` で変えられます。

例:

- `WM_INSTANCE_THEME=dark`
- `WM_INSTANCE_LANGUAGE=ja`
- `WM_INSTANCE_MAP_PROVIDER=openfreemap`

### 3-10. 起動する

```bash
docker compose up -d --build
```

### 3-11. 初期データを入れる

```bash
./scripts/run-seeders.sh
```

### 3-12. 起動確認をする

```bash
docker compose ps
```

```bash
curl http://localhost:3000/
```

```bash
curl http://localhost:3000/api/health
```

---

## 4. 公開前にやること

外に公開する前に、最低限これをやってください。

### HTTPS をつける

本番でインターネット公開するなら、`http://` のままはおすすめしません。

考え方はこうです。

- アプリ本体:
  `localhost:3000`
- 外からの公開:
  `443`
- その間に reverse proxy を置く

たとえば次のような reverse proxy が使えます。

- Caddy
- Nginx
- Traefik

### ファイアウォールを決める

公開するなら、開けるポートを最小限にします。

基本例:

- `22`:
  SSH
- `80`:
  HTTP
- `443`:
  HTTPS
- `9443`:
  Portainer を外から触るなら必要
- `9090`:
  Cockpit を外から触るなら必要

ただし `9443` や `9090` は、できれば VPN や IP 制限をかけた方が安全です。

### バックアップを有効にする

最低限、次を用意します。

- VPS の snapshot
- GitHub へのコード保存
- 環境変数の控え

---

## 5. Portainer の使い方

### Portainer を使う理由

Portainer を使うと、次がブラウザ画面からできます。

- コンテナの状態確認
- ログ確認
- 環境変数の変更
- Stack の再デプロイ
- コンソール操作

### Portainer でやる作業

1. Stack を作る
2. `docker-compose.yml` の内容を登録する
3. 環境変数を入れる
4. `Deploy the stack` を押す

### Portainer でよく触る項目

- `OPENROUTER_API_KEY`
- `AISSTREAM_API_KEY`
- `AVIATIONSTACK_API`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `WM_INSTANCE_*`

### Portainer が向いていないもの

次は Portainer ではなく、ユーザーごとのブラウザ保存です。

- パネルの並び順
- 地図のズーム状態
- 個人の通知設定
- 個人のウィジェット

---

## 6. 本番運用の毎日チェック

毎日、または少なくとも数日に1回は次を見ます。

### コンテナが生きているか

```bash
docker compose ps
```

### ログにエラーがないか

```bash
docker compose logs --tail=100 worldmonitor
```

```bash
docker compose logs --tail=100 ais-relay
```

### 画面が返るか

```bash
curl -I http://localhost:3000/
```

### health が返るか

```bash
curl http://localhost:3000/api/health
```

---

## 7. seeders を定期実行する

このアプリは、データを定期的に取りに行く処理が必要です。

VPS では `cron` を使うと楽です。

```bash
crontab -e
```

たとえば 30 分ごとに回すなら次です。

```cron
*/30 * * * * cd /root/worldmonitor && ./scripts/run-seeders.sh >> /var/log/worldmonitor-seeders.log 2>&1
```

意味はこうです。

- `*/30 * * * *`:
  30 分ごと
- `cd /root/worldmonitor`:
  アプリのフォルダへ移動
- `./scripts/run-seeders.sh`:
  データ投入を実行
- `>> /var/log/...`:
  実行記録を残す

---

## 8. 更新手順

本番でアプリを新しくするときは、次の順番が安全です。

### 7-1. いまの状態を確認

```bash
docker compose ps
```

```bash
docker compose logs --tail=50 worldmonitor
```

### 7-2. コードを最新にする

```bash
git pull origin main
```

### 7-3. 必要なら環境変数を更新する

これは `Portainer` でやるのが簡単です。

### 7-4. 再ビルドして起動し直す

```bash
docker compose up -d --build
```

### 7-5. 再度チェックする

```bash
docker compose ps
```

```bash
curl http://localhost:3000/api/health
```

---

## 9. ロールバックの考え方

更新後に壊れたら、あわてて全部消さないでください。

おすすめの順番はこうです。

1. まずログを見る
2. どの変更で壊れたか考える
3. 前のコミットに戻す
4. もう一度 `docker compose up -d --build`

例:

```bash
git log --oneline -n 5
```

最近のコミットを見ます。

```bash
git checkout 1つ前のコミットID
```

前の状態を確認したいときに使います。

本番で安全に戻したいなら、事前にタグや branch を切っておく方が安心です。

---

## 10. 監視の基本

本番では「壊れてから気づく」のがいちばん危険です。

最低限これを用意します。

### 1. health チェック

- `http://localhost:3000/api/health`

### 2. コンテナ状態確認

- `docker compose ps`

### 3. 通知

- Discord Webhook

### 4. バックアップ

- VPS スナップショット
- GitHub に設定以外の変更を保存

---

## 11. バックアップ方針

本番ではバックアップを必ず持ってください。

### 残したいもの

- Git のコード
- 環境変数
- VPS スナップショット
- Redis の重要データ

### おすすめ

- 更新前に VPS の snapshot を取る
- `.env.local` や secret は GitHub に入れない
- Portainer の設定値は別メモにも控える

---

## 12. 障害対応の基本パターン

### ケース1: 画面が開かない

```bash
docker compose ps
```

まずコンテナが落ちていないか見ます。

```bash
docker compose logs --tail=100 worldmonitor
```

本体ログを見ます。

### ケース2: 一部データだけ出ない

API キー切れや upstream 障害のことがあります。

```bash
docker compose logs --tail=100 ais-relay
```

### ケース3: 更新したら壊れた

```bash
git log --oneline -n 5
```

最近の変更を見ます。

### ケース4: VPS を再起動したあと戻らない

```bash
docker compose up -d
```

まず再起動を試します。

---

## 13. tmux と lazydocker の役割

### tmux

おすすめ用途:

- 長い作業中に SSH が切れても続けたい
- 複数の画面で作業したい

よく使う例:

```bash
tmux new -s wm
```

`wm` という名前の作業部屋を作ります。

```bash
tmux attach -t wm
```

あとでもう一度その部屋に戻れます。

### lazydocker

おすすめ用途:

- コンテナ一覧を見たい
- ログをすばやく見たい
- 再起動したい

ただし、設定の本体は `Portainer` で管理する方が整理しやすいです。

---

## 14. Cockpit の役割

Cockpit は、アプリそのものより `VPS の体調管理` に向いています。

見るとよいもの:

- CPU
- メモリ
- ディスク
- サービス
- ログ

つまり、`Portainer はアプリ担当`、`Cockpit はサーバー担当` と考えるとわかりやすいです。

---

## 15. これだけ覚えれば回せる最小コマンド

### 状態確認

```bash
docker compose ps
```

### 本体ログ

```bash
docker compose logs -f worldmonitor
```

### データ収集ログ

```bash
docker compose logs -f ais-relay
```

### 再起動

```bash
docker compose up -d --build
```

### 初期データ再投入

```bash
./scripts/run-seeders.sh
```

### health 確認

```bash
curl http://localhost:3000/api/health
```

---

## 16. 最後に

本番運用でいちばん大事なのは、次の3つです。

1. 変更を一気にやらない
2. 変更したらすぐ確認する
3. 戻せる状態を先に作る

おすすめの実務スタイルはこうです。

- 設定変更:
  Portainer
- 日常確認:
  Portainer と `docker compose ps`
- SSH 作業の保険:
  tmux
- VPS 自体の監視:
  Cockpit

この形にすると、初心者でもかなり事故を減らせます。
