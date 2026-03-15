# Discord Setup

## 1. アプリ作成

1. <https://discord.com/developers/applications> を開く
2. `New Application` を押してアプリ名を入力
3. 作成後、`General Information` で `Application ID` を控える

## 2. Bot 作成と Token 取得

1. 左メニューの `Bot` を開く
2. `Add Bot` を押して Bot を作成
3. `Reset Token` または `View Token` で Token を発行し、すぐ `.env` に保存する
4. Token をチャットやスクリーンショットに出さない

## 3. Privileged Gateway Intents

この MVP は Message Content を読みません。`MESSAGE CONTENT INTENT` は有効化しなくてよいです。

## 4. OAuth2 でサーバーへ招待

1. 左メニューの `OAuth2` -> `URL Generator` を開く
2. `SCOPES` で `bot` と `applications.commands` を選ぶ
3. `BOT PERMISSIONS` で必要最小限の権限を選ぶ
4. 生成された URL から開発用サーバーに招待する

## 推奨権限

- `bot`
- `applications.commands`
- メッセージ送信
- メッセージ編集
- スレッド閲覧が必要なら追加

詳細なメモは [config/permissions.md](../config/permissions.md) に記載しています。

## 5. Guild ID の取得

1. Discord クライアントの詳細設定で `Developer Mode` を有効化
2. 開発用サーバーを右クリックして `サーバーIDをコピー`
3. `DISCORD_GUILD_ID` として `.env` に保存

## 注意

- Token は `.env` にのみ保存する
- Token を Git にコミットしない
- 共有チャットやスクリーンショットに Token を出さない
