"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * The origin Supabase should send the OAuth callback back to.
 *
 * Normally just the current origin, but `0.0.0.0` has to be rewritten:
 * it's a bind-all address, not a real browsing host, and both Docker
 * (compose publishes `0.0.0.0:3000:3000`, which Docker Desktop renders as
 * a clickable link) and some dev-server banners surface it. Browsing there
 * makes Supabase receive `redirect_to=http://0.0.0.0:3000/auth/callback`,
 * fail to match it against the project's redirect allow-list, and fall
 * back to the Site URL — stranding the user on `https://0.0.0.0:3000`,
 * which serves plain HTTP and dies with ERR_SSL_PROTOCOL_ERROR. localhost
 * is the same machine and IS allow-listed, so this keeps sign-in working
 * no matter which of the two the user happened to click.
 */
function callbackOrigin(): string {
  const { protocol, hostname, port, origin } = window.location;
  if (hostname === "0.0.0.0") {
    return `${protocol}//localhost${port ? `:${port}` : ""}`;
  }
  return origin;
}

export function GoogleButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${callbackOrigin()}/auth/callback`,
      },
    });
    // On success the browser navigates away; only errors land here.
    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending}
        size="lg"
        className="w-full"
        variant="outline"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.14-4.06 1.14-3.12 0-5.77-2.11-6.71-4.95H1.29v3.09A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.29 14.28a7.21 7.21 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l4-3.09Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.63l4 3.09C6.23 6.88 8.88 4.77 12 4.77Z"
          />
        </svg>
        {pending ? "Redirecting…" : label}
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
