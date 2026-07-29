WITH funnel AS (
  SELECT
    COUNT(DISTINCT CASE WHEN name = 'visited' THEN session_id END) AS users,
    COUNT(DISTINCT CASE WHEN name = 'manual_started' THEN session_id END) AS starters,
    COUNT(DISTINCT CASE WHEN name = 'photo_added' THEN session_id END) AS photo_users,
    COUNT(DISTINCT CASE WHEN name = 'step_edited' THEN session_id END) AS step_editors,
    COUNT(DISTINCT CASE WHEN name = 'printed' THEN session_id END) AS printers,
    COUNT(DISTINCT CASE WHEN name = 'project_exported' THEN session_id END) AS exporters,
    COUNT(DISTINCT CASE WHEN name = 'project_imported' THEN session_id END) AS importers,
    COUNT(DISTINCT CASE WHEN name = 'returned' THEN session_id END) AS returned,
    COUNT(DISTINCT CASE WHEN name IN ('photo_added', 'step_edited') AND created_at >= unixepoch() - 604800 THEN session_id END) AS editors_7d,
    COUNT(DISTINCT CASE WHEN name = 'printed' AND created_at >= unixepoch() - 604800 THEN session_id END) AS printers_7d
  FROM product_events
  WHERE is_qa = 0
)
SELECT * FROM funnel;
