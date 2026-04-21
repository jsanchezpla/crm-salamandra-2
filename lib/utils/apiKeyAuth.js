export function verifyApiKey(request) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.RETORIKA_API_KEY) {
    return false;
  }
  return true;
}
