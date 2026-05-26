import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';

export default function AuthGuard({ children }) {
  const [session, setSession]   = useState(undefined); // undefined = loading
  const [email, setEmail]       = useState('');
  const [sent, setSent]         = useState(false);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setSending(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  };

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session) return children;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Life Organizer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to continue</p>
        </div>

        {sent ? (
          <div className="text-center space-y-2">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Check your email</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Magic link sent to <span className="font-mono">{email}</span>
            </p>
            <button
              onClick={() => setSent(false)}
              className="text-xs text-indigo-600 dark:text-indigo-400 underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSignIn} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={sending || !email}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
