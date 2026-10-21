// X（旧Twitter）への投稿: 文字数の数え方・スレッドへの分割・OAuth 1.0a の署名・投稿
import { createHmac, randomBytes } from 'node:crypto';

// X の数え方: 一部の範囲（半角英数・記号など）は1文字、それ以外（日本語・絵文字など）は2文字として、合計280まで
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
export function weightedLength(text) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    n += LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return n;
}

/**
 * 告知文を投稿の単位に分ける。先頭に見出し（例「【伊藤百花】」）を付け、280を超える場合は
 * 演目のまとまり（空行区切り）ごとに次の投稿（スレッドの返信）へ回す。
 */
export function splitForX(text, heading, limit = 280) {
  const blocks = text.trim().split(/\n{2,}/);
  const posts = [];
  let cur = heading ? `${heading}\n${blocks.shift()}` : blocks.shift();
  for (const block of blocks) {
    const joined = `${cur}\n\n${block}`;
    if (weightedLength(joined) <= limit) {
      cur = joined;
    } else {
      posts.push(cur);
      cur = block;
    }
  }
  posts.push(cur);
  if (posts.some((p) => weightedLength(p) > limit)) throw new Error('1つの演目が長すぎて1投稿に入りません');
  return posts;
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a の Authorization ヘッダー（HMAC-SHA1）。extraParams は署名に含めるクエリなど */
export function oauthHeader(method, url, creds, extraParams = {}, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000)) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const params = { ...oauth, ...extraParams };
  const paramString = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join('&');
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessTokenSecret)}`;
  const signature = createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ');
}

const TWEETS_URL = 'https://api.x.com/2/tweets';

/** 投稿を順にスレッドとして投稿し、投稿IDの配列を返す */
export async function postThread(posts, creds, fetchImpl = fetch) {
  const ids = [];
  for (const text of posts) {
    const body = { text, ...(ids.length ? { reply: { in_reply_to_tweet_id: ids.at(-1) } } : {}) };
    const res = await fetchImpl(TWEETS_URL, {
      method: 'POST',
      headers: { Authorization: oauthHeader('POST', TWEETS_URL, creds), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.data?.id) throw new Error(`X への投稿に失敗しました: HTTP ${res.status} ${JSON.stringify(json)}`);
    ids.push(json.data.id);
  }
  return ids;
}
