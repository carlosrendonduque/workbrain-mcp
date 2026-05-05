export interface Config {
  apiUrl: string;
  apiKey: string;
}

export function loadConfig(): Config {
  const apiUrl = process.env.WORKBRAIN_API_URL;
  const apiKey = process.env.WORKBRAIN_API_KEY;
  if (!apiUrl) {
    throw new Error("WORKBRAIN_API_URL is not set");
  }
  if (!apiKey) {
    throw new Error("WORKBRAIN_API_KEY is not set");
  }
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}
