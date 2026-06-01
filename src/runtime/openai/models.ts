const MODEL_LIST = {
  object: "list",
  data: [
    { id: "rovodev-auto", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-haiku-4-5", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-sonnet-4", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-sonnet-4-5", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-sonnet-4-6", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gemini-3-flash-preview", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-1", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-2", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-2-codex", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-4", object: "model", owned_by: "atlassian-rovodev" },
  ],
};

export function handleModelsRequest(): Response {
  return Response.json(MODEL_LIST);
}
