-- Manual person tagging on photos, separate from the automatic face-detection pipeline
-- (photo_faces/person_clusters — see migration 023 + apps/worker/src/faceClustering.ts).
--
-- WHY A SEPARATE TABLE: photo_faces rows are always tied to a real detected face (embedding +
-- bounding box), and are the input to the clustering/centroid math. A manual "this person is
-- also in this photo" tag from an admin often has no corresponding detected face at all (the
-- model missed them entirely, e.g. turned away from camera, heavily occluded) — forcing a fake/
-- zero embedding into photo_faces would either corrupt centroid averaging or require excluding
-- it everywhere that table is read, for no benefit. A dedicated many-to-many table keeps manual
-- tags completely independent of (and safe from) any clustering/rebuild operation.
CREATE TABLE IF NOT EXISTS photo_person_tags (
  photo_id TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (photo_id, person_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES person_clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_person_tags_photo_id ON photo_person_tags(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_person_tags_person_id ON photo_person_tags(person_id);
