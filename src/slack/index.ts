import { App, LogLevel, webApi } from "@slack/bolt";
import { ConfigError, type SlackConfig } from "../config/index.ts";
import { joinChannels, type Logger } from "./channels.ts";
import { fromDirectMessage, fromMention, type IncomingMessage } from "./message.ts";

export type { IncomingMessage } from "./message.ts";

export interface SlackIdentity {
  /** The bot's user ID, e.g. U0123 (what <@U0123> mentions refer to). */
  userId: string;
  /** The bot's name as configured in the Slack app. */
  name: string;
  team: string;
}

/** Ways the handler can respond to an incoming message. */
export interface Reply {
  /** Post a message in the conversation (in the thread for channel mentions). */
  post(text: string): Promise<void>;
  /** Add an emoji reaction to the incoming message, e.g. "eyes". */
  react(name: string): Promise<void>;
}

export type MessageHandler = (message: IncomingMessage, reply: Reply) => Promise<void>;

export interface SlackBot {
  identity: SlackIdentity;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Connect to Slack over Socket Mode. Verifies the bot token up front (auth.test) so bad
 * credentials fail at startup, and learns the bot's own identity for mention handling.
 */
export async function createSlackBot(
  config: SlackConfig,
  onMessage: MessageHandler,
  logger: Logger = console,
): Promise<SlackBot> {
  // Verify the token ourselves before creating the App: Bolt's own verification runs inside
  // the constructor and its failure would surface as an unhandled rejection.
  const auth = await new webApi.WebClient(config.botToken).auth.test().catch((err: Error) => {
    throw new ConfigError(`Slack rejected slack.botToken: ${err.message}`);
  });
  if (!auth.user_id) throw new Error("slack: auth.test returned no user_id");
  const identity: SlackIdentity = {
    userId: auth.user_id,
    name: auth.user ?? auth.user_id,
    team: auth.team ?? "",
  };

  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
    tokenVerificationEnabled: false,
    botUserId: auth.user_id,
    botId: auth.bot_id,
  });

  const dispatch = async (message: IncomingMessage) => {
    const { client } = app;
    const reply: Reply = {
      async post(text) {
        await client.chat.postMessage({
          channel: message.channel,
          thread_ts: message.threadTs,
          text,
        });
      },
      async react(name) {
        await client.reactions.add({ channel: message.channel, timestamp: message.ts, name });
      },
    };
    try {
      await onMessage(message, reply);
    } catch (err) {
      logger.warn(`slack: handler failed: ${(err as Error).stack ?? err}`);
      await reply.post("Sorry, something went wrong while handling that.").catch(() => {});
    }
  };

  app.event("app_mention", async ({ event }) => {
    const message = fromMention(event, identity.userId);
    if (message) await dispatch(message);
  });

  app.message(async ({ message: event }) => {
    const message = fromDirectMessage(event, identity.userId);
    if (message) await dispatch(message);
  });

  app.error(async (err) => {
    logger.warn(`slack: ${err.message}`);
  });

  return {
    identity,
    async start() {
      await app.start();
      await joinChannels(app.client, config.channels, logger);
    },
    async stop() {
      await app.stop();
    },
  };
}
