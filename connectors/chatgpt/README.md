# Product Velocity in ChatGPT

ChatGPT connects to Product Velocity as a custom MCP connector (Developer mode). Replace the address with your deployment's.

## Connect
1. Copy the connector URL.
2. In ChatGPT open Settings, then Apps and Connectors, turn on Developer mode under Advanced settings, choose Create, name it Product Velocity, paste the URL and choose OAuth. On Business, Enterprise and Edu plans a ChatGPT workspace admin must allow custom connectors first.
3. Choose Connect, sign in, pick one or several workspaces and approve. In a new chat add Product Velocity from the + menu.

ChatGPT cannot start prompts, so say "use the write_prd playbook" or simply describe what you want; the assistant reads the same instructions through the get_playbook tool. Deep research and company knowledge use the search and fetch tools, which are read-only.

## What ChatGPT gets
- The same tools, rules and roles as every other assistant. The `search` and `fetch` tools are listed only to ChatGPT, for deep research and company knowledge; they are read-only and return what your role can read.
- No prompts: ChatGPT calls `get_playbook` with the name of a flow and follows the text it returns. The flows: `write_prd`, `write_discovery`, `research_company`.
- Writes (create_items, update_items, ...) are annotated as not read-only, so ChatGPT asks you to confirm each one.

## Not verified yet
Spike S8c in docs/08-SPIKES-AND-OPEN-QUESTIONS.md: a live connection from ChatGPT to a deployed server has not been tested.
