### インストール

```bash
npm install
```

### 環境変数の設定

`.env.sample` を `.env` にコピーし、次の環境変数を設定

- CHANNEL_ID: エクスポートしたい Slack チャンネルの ID
- USER_OAUTH_TOKEN: Slack の User OAuth Token

### 実行方法

```
npm start
```

### 出力結果

`src/{チャンネル名またはチャンネル ID}/history/`: チャット履歴の CSV ファイル
`src/{チャンネル名またはチャンネル ID}/files/`: 添付ファイル
