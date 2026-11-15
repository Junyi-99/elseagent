/**
 * A minimal Telegram Bot API client: the few methods and fields elseagent uses.
 * https://core.telegram.org/bots/api
 */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  /** getMe only: the bot has topics (threaded mode) enabled in private chats. */
  has_topics_enabled?: boolean;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TgInlineButton {
  text: string;
  callback_data?: string;
}

export interface TgInlineKeyboard {
  inline_keyboard: TgInlineButton[][];
}

export interface TgMessage {
  message_id: number;
  /** The topic the message belongs to (forum topics, and private chats with topics). */
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  reply_markup?: TgInlineKeyboard;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgForumTopic {
  message_thread_id: number;
  name: string;
}

/** An error response from the Bot API. */
export class TelegramError extends Error {
  override name = "TelegramError";
  constructor(
    readonly method: string,
    readonly code: number,
    description: string,
    readonly retryAfter?: number,
  ) {
    super(`${method}: ${description}`);
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Longest wait for a rate limit (429) before giving up on a call. */
const MAX_RETRY_AFTER_S = 60;

export class TelegramApi {
  private readonly base: string;

  constructor(
    token: string,
    private readonly fetchImpl: Fetch = fetch,
    baseUrl = "https://api.telegram.org",
  ) {
    this.base = `${baseUrl}/bot${token}`;
  }

  /** Call a Bot API method. A rate-limited call (429) is retried once after the given wait. */
  async call<T>(method: string, params: object = {}, signal?: AbortSignal): Promise<T> {
    try {
      return await this.request<T>(method, params, signal);
    } catch (err) {
      if (
        err instanceof TelegramError &&
        err.code === 429 &&
        err.retryAfter !== undefined &&
        err.retryAfter <= MAX_RETRY_AFTER_S
      ) {
        await Bun.sleep(err.retryAfter * 1000);
        return this.request<T>(method, params, signal);
      }
      throw err;
    }
  }

  private async request<T>(method: string, params: object, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
    const body = (await res.json().catch(() => null)) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (!body?.ok) {
      throw new TelegramError(
        method,
        body?.error_code ?? res.status,
        body?.description ?? `HTTP ${res.status}`,
        body?.parameters?.retry_after,
      );
    }
    return body.result as T;
  }
}
