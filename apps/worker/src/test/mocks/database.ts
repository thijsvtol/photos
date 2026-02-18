import type { EventRecord, PhotoRecord, CollaboratorRecord } from './types';

export class MockD1Statement {
  private args: unknown[] = [];

  constructor(private query: string, private db: MockD1Database) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async all<T>() {
    return { results: this.db.handleAll(this.query, this.args) as T[] };
  }

  async first<T>() {
    return this.db.handleFirst(this.query, this.args) as T | null;
  }

  async run() {
    return this.db.handleRun(this.query, this.args);
  }
}

export class MockD1Database {
  runLog: Array<{ query: string; args: unknown[] }> = [];
  events: EventRecord[] = [];
  photos: PhotoRecord[] = [];
  favorites: Array<{ photo_id: string; user_email: string }> = [];
  collaborators: CollaboratorRecord[] = [];
  collaborationHistory: any[] = [];
  queryLog: Array<{ query: string; args: unknown[] }> = [];
  deletedPhotos: Set<string> = new Set();
  deletedEvents: Set<number> = new Set();

  constructor(
    events: EventRecord[] = [],
    photos: PhotoRecord[] = [],
    collaborators: Record<number, string[]> = {}
  ) {
    this.events = events;
    this.photos = photos;
    this.collaborators = Object.entries(collaborators).flatMap(([eventId, emails]) =>
      emails.map(email => ({ event_id: Number(eventId), user_email: email }))
    );
  }

  prepare(query: string) {
    return new MockD1Statement(query, this);
  }

  handleAll(query: string, args: unknown[]) {
    if (query.includes('FROM events e')) {
      const userEmail = String(args[0] || '');
      const isAdmin = Number(args[1] || 0) === 1;
      return this.events
        .filter(event => {
          if (event.visibility === 'public') return true;
          if (isAdmin) return true;
          if (event.visibility === 'collaborators_only') {
            return this.isCollaborator(event.id, userEmail);
          }
          return false;
        })
        .map(event => ({
          ...event,
          requires_password: event.password_hash !== null,
        }));
    }

    if (query.includes('SELECT DISTINCT city FROM photos')) {
      const eventId = Number(args[0]);
      const cities = this.photos
        .filter(photo => photo.event_id === eventId && photo.city)
        .map(photo => photo.city as string);
      return Array.from(new Set(cities)).sort().map(city => ({ city }));
    }

    if (query.includes('FROM tags t')) {
      return [];
    }

    if (query.includes('FROM photos p') && query.includes('WHERE p.event_id = ?')) {
      const eventId = Number(args[0]);
      return this.photos.filter(photo => photo.event_id === eventId);
    }

    if (query.includes('SELECT id, original_filename, capture_time FROM photos')) {
      const eventId = Number(args[0]);
      const photoIds = args.slice(1).map(value => String(value));
      return this.photos.filter(photo => photo.event_id === eventId && photoIds.includes(photo.id));
    }

    return [];
  }

  handleFirst(query: string, args: unknown[]) {
    if (query.includes('FROM events WHERE slug = ?')) {
      const slug = String(args[0]);
      const event = this.events.find(item => item.slug === slug) || null;
      if (!event) return null;

      if (query.includes('requires_password')) {
        return {
          id: event.id,
          slug: event.slug,
          name: event.name,
          inferred_date: event.inferred_date,
          created_at: event.created_at,
          visibility: event.visibility,
          requires_password: event.password_hash !== null,
        };
      }

      if (query.includes('id, name')) {
        return {
          id: event.id,
          name: event.name,
          password_hash: query.includes('password_hash') ? event.password_hash : undefined,
        };
      }

      return {
        id: event.id,
        password_hash: event.password_hash,
        visibility: event.visibility,
      };
    }

    if (query.includes('SELECT user_email FROM event_collaborators')) {
      const eventId = Number(args[0]);
      const userEmail = String(args[1] || '');
      return this.isCollaborator(eventId, userEmail) ? { user_email: userEmail } : null;
    }

    if (query.includes('SELECT 1 FROM event_collaborators')) {
      if (query.includes('JOIN events e')) {
        const slug = String(args[0]);
        const userEmail = String(args[1] || '');
        const event = this.events.find(item => item.slug === slug);
        if (!event) return null;
        return this.isCollaborator(event.id, userEmail) ? { exists: 1 } : null;
      }

      const eventId = Number(args[0]);
      const userEmail = String(args[1] || '');
      return this.isCollaborator(eventId, userEmail) ? { exists: 1 } : null;
    }

    if (query.includes('SELECT id FROM photos WHERE event_id = ?')) {
      const eventId = Number(args[0]);
      const photo = this.photos.find(item => item.event_id === eventId) || null;
      return photo ? { id: photo.id } : null;
    }

    if (query.includes('SELECT id, event_id FROM photos WHERE id = ?')) {
      const photoId = String(args[0]);
      return this.photos.find(item => item.id === photoId) || null;
    }

    if (query.includes('SELECT file_type FROM photos WHERE id = ?')) {
      const photoId = String(args[0]);
      const photo = this.photos.find(item => item.id === photoId) || null;
      return photo ? { file_type: photo.file_type } : null;
    }

    if (query.includes('FROM photos p') && query.includes('WHERE p.id = ?')) {
      const photoId = String(args[0]);
      const eventId = Number(args[1]);
      return this.photos.find(item => item.id === photoId && item.event_id === eventId) || null;
    }

    return null;
  }

  handleRun(query: string, args: unknown[]) {
    this.runLog.push({ query, args });

    // Handle cascade delete for events
    if (query.includes('DELETE FROM events WHERE')) {
      const eventId = Number(args[0]);
      this.deletedEvents.add(eventId);
      this.photos = this.photos.filter(p => p.event_id !== eventId);
      this.collaborators = this.collaborators.filter(c => c.event_id !== eventId);
      this.favorites = this.favorites.filter(f =>
        !this.photos.find(p => p.id === f.photo_id && p.event_id === eventId)
      );
      this.collaborationHistory = this.collaborationHistory.filter(h => h.event_id !== eventId);
      return { success: true, meta: { changes: 1 } };
    }

    // Handle cascade delete for photos
    if (query.includes('DELETE FROM photos WHERE')) {
      const photoId = String(args[0]);
      this.deletedPhotos.add(photoId);
      this.photos = this.photos.filter(p => p.id !== photoId);
      this.favorites = this.favorites.filter(f => f.photo_id !== photoId);
      return { success: true, meta: { changes: 1 } };
    }

    if (query.includes('INSERT INTO event_collaborators')) {
      const eventId = Number(args[0]);
      const email = String(args[1]);
      const existing = this.isCollaborator(eventId, email);
      if (!existing) {
        this.collaborators.push({ event_id: eventId, user_email: email });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (query.includes('DELETE FROM event_collaborators')) {
      const eventId = Number(args[0]);
      const email = String(args[1]);
      const before = this.collaborators.length;
      this.collaborators = this.collaborators.filter(
        item => !(item.event_id === eventId && item.user_email === email)
      );
      const changes = before - this.collaborators.length;
      return { success: true, meta: { changes } };
    }

    if (query.includes('INSERT INTO favorites')) {
      const photoId = String(args[0]);
      const userEmail = String(args[1]);
      const existing = this.favorites.find(f => f.photo_id === photoId && f.user_email === userEmail);
      if (!existing) {
        this.favorites.push({ photo_id: photoId, user_email: userEmail });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (query.includes('DELETE FROM favorites')) {
      const photoId = String(args[0]);
      const userEmail = String(args[1]);
      const before = this.favorites.length;
      this.favorites = this.favorites.filter(
        f => !(f.photo_id === photoId && f.user_email === userEmail)
      );
      return { success: true, meta: { changes: before - this.favorites.length } };
    }

    if (query.includes('INSERT INTO collaboration_history')) {
      return { success: true, meta: { changes: 1 } };
    }

    return { success: true, meta: { changes: 1 } };
  }

  private isCollaborator(eventId: number, userEmail: string) {
    return this.collaborators.some(c => c.event_id === eventId && c.user_email === userEmail);
  }
}
