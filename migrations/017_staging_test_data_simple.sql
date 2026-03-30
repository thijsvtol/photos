-- Staging test data for security probe
-- Creates events for access control testing

-- Private event: starten (for testing admin access, anon should be denied)
INSERT INTO events (slug, name, password_salt, password_hash, inferred_date, visibility)
VALUES (
  'starten',
  'Starten Private Event',
  'stage-salt-private',
  'stage-hash-no-password',
  '2026-03-30',
  'private'
);

-- Collaborators-only event: thijs-x-dennis
INSERT INTO events (slug, name, password_salt, password_hash, inferred_date, visibility)
VALUES (
  'thijs-x-dennis',
  'Thijs & Dennis Collaboration',
  'stage-salt-collab',
  'stage-hash-no-password',
  '2026-03-28',
  'collaborators_only'
);
