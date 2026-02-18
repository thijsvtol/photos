import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply admin authentication
app.use('/*', requireAdmin);

/**
 * POST /tags
 * Create a new tag
 */
app.post('/', async (c) => {
  try {
    const { name, slug } = await c.req.json<{
      name: string;
      slug?: string;
    }>();
    
    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    
    // Generate slug if not provided
    const tagSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    const result = await c.env.DB
      .prepare('INSERT INTO tags (name, slug) VALUES (?, ?) RETURNING *')
      .bind(name, tagSlug)
      .first();
    
    return c.json({ tag: result });
  } catch (error) {
    console.error('Error creating tag:', error);
    return c.json({ error: 'Failed to create tag' }, 500);
  }
});

/**
 * PUT /tags/:id
 * Update a tag
 */
app.put('/:id', async (c) => {
  const tagId = parseInt(c.req.param('id'));
  
  try {
    const { name, slug } = await c.req.json<{
      name?: string;
      slug?: string;
    }>();
    
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (slug !== undefined) {
      updates.push('slug = ?');
      values.push(slug);
    }
    
    if (updates.length === 0) {
      return c.json({ error: 'No updates provided' }, 400);
    }
    
    values.push(tagId);
    
    await c.env.DB
      .prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    
    const updated = await c.env.DB
      .prepare('SELECT * FROM tags WHERE id = ?')
      .bind(tagId)
      .first();
    
    return c.json({ tag: updated });
  } catch (error) {
    console.error('Error updating tag:', error);
    return c.json({ error: 'Failed to update tag' }, 500);
  }
});

/**
 * DELETE /tags/:id
 * Delete a tag
 */
app.delete('/:id', async (c) => {
  const tagId = parseInt(c.req.param('id'));
  
  try {
    // Delete tag (cascade will handle event_tags)
    await c.env.DB
      .prepare('DELETE FROM tags WHERE id = ?')
      .bind(tagId)
      .run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return c.json({ error: 'Failed to delete tag' }, 500);
  }
});

export default app;
