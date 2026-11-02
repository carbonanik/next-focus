export const apiConfig = {
  baseUrl: (
    globalThis.NEXTFOCUS_API_URL ||
    globalThis.localStorage?.getItem("nextfocus_api_url") ||
    "https://YOUR-SERVICE.onrender.com"
  ).replace(/\/$/, "")
};

export function isApiConfigured() {
  return Boolean(apiConfig.baseUrl && !apiConfig.baseUrl.includes("YOUR-SERVICE"));
}
