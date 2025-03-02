import { WebClient } from '@slack/web-api';
import { createObjectCsvWriter } from 'csv-writer';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
  const fileList = await web.files.list({ channel: channelId });
  const channel = chatInfo.channel;

  // チャンネルタイプ判定
  const type = (() => {
    switch (true) {
      case channel?.is_channel:
        return 'public_channel';
      case channel?.is_group:
        return 'private_channel';
      case channel?.is_im:
        return 'direct_message';
      case channel?.is_mpim:
        return 'group_dm';
      default:
        console.error('チャンネルタイプが不正です');
        process.exit(1);
    }
  })();

  // チャンネル名取得
  const channelName = await getChannelName(chatInfo.channel, type, channelId);

  // メッセージ履歴取得
  console.info(`${type}: ${channelName} のデータをエクスポートします`);
  const messages: any[] = [];

  console.info(`メッセージ情報取得中`);
  let pageCount = 0;
  let cursor;
  do {
    const response = await web.conversations.history({
      channel: channelId,
      limit: 500,
      cursor: cursor,
    });

    if (response.messages?.length === 0) return;

    messages.push(...(response.messages || []));
    cursor = response.response_metadata?.next_cursor;

    console.info(`${++pageCount} ページ目（${response.messages?.length}）の取得完了`);
  } while (cursor);

  console.info(`${messages.length} 件のメッセージを取得`);

  // データ抽出
  console.info(`ファイル情報取得中`);
  const files = fileList.files?.filter((file) => file.name !== 'To-do_list') || [];
  console.info(`${files.length} 件のファイルを取得`);

  // エクスポートディレクトリ作成
  const dirHistory = path.join(__dirname, '_downloads', channelName);
  const dirFiles = path.join(__dirname, '_downloads', channelName);
  await fs.promises.mkdir(dirHistory, { recursive: true });
  await fs.promises.mkdir(dirFiles, { recursive: true });

  // チャット履歴 CSV データの初期化
  const csvPath = path.join(dirHistory, `_chat_history_${channelName}.csv`);
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  await fs.promises.writeFile(csvPath, bom);
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'timestamp', title: '時刻' },
      { id: 'user', title: '送信者' },
      { id: 'text', title: 'メッセージ' },
    ],
    append: true,
  });
  console.info('出力先フォルダ作成完了');

  // チャット履歴のエクスポート
  const records = [];

  // メッセージとスレッドの処理
  console.info(`メッセージをエクスポートします`);

  const sortedMessages = (messages || []).sort((a, b) => Number(a.ts) - Number(b.ts));
  let numOfThreads = sortedMessages.filter((message) => message.thread_ts).length;
  let threadCount = 1;
  for (const message of sortedMessages) {
    // 親メッセージの処理
    if ((message.text && message.text.length > 0) || (message.files && message.files.length > 0)) {
      records.push({
        timestamp: new Date(Number(message.ts) * 1000).toLocaleString('ja-JP'),
        user: message.user ? await getUserName(message.user) : '[ユーザー名取得失敗]',
        text: message.files?.length
          ? `[file: ${message.files.map((file: any) => file.name).join(', ')}] ${message.text || ''}`.trim()
          : message.text || '[メッセージ内容取得失敗]',
      });
    }

    // スレッドメッセージの処理
    if (message.thread_ts) {
      if (threadCount >= 1) {
        readline.moveCursor(process.stdout, 0, -1);
      }
      console.info(`スレッドメッセージの取得（${threadCount++} / ${numOfThreads}）`);

      const replies = await web.conversations.replies({
        channel: channelId,
        ts: message.thread_ts,
      });

      const filteredMessages = replies.messages?.filter((reply) => reply.ts !== message.thread_ts) || [];
      for (const reply of replies.messages || []) {
        if (reply.ts !== message.thread_ts) {
          records.push({
            timestamp: new Date(Number(reply.ts) * 1000).toLocaleString('ja-JP'),
            user: reply.user ? await getUserName(reply.user) : '[ユーザー名取得失敗]',
            text: `${reply.ts === filteredMessages[filteredMessages.length - 1].ts ? '└' : '├'} ${
              reply.text || '[メッセージ内容取得失敗]'
            }`,
          });
        }
      }
    }
  }

  if (records.length === 0) {
    console.error('エクスポート対象メッセージなし');
  } else {
    await csvWriter.writeRecords(records);
    console.info(`チャット履歴エクスポート完了: ${csvPath}`);
  }

  // ファイルのダウンロード
  if (!files || files?.length === 0) {
    console.info('ダウンロード対象ファイルなし');
    return;
  }

  console.info('ファイルのダウンロードを開始します');

  let fileCount = 1;
  let unknownFileCount = 1;
  for (const file of files) {
    const prefix = fileCount.toString().padStart(4, '0');
    const fileName = file.name ? `${prefix}_${file.name}` : `${prefix}_unknown_file_${unknownFileCount++}`;

    const filePath = path.join(dirFiles, fileName);
    fileCount++;

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
          Authorization: `Bearer ${userOauthToken}`,
        },
      });

      if (!response.ok) {
        console.error(`ダウンロード失敗: ${file.name} | ${response.statusText}`);
        continue;
      }

      await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      console.info(`ダウンロード成功: ${file.name}`);
    } catch (error) {
      console.error(`ダウンロード失敗: ${file.name} | ${error}`);
    }
  }
}

async function getChannelName(channel: any, type: string, channelId: string): Promise<string> {
  switch (type) {
    case 'public_channel':
    case 'private_channel':
      return channel?.name || channelId;

    case 'direct_message':
      return getUserName(channel.user);

    case 'group_dm':
      const members = channel?.members || [];
      if (members.length > 0) {
        const userNames = await Promise.all(
          members.map(async (memberId: string) => {
            getUserName(memberId);
          })
        );
        return userNames.join('、');
      }
      return channelId;

    default:
      return channelId;
  }
}

async function getUserName(userId: string): Promise<string> {
  try {
    const userInfo = await web.users.info({ user: userId });
    return userInfo.user?.real_name || userInfo.user?.name || userId;
  } catch (error) {
    console.error(`ユーザー情報取得失敗: ${userId}`);
    return userId;
  }
}
