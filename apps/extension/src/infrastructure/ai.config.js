export const aiConfig = {
  provider: "gemini",
  apiKey: "",
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