# Product Velocity in ChatGPT

ChatGPT connects to Product Velocity as a custom MCP connector (Developer mode). Replace the address with your deployment's.

## Connect
1. In ChatGPT open Settings, then Apps and Connectors, then Advanced settings, and turn on Developer mode. On Business, Enterprise and Edu plans a ChatGPT workspace admin has to allow custom connectors first.
2. Back under Connectors choose Create, name it Product Velocity, paste the connector URL as the MCP server URL and choose OAuth as the authentication.
3. Connect, sign in to Product Velocity, choose one or several workspaces and approve on the consent screen.
4. In a new chat, add the Product Velocity connector from the + menu (Developer mode). ChatGPT asks you to confirm each tool call that changes something.

ChatGPT cannot start prompts, so say "use the write_prd playbook" or simply describe what you want; the assistant reads the same instructions through the get_playbook tool. Deep research and company knowledge use the search and fetch tools, which are read-only.

## What ChatGPT gets
- The same tools, rules and roles as every other assistant. The `search` and `fetch` tools are listed only to ChatGPT, for deep research and company knowledge; they are read-only and return what your role can read.
- No prompts: ChatGPT calls `get_playbook` with the name of a flow and follows the text it returns. The flows: `write_prd`, `write_discovery`, `research_company`.
- Writes (create_items, update_items, ...) are annotated as not read-only, so ChatGPT asks you to confirm each one.

## Not verified yet
Spike S8c in docs/08-SPIKES-AND-OPEN-QUESTIONS.md: a live connection from ChatGPT to a deployed server has not been tested.
