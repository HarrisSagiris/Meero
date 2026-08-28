import { AuthShell } from "@/modules/auth/views/ui/auth-shell";
import { AuthForm } from "@/modules/auth/views/ui/auth-form";

export const metadata = { title: "Log in — Meero" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell>
      <AuthForm mode="login" initialError={error} />
    </AuthShell>
  );
}
