-- Migration 017: Add missing indexes for common query patterns
-- Addresses N+1 query optimizations and common lookup patterns

-- Composite index for collaborator lookups (event_id + user_email)
-- Used by: access control checks, event visibility filtering
CREATE INDEX IF NOT EXISTS idx_event_collaborators_lookup 
  ON event_collaborators(event_id, user_email);

-- Index for city queries filtered by event
-- Used by: GET /api/events (batch cities), event detail cities list
CREATE INDEX IF NOT EXISTS idx_photos_event_city 
  ON photos(event_id, city) WHERE city IS NOT NULL;

-- Index for event_tags lookups (batch tag fetching)
-- Used by: GET /api/events (batch tags)
CREATE INDEX IF NOT EXISTS idx_event_tags_event 
  ON event_tags(event_id);

-- Index for photos ordered by featured+capture_time per event (preview photo selection)
-- Used by: GET /api/events (preview photo), gallery ordering
CREATE INDEX IF NOT EXISTS idx_photos_event_featured_time 
  ON photos(event_id, is_featured DESC, capture_time ASC);
