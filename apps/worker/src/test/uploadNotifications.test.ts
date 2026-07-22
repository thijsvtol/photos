import { describe, it, expect } from 'vitest';
import { groupUploadNotifications, type NewPhotoRow } from '../scheduled';

const rows = (list: Array<[string, number, string]>): NewPhotoRow[] =>
  list.map(([id, event_id, uploaded_by]) => ({
    id,
    event_id,
    event_name: `Event ${event_id}`,
    event_slug: `event-${event_id}`,
    uploaded_by,
  }));

describe('groupUploadNotifications', () => {
  it('batches photos per event and counts them', () => {
    const result = groupUploadNotifications(
      rows([
        ['p1', 1, 'alice@example.com'],
        ['p2', 1, 'alice@example.com'],
        ['p3', 2, 'bob@example.com'],
      ]),
      new Map([
        [1, ['alice@example.com', 'carol@example.com']],
        [2, ['bob@example.com', 'dave@example.com']],
      ]),
      []
    );

    const event1 = result.find((r) => r.eventId === 1)!;
    const event2 = result.find((r) => r.eventId === 2)!;
    expect(event1.photoCount).toBe(2);
    expect(event2.photoCount).toBe(1);
  });

  it('excludes uploaders from recipients (even across case/whitespace)', () => {
    const result = groupUploadNotifications(
      rows([['p1', 1, '  Alice@Example.com ']]),
      new Map([[1, ['alice@example.com', 'carol@example.com']]]),
      []
    );
    expect(result[0].recipients).toEqual(['carol@example.com']);
  });

  it('includes admin emails as recipients and de-duplicates', () => {
    const result = groupUploadNotifications(
      rows([['p1', 1, 'alice@example.com']]),
      new Map([[1, ['carol@example.com']]]),
      ['admin@example.com', 'carol@example.com']
    );
    expect(result[0].recipients.sort()).toEqual(
      ['admin@example.com', 'carol@example.com'].sort()
    );
  });

  it('does not notify a solo uploader with no other collaborators', () => {
    const result = groupUploadNotifications(
      rows([['p1', 1, 'alice@example.com']]),
      new Map([[1, ['alice@example.com']]]),
      []
    );
    expect(result[0].recipients).toEqual([]);
  });

  it('tracks distinct uploaders per event', () => {
    const result = groupUploadNotifications(
      rows([
        ['p1', 1, 'alice@example.com'],
        ['p2', 1, 'bob@example.com'],
        ['p3', 1, 'alice@example.com'],
      ]),
      new Map([[1, ['carol@example.com']]]),
      []
    );
    expect(result[0].uploaders).toHaveLength(2);
    expect(result[0].photoCount).toBe(3);
  });
});
