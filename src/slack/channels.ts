/** The subset of the Slack WebClient used to join channels (kept small for testing). */
export interface ChannelsClient {
  conversations: {
    list(args: {
      types: string;
      exclude_archived: boolean;
      limit: number;
      cursor?: string;
    }): Promise<{
      channels?: { id?: string; name?: string }[];
      response_metadata?: { next_cursor?: string };
    }>;
    join(args: { channel: string }): Promise<unknown>;
  };
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;

/** Normalize a configured channel: IDs stay as-is, names lose a leading `#` and are lowercased. */
export function parseChannelRef(ref: string): { id: string } | { name: string } {
  const trimmed = ref.trim();
  if (CHANNEL_ID.test(trimmed)) return { id: trimmed };
  return { name: trimmed.replace(/^#/, "").toLowerCase() };
}

async function listPublicChannels(client: ChannelsClient): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 1000,
      cursor,
    });
    for (const ch of res.channels ?? []) {
      if (ch.id && ch.name) byName.set(ch.name, ch.id);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return byName;
}

/**
 * Join the configured public channels. Failures are logged and skipped so one bad
 * channel does not stop the agent. Returns the IDs that were joined.
 */
export async function joinChannels(
  client: ChannelsClient,
  refs: string[],
  logger: Logger,
): Promise<string[]> {
  if (refs.length === 0) return [];
  const parsed = refs.map(parseChannelRef);
  const needsLookup = parsed.some((r) => "name" in r);
  const byName = needsLookup ? await listPublicChannels(client) : new Map<string, string>();

  const joined: string[] = [];
  for (const [i, ref] of parsed.entries()) {
    const id = "id" in ref ? ref.id : byName.get(ref.name);
    if (!id) {
      logger.warn(`slack: channel not found (or private, needs /invite): ${refs[i]}`);
      continue;
    }
    try {
      await client.conversations.join({ channel: id });
      joined.push(id);
      logger.info(`slack: joined ${refs[i]} (${id})`);
    } catch (err) {
      logger.warn(`slack: could not join ${refs[i]} (${id}): ${(err as Error).message}`);
    }
  }
  return joined;
}
