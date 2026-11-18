"use client";

import { useState } from "react";

/** The connector address with a copy button (Help, Connect an AI assistant). */
export function ConnectorUrlBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="help-connector-box">
      <div className="help-connector-field">
        <span className="help-connector-label">Connector URL (MCP Endpoint)</span>
        <input readOnly value={url} aria-label="Connector URL" className="help-connector-input" onFocus={(e) => e.currentTarget.select()} />
      </div>
      <button
        type="button"
        className="btn help-connector-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
    </div>
  );
}
