### インストール

```bash
npm install
```

### 環境変数の設定

`.env.sample` を `.env` にコピーし、次の環境変数を設定

- CHANNEL_ID: エクスポートしたい Slack チャンネルの ID
- USER_OAUTH_TOKEN: Slack の User OAuth Token

### 実行方法

.env ファイルに API キーとチャンネル名を指定してから次のコマンドを実行

```
npm start
```

### 出力

エクスポートデータは `_downloads/{チャンネル名}/` に保存されます
チャット履歴は `_chat_history_{チャンネル名}.csv` として保存されます

スレッドが多いほどエクスポートに時間がかかります（現在の仕様だと 1 スレッドにつき 0.5 秒）
