/** The kinds of file RUVO knows as documents; spreadsheets, archives, images and the rest stay unread. */
export type DocKind = "pdf";

/**
 * The kind of document a link leads to: by its content type when one is known (a generic binary type
 * says nothing), else by its path's extension. Null for anything else, web pages included.
 */
export function docKindOf(url: string, contentType?: string): DocKind | null {
  const type = contentType?.split(";")[0]!.trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type && !type.endsWith("octet-stream")) return null;
  try {
    return /\.pdf$/i.test(new URL(url).pathname) ? "pdf" : null;
  } catch {
    return null;
  }
}
