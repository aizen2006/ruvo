/**
 * Text quoted from a source page, with the part the value was read from marked in signal. Set
 * in mono on solid `sheet`, like a slip of the page laid on the frosted drawer.
 * When the value is not literally in the quote (it was parsed or normalised), the whole quote is
 * the evidence and is marked instead.
 */
export function Quote({ snippet, value }: { snippet: string; value: string }) {
  const at = value ? snippet.toLowerCase().indexOf(value.toLowerCase()) : -1;
  return (
    <blockquote className="rounded-control border border-hairline bg-sheet px-3 py-2.5 font-mono text-small leading-relaxed break-words">
      {at < 0 ? (
        <span className="mark">{snippet}</span>
      ) : (
        <>
          {snippet.slice(0, at)}
          <span className="mark">{snippet.slice(at, at + value.length)}</span>
          {snippet.slice(at + value.length)}
        </>
      )}
    </blockquote>
  );
}
