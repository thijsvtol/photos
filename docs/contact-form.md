# Contact Form Setup

The landing page (`apps/web/src/pages/Landing.tsx`) already includes a working contact form
(`apps/web/src/components/ContactForm.tsx`) built on [Formspree](https://formspree.io/) via the
`@formspree/react` package's `useForm` hook - there's no backend endpoint to build, just a Formspree
form ID to configure.

## Configuring Your Own Formspree Form ID

1. Go to [formspree.io](https://formspree.io/) and sign up for a free account
2. Create a new form
3. Copy your form ID (the part after `/f/` in your form endpoint, e.g. `https://formspree.io/f/xyzabc123` -> `xyzabc123`)
4. Update the `formId` prop passed to `<ContactForm />` in `apps/web/src/pages/Landing.tsx`:

   ```tsx
   <ContactForm formId="YOUR-FORM-ID" />
   ```

The `formId` is currently hardcoded in `Landing.tsx` rather than read from an environment variable,
so self-hosters need to edit this line directly (or wire it up to a `VITE_*` env var if you'd
prefer it configurable at build/runtime).

## Displayed Contact Email

Separately from the form itself, the contact email shown elsewhere in the UI (footer, privacy
policy) comes from the `contactEmail` runtime config (`apps/web/src/config.ts`), which reads
`VITE_CONTACT_EMAIL` in development or the worker-injected runtime config in production - see
[configuration.md](./configuration.md) for how to set `CONTACT_EMAIL`.

## Alternative: Worker-Based Contact Endpoint

If you'd rather not depend on Formspree, you can replace `ContactForm.tsx` with a plain form that
posts to a custom worker route instead. There's no such route in `apps/worker/src/routes/` today,
but a minimal example using [MailChannels](https://www.mailchannels.com/) (usable for free from
Cloudflare Workers, subject to their current terms) would look like this:

```typescript
import { Hono } from 'hono';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

app.post('/api/contact', async (c) => {
  try {
    const { name, email, message } = await c.req.json<{ name?: string; email?: string; message?: string }>();

    if (!name || !email || !message) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: c.env.CONTACT_EMAIL }] }],
        from: { email: 'noreply@yourdomain.com', name: 'Contact Form' },
        subject: `Contact Form: Message from ${name}`,
        content: [
          {
            type: 'text/plain',
            value: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to send message' }, 502);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error);
    return c.json({ error: 'Failed to send message' }, 500);
  }
});

export const contactRoutes = app;
```

You would also need to mount this route in `apps/worker/src/index.ts` and update `ContactForm.tsx`
to submit to `/api/contact` instead of using the Formspree hook.
