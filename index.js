#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const apiKey = process.env.RedmineAPIKEY;
const baseUrl = process.env.RedmineURL;

if (!apiKey || !baseUrl) {
  console.error("Missing required env vars: RedmineAPIKEY and RedmineURL");
  process.exit(1);
}

const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

function buildUrl(endpoint, queryString) {
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${normalizedBaseUrl}${normalizedEndpoint}`);
  if (queryString) {
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function redmineRequest(method, endpoint, queryString, jsonBody) {
  const url = buildUrl(endpoint, queryString);
  const headers = {
    "X-Redmine-API-Key": apiKey,
    Accept: "application/json",
  };

  const init = { method, headers };
  if (jsonBody) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(jsonBody);
  }

  const response = await fetch(url, init);
  const raw = await response.text();

  let data = raw;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Return raw body when response is not JSON.
  }

  if (!response.ok) {
    throw new Error(
      `Redmine request failed (${response.status} ${response.statusText}): ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }

  return data;
}

const server = new McpServer({
  name: "redmine-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "redmine_api_request",
  {
    description:
      "Generic Redmine API tool. Use this for any supported endpoint and operation.",
    inputSchema: {
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .default("GET")
        .describe("HTTP method"),
      endpoint: z
        .string()
        .describe("API endpoint path, e.g. /issues.json or /projects/{id}.json"),
      query: z
        .string()
        .optional()
        .describe("Optional query string, e.g. include=journals&limit=25"),
      jsonBody: z
        .string()
        .optional()
        .describe("Optional JSON body as a string"),
    },
  },
  async ({ method, endpoint, query, jsonBody }) => {
    let parsedBody;
    if (jsonBody) {
      try {
        parsedBody = JSON.parse(jsonBody);
      } catch (error) {
        throw new Error(`jsonBody must be valid JSON: ${error.message}`);
      }
    }

    const data = await redmineRequest(method, endpoint, query, parsedBody);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_list_projects",
  {
    description: "List projects with optional pagination.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    },
  },
  async ({ limit, offset }) => {
    const data = await redmineRequest("GET", "/projects.json", `limit=${limit}&offset=${offset}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_list_issues",
  {
    description: "List issues with common filters.",
    inputSchema: {
      project_id: z.string().optional(),
      status_id: z.string().optional().describe("Use '*' for all statuses"),
      assigned_to_id: z.string().optional().describe("Use 'me' for current user"),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    },
  },
  async ({ project_id, status_id, assigned_to_id, limit, offset }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (project_id) params.set("project_id", project_id);
    if (status_id) params.set("status_id", status_id);
    if (assigned_to_id) params.set("assigned_to_id", assigned_to_id);

    const data = await redmineRequest("GET", "/issues.json", params.toString());
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_get_issue",
  {
    description: "Get a single issue by ID.",
    inputSchema: {
      issue_id: z.number().int().positive(),
      include: z
        .string()
        .optional()
        .describe("Optional include values, e.g. journals,children,attachments"),
    },
  },
  async ({ issue_id, include }) => {
    const query = include ? `include=${encodeURIComponent(include)}` : undefined;
    const data = await redmineRequest("GET", `/issues/${issue_id}.json`, query);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

function mergeExtraIssueFields(issue, extraFieldsJson) {
  if (!extraFieldsJson) return issue;
  let parsed;
  try {
    parsed = JSON.parse(extraFieldsJson);
  } catch (error) {
    throw new Error(`extra_fields_json must be valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("extra_fields_json must be a JSON object");
  }
  return { ...issue, ...parsed };
}

server.registerTool(
  "redmine_create_issue",
  {
    description:
      "Create an issue. Use extra_fields_json for custom_fields or rare attributes.",
    inputSchema: {
      project_id: z
        .union([z.string(), z.number()])
        .describe("Numeric ID or project identifier slug"),
      subject: z.string().min(1),
      description: z.string().optional(),
      tracker_id: z.number().int().positive().optional(),
      status_id: z.number().int().positive().optional(),
      priority_id: z.number().int().positive().optional(),
      assigned_to_id: z.union([z.number(), z.string()]).optional(),
      category_id: z.number().int().positive().optional(),
      fixed_version_id: z.number().int().positive().optional(),
      parent_issue_id: z.number().int().positive().optional(),
      start_date: z.string().optional(),
      due_date: z.string().optional(),
      done_ratio: z.number().min(0).max(100).optional(),
      estimated_hours: z.number().nonnegative().optional(),
      is_private: z.boolean().optional(),
      extra_fields_json: z
        .string()
        .optional()
        .describe('JSON object merged into issue, e.g. {"custom_fields":[{"id":1,"value":"x"}]}'),
    },
  },
  async (input) => {
    /** @type {Record<string, unknown>} */
    const issue = {
      project_id: input.project_id,
      subject: input.subject,
    };
    const optional = [
      "description",
      "tracker_id",
      "status_id",
      "priority_id",
      "assigned_to_id",
      "category_id",
      "fixed_version_id",
      "parent_issue_id",
      "start_date",
      "due_date",
      "done_ratio",
      "estimated_hours",
      "is_private",
    ];
    for (const key of optional) {
      if (input[key] !== undefined) issue[key] = input[key];
    }
    const body = { issue: mergeExtraIssueFields(issue, input.extra_fields_json) };
    const data = await redmineRequest("POST", "/issues.json", undefined, body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_update_issue",
  {
    description:
      "Update an issue by ID. Only provided fields are sent. Use extra_fields_json for custom_fields.",
    inputSchema: {
      issue_id: z.number().int().positive(),
      subject: z.string().optional(),
      description: z.string().optional(),
      notes: z.string().optional().describe("Journal comment on update"),
      tracker_id: z.number().int().positive().optional(),
      status_id: z.number().int().positive().optional(),
      priority_id: z.number().int().positive().optional(),
      assigned_to_id: z.union([z.number(), z.string()]).optional(),
      category_id: z.number().int().positive().optional(),
      fixed_version_id: z.number().int().positive().optional(),
      parent_issue_id: z.number().int().positive().optional(),
      start_date: z.string().optional(),
      due_date: z.string().optional(),
      done_ratio: z.number().min(0).max(100).optional(),
      estimated_hours: z.number().nonnegative().optional(),
      is_private: z.boolean().optional(),
      private_notes: z.boolean().optional(),
      extra_fields_json: z.string().optional(),
    },
  },
  async (input) => {
    /** @type {Record<string, unknown>} */
    const issue = {};
    const optional = [
      "subject",
      "description",
      "notes",
      "tracker_id",
      "status_id",
      "priority_id",
      "assigned_to_id",
      "category_id",
      "fixed_version_id",
      "parent_issue_id",
      "start_date",
      "due_date",
      "done_ratio",
      "estimated_hours",
      "is_private",
      "private_notes",
    ];
    for (const key of optional) {
      if (input[key] !== undefined) issue[key] = input[key];
    }
    const merged = mergeExtraIssueFields(issue, input.extra_fields_json);
    if (Object.keys(merged).length === 0) {
      throw new Error("Provide at least one field to update or extra_fields_json");
    }
    const data = await redmineRequest("PUT", `/issues/${input.issue_id}.json`, undefined, {
      issue: merged,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_log_time",
  {
    description:
      "Log spent time on an issue (POST /time_entries.json). Uses default activity id 164 if activity_id omitted.",
    inputSchema: {
      issue_id: z.number().int().positive(),
      hours: z.number().positive(),
      activity_id: z.number().int().positive().optional(),
      spent_on: z.string().optional().describe("YYYY-MM-DD"),
      comments: z.string().optional(),
    },
  },
  async ({ issue_id, hours, activity_id, spent_on, comments }) => {
    /** @type {Record<string, unknown>} */
    const time_entry = {
      issue_id,
      hours,
      activity_id: activity_id ?? 164,
    };
    if (spent_on) time_entry.spent_on = spent_on;
    if (comments) time_entry.comments = comments;
    const data = await redmineRequest("POST", "/time_entries.json", undefined, {
      time_entry,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_list_users",
  {
    description:
      "List users (needs permission). Optional filter by login/name substring.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
      name: z.string().optional(),
    },
  },
  async ({ limit, offset, name }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (name) params.set("name", name);
    const data = await redmineRequest("GET", "/users.json", params.toString());
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "redmine_get_current_user",
  {
    description: "Return the Redmine user tied to the API key.",
    inputSchema: {},
  },
  async () => {
    const data = await redmineRequest("GET", "/users/current.json");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
