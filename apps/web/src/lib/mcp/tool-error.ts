/** A mistake in what Claude asked for. The message is written for Claude and shown as the tool's error; anything else becomes a generic one. */
export class ToolInputError extends Error {}
