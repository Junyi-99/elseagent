import { App, type BlockButtonAction, LogLevel, webApi } from "@slack/bolt";
import { ConfigError, type SlackConfig } from "../config/index.ts";
import { joinChannels, type Logger } from "./channels.ts";
import { CHOICE_ACTION, choiceBlocks, resolvedBlocks } from "./choices.ts";
import { fetchThreadContext, type ThreadContext } from "./context.ts";
import { splitMarkdown } from "./markdown.ts";
import { fromDirectMessage, fromMention, type IncomingMessage } from "./message.ts";

export type { ContextMessage, ThreadContext } from "./context.ts";
export { conversationKey, type IncomingMessage } from "./message.ts";

export interface SlackIdentity {
  /** The bot's user ID, e.g. U0123 (what <@U0123> mentions refer to). */
  userId: string;
  /** The bot's name as configured in the Slack app. */
  name: string;
  teamId: string;
}

/** Where a reply goes: the conversation of a message, and the message itself for reactions. */
export interface ReplyTarget {
  channel: string;
  /** The message to react to. */
  ts: string;
  /** Thread to post in; undefined/null posts top-level (DMs). */
  threadTs?: string | null;
}

/** Ways to respond to a message. */
export interface Reply {
  /**
   * Post Markdown in the conversation, split into several messages if it is long. With
   * `choices`, the last message shows them as buttons; a click arrives as a new message.
   */
  post(markdown: string, choices?: string[]): Promise<void>;
  /** Add an emoji reaction to the message, e.g. "eyes". Errors are ignored. */
  react(name: string): Promise<void>;
  /** Remove one of our reactions from the message. Errors are ignored. */
  unreact(name: string): Promise<void>;
}

export type MessageHandler = (message: IncomingMessage, reply: Reply) => Promise<void>;

export interface SlackBot {
  identity: SlackIdentity;
  /** Reply to a message, including one received before a restart. */
  replyTo(target: ReplyTarget): Reply;
  /** Thread messages strictly between `afterTs` (null: thread start) and `beforeTs`, minus ours. */
  threadContext(args: {
    channel: string;
    threadTs: string;
    afterTs: string | null;
    beforeTs: string;
  }): Promise<ThreadContext>;
  /** Connect, join the configured channels, and start delivering messages to `onMessage`. */
  start(onMessage: MessageHandler): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Prepare a Socket Mode connection. Verifies the bot token up front (auth.test) so bad
 * credentials fail at startup, and learns the bot's own identity for mention handling.
 */
export async function createSlackBot(
  config: SlackConfig,
  logger: Logger = console,
): Promise<SlackBot> {
  // Verify the token ourselves before creating the App: Bolt's own verification runs inside
  // the constructor and its failure would surface as an unhandled rejection.
  const auth = await new webApi.WebClient(config.botToken).auth.test().catch((err: Error) => {
    throw new ConfigError(`Slack rejected slack.botToken: ${err.message}`);
  });
  if (!auth.user_id || !auth.team_id) throw new Error("slack: auth.test returned no user/team id");
  const identity: SlackIdentity = {
    userId: auth.user_id,
    name: auth.user ?? auth.user_id,
    teamId: auth.team_id,
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
  const { client } = app;

  const replyTo = (target: ReplyTarget): Reply => ({
    async post(markdown, choices = []) {
      const parts = splitMarkdown(markdown);
      for (const [i, part] of parts.entries()) {
        const thread_ts = target.threadTs ?? undefined;
        if (i === parts.length - 1 && choices.length > 0) {
          const blocks = choiceBlocks(part, choices);
          await client.chat.postMessage({ channel: target.channel, thread_ts, blocks, text: part });
        } else {
          await client.chat.postMessage({
            channel: target.channel,
            thread_ts,
            markdown_text: part,
          });
        }
      }
    },
    async react(name) {
      await client.reactions
        .add({ channel: target.channel, timestamp: target.ts, name })
        .catch(() => {});
    },
    async unreact(name) {
      await client.reactions
        .remove({ channel: target.channel, timestamp: target.ts, name })
        .catch(() => {});
    },
  });

  app.error(async (err) => {
    logger.warn(`slack: ${err.message}`);
  });

  return {
    identity,
    replyTo,
    threadContext: (args) => fetchThreadContext(client, args, identity.userId),
    async start(onMessage) {
      const dispatch = async (message: IncomingMessage) => {
        const reply = replyTo(message);
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
      // A choice button: record the pick on the message, then treat it as the user's reply.
      app.action<BlockButtonAction>({ action_id: CHOICE_ACTION }, async ({ ack, body, action }) => {
        await ack();
        const channel = body.channel?.id;
        const posted = body.message;
        if (!channel || !posted) return;
        await client.chat
          .update({
            channel,
            ts: posted.ts,
            text: posted.text ?? action.value ?? "",
            blocks: resolvedBlocks(posted.blocks ?? [], body.user.id, action.value ?? ""),
          })
          .catch((err: Error) => logger.warn(`slack: could not update choices: ${err.message}`));
        await dispatch({
          channel,
          ts: posted.ts,
          threadTs: posted.thread_ts,
          user: body.user.id,
          text: action.value ?? "",
          isDirect: channel.startsWith("D"),
        });
      });
      await app.start();
      await joinChannels(app.client, config.channels, logger);
    },
    async stop() {
      await app.stop();
    },
  };
}
