import { FetchError } from "./errors";

/** Reads a response body as text, failing with `too_large` once it exceeds `maxBytes`. */
export async function readCapped(res: Response, maxBytes: number, url: string): Promise<string> {
  const tooLarge = () => new FetchError("too_large", `Response from ${url} exceeds ${maxBytes} bytes`, { url });
  if (Number(res.headers.get("content-length")) > maxBytes) throw tooLarge();
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
