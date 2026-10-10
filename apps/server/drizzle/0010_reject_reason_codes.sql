-- Reject reasons carry a stable code beside their message, and the run funnel counts codes.
-- Reasons stored as plain messages get the code their wording has always stood for.
UPDATE "records" SET "reject_reasons" = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(r) <> 'string' THEN r
      WHEN r #>> '{}' ~ '^Missing required fields?: ' THEN jsonb_build_object(
        'code', 'missing_fields',
        'fields', to_jsonb(string_to_array(substring(r #>> '{}' from '^Missing required fields?: (.*)$'), ', ')),
        'message', r #>> '{}')
      WHEN r #>> '{}' ~ '^Not a valid http\(s\) link: ' THEN jsonb_build_object(
        'code', 'invalid_link',
        'fields', jsonb_build_array(substring(r #>> '{}' from '^Not a valid http\(s\) link: (.*)$')),
        'message', r #>> '{}')
      ELSE jsonb_build_object('code', 'criterion_not_met', 'message', r #>> '{}')
    END ORDER BY i)
  FROM jsonb_array_elements("reject_reasons") WITH ORDINALITY AS t(r, i)
)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("reject_reasons") r WHERE jsonb_typeof(r) = 'string');
