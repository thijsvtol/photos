import { useForm, ValidationError } from '@formspree/react';

interface ContactFormProps {
  formId: string;
}

export default function ContactForm({ formId }: ContactFormProps) {
  const [state, handleSubmit] = useForm(formId);

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl mx-auto space-y-6"
    >
      {state.succeeded ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 px-4 py-3 rounded-lg text-center">
          <p className="font-medium">Thanks for your message!</p>
          <p className="text-sm mt-1">I'll get back to you soon.</p>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              disabled={state.submitting}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <ValidationError 
              prefix="Name" 
              field="name"
              errors={state.errors}
              className="text-red-600 text-sm mt-1"
            />
          </div>
          
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              disabled={state.submitting}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <ValidationError 
              prefix="Email" 
              field="email"
              errors={state.errors}
              className="text-red-600 text-sm mt-1"
            />
          </div>
          
          <div>
            <label htmlFor="message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              rows={5}
              required
              disabled={state.submitting}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <ValidationError 
              prefix="Message" 
              field="message"
              errors={state.errors}
              className="text-red-600 text-sm mt-1"
            />
          </div>
          
          <button
            type="submit"
            disabled={state.submitting}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.submitting ? 'Sending...' : 'Send Message'}
          </button>
        </>
      )}
    </form>
  );
}
