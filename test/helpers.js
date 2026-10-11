// A fake fetch that replays queued responses and records each request body.

export function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch: no response queued');
    if (next instanceof Error) throw next;
    const { status = 200, json, text = '' } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => (json ? JSON.stringify(json) : text),
    };
  };
  return { impl, calls };
}

export const completion = (content, finishReason = 'stop') => ({
  json: { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finishReason }] },
});
