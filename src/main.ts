import { WebClient } from '@slack/web-api';
import { createObjectCsvWriter } from 'csv-writer';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const channelId = process.env.CHANNEL_ID;
const userOauthToken = process.env.USER_OAUTH_TOKEN;
const web = new WebClient(userOauthToken);

if (!channelId || !userOauthToken) {
  console.error('.env ファイルを確認してください');
  process.exit(1);
}
main(channelId);

async function main(channelId: string) {
  // チャンネル情報取得
  const chatInfo = await web.conversations.info({ channel: channelId });
  const chatHistory = await web.conversations.history({ channel: channelId });
  const fileList = await web.files.list({ channel: channelId });

  // データ抽出
  const channelName = chatInfo.channel?.name || channelId;
  const messages = chatHistory.messages;
  const files = fileList.files?.filter(file => file.name !== 'To-do_list') || [];

  // エクスポートディレクトリ作成
  const dirHistory = path.join(__dirname, "..", "_downloads", channelName);
  const dirFiles = path.join(__dirname, "..", "_downloads", channelName);
  await fs.promises.mkdir(dirHistory, { recursive: true });
  await fs.promises.mkdir(dirFiles, { recursive: true });

  // チャット履歴のエクスポート
  const csvPath = path.join(dirHistory, `_chat_history_${channelName}.csv`);
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  await fs.promises.writeFile(csvPath, bom);
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'timestamp', title: '時刻' },
      { id: 'user', title: '送信者' },
      { id: 'text', title: 'メッセージ' }
    ],
    append: true
  });

  const records = messages
    ?.filter(message => (
      message.text && message.text.length > 0) || (message.files && message.files.length > 0))
    ?.map(message => ({
      timestamp: new Date(Number(message.ts) * 1000).toLocaleString('ja-JP'),
      user: message.user || '[ユーザー名取得失敗]',
      text: message.files?.length
        ? `[ファイル添付] ${message.text || ''}`.trim()
        : message.text || '[メッセージ内容取得失敗]'
    }));

  if (!records) {
    console.error('エクスポート対象メッセージなし');
  } else {
    await csvWriter.writeRecords(records);
    console.log(`チャット履歴エクスポート完了: ${csvPath}`);
  }

  // ファイルのダウンロード
  if (!files || files?.length === 0) {
    console.log('ダウンロード対象ファイルなし');
    return;
  }
  let unknownFileCount: number = 1;
  for (const file of files) {
    const filePath = path.join(dirFiles, file.name || `unknown_file_${unknownFileCount++}`);

    if (!file.id) {
      console.error(`ダウンロード失敗: ${file.name} | ファイル ID 不正`);
      continue;
    }
    if (!file.url_private) {
      console.error(`ダウンロード失敗: ${file.name} | ファイル URL 不正`);
      continue;
    }

    try {
      const response = await fetch(file.url_private, {
        headers: {
          'Authorization': `Bearer ${userOauthToken}`
        }
      });

      if (!response.ok) {
        console.error(`ダウンロード失敗: ${file.name} | ${response.statusText}`);
        continue;
      }

      await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      console.log(`ダウンロード成功: ${file.name}`);

    } catch (error) {
      console.error(`ダウンロード失敗: ${file.name} | ${error}`);
    }
  }
}

