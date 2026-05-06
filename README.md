# Redmine MCP server for Cursor

A small [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that talks to **your Redmine** instance over its REST API. After you wire it into Cursor, the Agent can **list/create/update issues**, **query projects**, **log time**, and call **any documented Redmine endpoint** via a generic tool.

This repo runs over **stdio** (standard MCP transport): Cursor starts `node index.js` and exchanges JSON-RPC over stdin/stdout. You do **not** need to expose an HTTP port.

---

## Prerequisites

- **Node.js 18+** (includes `fetch`)
- A Redmine account with an **API access key**  
  - In Redmine: **My account → API access key** (or your admin’s equivalent)
- Permission to use Redmine’s REST API for the actions you care about (varies by role/project)

---

## Quick setup (for anyone cloning this repo)

### 1. Install dependencies

```bash
cd /path/to/this-repo
npm install
```

### 2. Configure environment variables

Create a `.env` file in the **same directory as `index.js`** (the repo root). **Do not commit `.env`** to git.

```env
RedmineURL=https://your-redmine.example.com
RedmineAPIKEY=your_api_key_here
```

Rules:

- **`RedmineURL`** — Base URL only, **no trailing slash**, e.g. `https://redmine.company.com`
- **`RedmineAPIKEY`** — Your personal API key (treat it like a password)

Optional check from the shell (does not print your key):

```bash
node -e "require('dotenv').config(); console.log(process.env.RedmineURL ? 'RedmineURL OK' : 'missing RedmineURL')"
```

### 3. Smoke test (optional)

The MCP entrypoint is meant to be launched **by Cursor**. If you run it manually it will wait on stdio:

```bash
npm start
```

You should see **no** errors on startup if `.env` is valid. Stop with Ctrl+C.

---

## Connecting Cursor

### Option A — Project-only MCP (recommended for teams)

Check in **`.cursor/mcp.json`** at the repo root so everyone who opens this project gets the same server definition.

This repo’s **`.cursor/mcp.json`** uses **`${workspaceFolder}`** so paths work for any clone location:

```json
{
  "mcpServers": {
    "redmine-all-in-one": {
      "command": "node",
      "args": ["${workspaceFolder}/index.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

Why **`cwd`**: `dotenv` loads `.env` from the current working directory. **`cwd`** must be the folder that contains `.env` and `index.js`.

If your Cursor build does not expand **`${workspaceFolder}`**, switch to absolute paths under **`args`** and **`cwd`** for your machine.

### Option B — User-global MCP

Add the same server block under your **user** MCP settings (Cursor’s global MCP config). Use absolute paths to wherever you cloned this repo.

After editing MCP config:

1. Open **Cursor Settings → MCP** (or Features → MCP)
2. Confirm **`redmine-all-in-one`** appears and is enabled
3. Use **Reload** / restart Cursor if the server stays disconnected

---

## Using it from chat

1. Use **Agent** mode (or any chat mode where **tools are allowed**).
2. Ask clearly that answers should come from Redmine, e.g.  
   - “Using **Redmine MCP**, list my open issues assigned to **me**.”  
   - “Create a Feature in project **`identifier`** with subject **`…`** for version **`…`**.”
3. If the model forgets to use tools, say: **“Only use Redmine MCP tools for Redmine data.”**

The server authenticates with **`X-Redmine-API-Key`**; Redmine treats requests **as the user who owns that key**.

---

## Tools reference

| Tool | Purpose |
|------|---------|
| **`redmine_api_request`** | Generic REST call: method, path (e.g. `/issues.json`), optional query string, optional JSON body string. Use this whenever no helper fits. |
| **`redmine_list_projects`** | Paginated project list. |
| **`redmine_list_issues`** | Issues with common filters (`project_id`, `status_id`, `assigned_to_id`, pagination). Special values often include `me`, `open`, `*`. |
| **`redmine_get_issue`** | One issue by id; optional `include` (e.g. journals). |
| **`redmine_create_issue`** | Create issue (project, subject, tracker, dates, assignee, `fixed_version_id`, **`estimated_hours`**, etc.). |
| **`redmine_update_issue`** | Partial update; supports **`estimated_hours`**. Clear assignee via API: put empty `assigned_to_id` (see Redmine REST docs / use `redmine_api_request`). |
| **`redmine_log_time`** | POST a **time entry** (`issue_id`, `hours`, optional `activity_id`, `spent_on`, `comments`). Defaults `activity_id` to **164** if omitted (your server may differ—override when needed). |
| **`redmine_list_users`** | List users (permissions required). |
| **`redmine_get_current_user`** | Who the API key belongs to. |

For endpoint paths and payloads, your installation follows Redmine’s REST API (see [Redmine REST API](https://www.redmine.org/projects/redmine/wiki/rest_api)).

---

## Practical notes (save debugging time)

### Validation errors (HTTP 422)

Your Redmine may enforce:

- **Priority required** on create → set `priority_id` (discover via `GET /enumerations/issue_priorities.json`).
- **Estimated time** on certain trackers → set `estimated_hours` on create/update or in `extra_fields_json` if using an older MCP schema cache.

### Clearing assignee

Some setups accept `PUT /issues/:id.json` with `"assigned_to_id": ""`. If your Redmine behaves differently, use the UI or check your Redmine version’s REST notes.

### Security

- Rotate the API key if it was ever committed or pasted in an insecure channel.
- Prefer **per-user** keys—not shared accounts.
- Restrict file permissions on `.env` on shared machines (`chmod 600 .env`).

### MCP schema cache

After upgrading `index.js`, **reload MCP servers** in Cursor so new/changed tool arguments appear in the UI.

---

## Development

- **Entry**: `index.js`
- **Start**: `npm start` → runs `node index.js`
- **Dependencies**: `@modelcontextprotocol/sdk`, `dotenv`, `zod`

---

## License

MIT (see `LICENSE`). Dependencies retain their own licenses; Redmine is a separate project under its own license.
