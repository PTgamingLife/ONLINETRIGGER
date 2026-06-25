const line = require('@line/bot-sdk');

const channelSecret = process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// v11+: use messagingApi.MessagingApiClient
const c = new line.messagingApi.MessagingApiClient({ channelAccessToken });

const _push  = (to, msgs) => c.pushMessage({ to, messages: [].concat(msgs) });
const _reply = (replyToken, msgs) => c.replyMessage({ replyToken, messages: [].concat(msgs) });

// middleware only needs channelSecret for signature verification
const lineMiddleware = line.middleware({ channelSecret });

module.exports = { push: _push, reply: _reply, lineMiddleware };
