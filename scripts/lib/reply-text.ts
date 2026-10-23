/** The agent's reply text from `openclaw agent --json` stdout ("" when absent). */
export function replyText(stdout: string): string {
  const start = stdout.indexOf("{");
  if (start < 0) return "";
  try {
    const envelope = JSON.parse(stdout.slice(start)) as { payloads?: { text?: string }[] };
    return (envelope.payloads ?? []).map((payload) => payload.text ?? "").join(" ").trim();
  } catch {
    return "";
  }
}
