# Contact Form Setup

The Landing page includes a contact form that needs to be configured with a form backend service.

## Option 1: Formspree (Recommended - Free & Easy)

1. Go to [formspree.io](https://formspree.io/)
2. Sign up for a free account
3. Create a new form
4. Copy your form endpoint (looks like `https://formspree.io/f/xyzabc123`)
5. Update the form action in `apps/web/src/pages/Landing.tsx`:
   ```tsx
   <form
     action="https://formspree.io/f/YOUR-FORM-ID"
     method="POST"
     ...
   ```

## Option 2: MailChannels Worker Endpoint

Alternatively, you can implement a serverless email endpoint using MailChannels (free on Cloudflare Workers):

1. Add to `apps/worker/src/routes/public.ts`:

```typescript
import { Hono } from 'hono';

export const publicRoutes = new Hono<{ Bindings: Env }>();

// ... existing routes ...

publicRoutes.post('/contact', async (c) => {
  try {
    const { name, email, message } = await c.req.json();
    
    // Validate inputs
    if (!name || !email || !message) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Send email using MailChannels
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: 'your-email@example.com', name: 'Your Name' }],
          },
        ],
        from: {
          email: 'noreply@photos.yourdomain.com',
          name: 'Photo Gallery Contact Form',
        },
        subject: `Contact Form: Message from ${name}`,
        content: [
          {
            type: 'text/plain',
            value: `
Name: ${name}
Email: ${email}

Message:
${message}
            `.trim(),
          },
        ],
      }),
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error);
    return c.json({ error: 'Failed to send message' }, 500);
  }
});
```

2. Update the form in `Landing.tsx` to use async submit:

```typescript
const [formState, setFormState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  setFormState('sending');
  
  const formData = new FormData(e.currentTarget);
  const data = {
    name: formData.get('name'),
    email: formData.get('email'),
    message: formData.get('message'),
  };
  
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (response.ok) {
      setFormState('success');
      e.currentTarget.reset();
    } else {
      setFormState('error');
    }
  } catch (error) {
    setFormState('error');
  }
};
```

## Current Email

The contact email displayed on the page is: **vantol.thijs@gmail.com**

Update this in `Landing.tsx` if needed.
