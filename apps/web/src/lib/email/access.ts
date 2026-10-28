const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type PlainEmail = { subject: string; text: string; html: string };

/** To the Account Admins when someone at an authorized domain asks to join (FR-2.2). Plain wording, one link, no tracking. */
export function buildAccessRequestEmail(input: { workspace: string; requester: string; link: string }): PlainEmail {
  const subject = `${input.requester} asked to join ${input.workspace} on Product Velocity`;
  const text = [
    `${input.requester} signed up with an email address at your authorized domain and asked to join ${input.workspace}.`,
    "",
    "They have no access until you approve them. Review the request in the members grid (status Requested Access):",
    input.link,
    "",
    "If you do not know this person, leave the request or set it to Revoked.",
    "",
    "Product Velocity",
  ].join("\n");
  const html = [
    `<p><strong>${escapeHtml(input.requester)}</strong> signed up with an email address at your authorized domain and asked to join <strong>${escapeHtml(input.workspace)}</strong>.</p>`,
    `<p>They have no access until you approve them. Review the request in the members grid (status Requested Access):<br><a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    "<p>If you do not know this person, leave the request or set it to Revoked.</p>",
    "<p>Product Velocity</p>",
  ].join("\n");
  return { subject, text, html };
}

/** To the person when an admin approves them (FR-4.3): confirmation and the direct link back to the platform. */
export function buildAccessApprovedEmail(input: { workspace: string; link: string }): PlainEmail {
  const subject = `You now have access to ${input.workspace} on Product Velocity`;
  const text = [
    `An admin approved your request. You now have access to ${input.workspace} on Product Velocity.`,
    "",
    "Open it here:",
    input.link,
    "",
    "Product Velocity",
  ].join("\n");
  const html = [
    `<p>An admin approved your request. You now have access to <strong>${escapeHtml(input.workspace)}</strong> on Product Velocity.</p>`,
    `<p>Open it here:<br><a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    "<p>Product Velocity</p>",
  ].join("\n");
  return { subject, text, html };
}
