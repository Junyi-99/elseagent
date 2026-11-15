import type { types } from "@slack/bolt";

type AnyBlock = types.KnownBlock | types.Block;

/** block_id of the buttons block, and the action_id prefix of each button. */
export const CHOICES_BLOCK_ID = "elseagent_choices";
export const CHOICE_ACTION = /^elseagent_choice_\d+$/;

/** A Markdown message followed by one button per choice. */
export function choiceBlocks(markdown: string, choices: string[]): AnyBlock[] {
  return [
    { type: "markdown", text: markdown },
    {
      type: "actions",
      block_id: CHOICES_BLOCK_ID,
      elements: choices.map((choice, i) => ({
        type: "button",
        action_id: `elseagent_choice_${i}`,
        text: { type: "plain_text", text: choice },
        value: choice,
      })),
    },
  ];
}

/** The message after someone picked: buttons replaced by a note of who chose what. */
export function resolvedBlocks(blocks: AnyBlock[], user: string, choice: string): AnyBlock[] {
  return [
    ...blocks.filter((b) => b.block_id !== CHOICES_BLOCK_ID),
    { type: "context", elements: [{ type: "mrkdwn", text: `<@${user}> chose *${choice}*` }] },
  ];
}
