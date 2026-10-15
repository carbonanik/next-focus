import { aiConfig, isAiConfigured } from "./ai.config.js";
import { fetchWithTimeout } from "./http.js";

const suggestionSchema = {
  type: "ARRAY",
  minItems: 3,
  maxItems: 8,
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" },
      estimatedMinutes: {
        type: "INTEGER",
        minimum: 5,
        maximum: 240
      },
      notes: { type: "STRING" }
    },
    required: [
      "title",
      "estimatedMinutes",
      "notes"
    ]
  }
};

function buildPrompt(goal, existingTasks) {
  const existing = existingTasks.length
    ? existingTasks.map((task) => `- ${task.title}`).join("\n")
    : "- None yet";

  return `
You are helping a user break a goal into executable tasks.

Goal name:
${goal.title}

Desired outcome:
${goal.description || "Not provided"}

Goal notes:
${goal.notes || "None"}

Existing tasks for this goal:
${existing}

Suggest ${aiConfig.suggestionCount} useful tasks that move this goal toward completion.

Rules:
- Every task must be an executable action, not a vague category.
- Use the smallest meaningful unit that requires no additional planning.
- Do not make tasks absurdly tiny.
- Avoid duplicating any existing task.
- Prefer clear verb-first titles.
- Put tasks in a sensible execution order.
- estimatedMinutes should be realistic for one focused work session.
- notes should be one short sentence explaining what "done" means.
- Return only the structured response requested by the schema.
`;
}

function normalizeSuggestion(item) {
  const title = String(item?.title ?? "").trim();

  if (!title) return null;

  const estimatedMinutes = Number(item?.estimatedMinutes);

  return {
    title,

    estimatedMinutes: Number.isFinite(estimatedMinutes)
      ? Math.min(240, Math.max(5, Math.round(estimatedMinutes)))
      : 30,

    notes: String(item?.notes ?? "").trim()
  };
}

async function geminiSuggestTasks({
  goal,
  existingTasks
}) {
  if (!isAiConfigured()) {
    throw new Error(
      "AI suggestions are disabled until a private AI service is configured."
    );
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(aiConfig.model)}:generateContent`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": aiConfig.apiKey
      },

      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt(
                  goal,
                  existingTasks
                )
              }
            ]
          }
        ],

        generationConfig: {
          temperature: 0.45,

          responseMimeType:
            "application/json",

          responseSchema:
            suggestionSchema
        }
      })
    },
    30000
  );

  const payload = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
      "Could not generate task suggestions."
    );
  }

  const text =
    payload
      ?.candidates?.[0]
      ?.content
      ?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  if (!text) {
    throw new Error(
      "AI returned no task suggestions."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "AI returned an invalid task suggestion response."
    );
  }

  const suggestions = (
    Array.isArray(parsed)
      ? parsed
      : []
  )
    .map(normalizeSuggestion)
    .filter(Boolean);

  if (!suggestions.length) {
    throw new Error(
      "AI returned no usable task suggestions."
    );
  }

  return suggestions;
}

export const taskSuggestionProvider = {
  async suggestTasks(input) {
    switch (aiConfig.provider) {
      case "gemini":
        return geminiSuggestTasks(input);

      default:
        throw new Error(
          `Unsupported AI provider: ${aiConfig.provider}`
        );
    }
  }
};