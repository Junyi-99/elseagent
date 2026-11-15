import { describe, expect, test } from "bun:test";
import { type ChannelsClient, ensureChannel, joinChannels, parseChannelRef } from "./channels.ts";

function fakeClient(pages: { id: string; name: string }[][], failJoin: string[] = []) {
  const joins: string[] = [];
  let listCalls = 0;
  const client: ChannelsClient = {
    conversations: {
      async list({ cursor }) {
        listCalls++;
        const page = Number(cursor ?? 0);
        return {
          channels: pages[page] ?? [],
          response_metadata: { next_cursor: page + 1 < pages.length ? String(page + 1) : "" },
        };
      },
      async join({ channel }) {
        if (failJoin.includes(channel)) throw new Error("method_not_supported_for_channel_type");
        joins.push(channel);
        return {};
      },
      async info() {
        return { channel: { is_member: false } };
      },
    },
  };
  return { client, joins, listCalls: () => listCalls };
}

const logs: string[] = [];
const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };

describe("parseChannelRef", () => {
  test("recognises IDs, names and #names", () => {
    expect(parseChannelRef("C0123456789")).toEqual({ id: "C0123456789" });
    expect(parseChannelRef("#General")).toEqual({ name: "general" });
    expect(parseChannelRef("dev-ops")).toEqual({ name: "dev-ops" });
  });
});

describe("joinChannels", () => {
  test("does nothing without channels", async () => {
    const { client, listCalls } = fakeClient([]);
    expect(await joinChannels(client, [], logger)).toEqual([]);
    expect(listCalls()).toBe(0);
  });

  test("joins IDs directly without listing channels", async () => {
    const { client, joins, listCalls } = fakeClient([]);
    await joinChannels(client, ["C0123456789"], logger);
    expect(joins).toEqual(["C0123456789"]);
    expect(listCalls()).toBe(0);
  });

  test("resolves names across pages", async () => {
    const { client, joins } = fakeClient([
      [{ id: "C0000000001", name: "general" }],
      [{ id: "C0000000002", name: "dev" }],
    ]);
    await joinChannels(client, ["#dev", "general"], logger);
    expect(joins).toEqual(["C0000000002", "C0000000001"]);
  });

  test("skips unknown channels and join failures without throwing", async () => {
    const { client, joins } = fakeClient(
      [[{ id: "C0000000001", name: "general" }]],
      ["C0000000009"],
    );
    const joined = await joinChannels(client, ["secret", "C0000000009", "general"], logger);
    expect(joined).toEqual(["C0000000001"]);
    expect(joins).toEqual(["C0000000001"]);
    expect(logs.some((l) => l.includes("channel not found") && l.includes("secret"))).toBe(true);
    expect(logs.some((l) => l.includes("could not join") && l.includes("C0000000009"))).toBe(true);
  });
});

describe("ensureChannel", () => {
  function client({ joinFails = false, isMember = false } = {}) {
    const joined: string[] = [];
    const c: ChannelsClient = {
      conversations: {
        list: async () => ({ channels: [{ id: "C0000000001", name: "ops" }] }),
        join: async ({ channel }) => {
          if (joinFails) throw new Error("method_not_supported_for_channel_type");
          joined.push(channel);
          return {};
        },
        info: async () => ({ channel: { is_member: isMember } }),
      },
    };
    return { c, joined };
  }

  test("joins a public channel by name and returns its ID", async () => {
    const { c, joined } = client();
    expect(await ensureChannel(c, "#ops")).toBe("C0000000001");
    expect(joined).toEqual(["C0000000001"]);
  });

  test("accepts a private channel the bot is already in", async () => {
    const { c } = client({ joinFails: true, isMember: true });
    expect(await ensureChannel(c, "G0000000002")).toBe("G0000000002");
  });

  test("explains when the bot must be invited", async () => {
    expect(ensureChannel(client({ joinFails: true }).c, "G0000000002")).rejects.toThrow(
      "invite me",
    );
    expect(ensureChannel(client().c, "#nope")).rejects.toThrow("not found");
  });
});
