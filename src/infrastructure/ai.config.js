export const aiConfig = {
  provider: "gemini",
  apiKey: "AQ.Ab8RN6JnjgccVgnCKoWrZV80cwzjsUqskL6L10Spw0sU6QeL0w",
  model: "gemini-3.5-flash-lite",
  suggestionCount: 6
};

export function isAiConfigured() {
  return Boolean(
    aiConfig.apiKey &&
    !aiConfig.apiKey.startsWith("YOUR_") &&
    aiConfig.model
  );
}