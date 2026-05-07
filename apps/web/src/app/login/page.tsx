import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/webapp-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await readSession();
  const params = await searchParams;
  const next = params.next ?? "/dashboard";

  if (session) {
    redirect(next);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">WorkBrain</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in with your API key.</p>
        </div>
        <LoginForm next={next} />
        <p className="mt-4 text-center text-xs text-zinc-500">
          Don't have an account?{" "}
          <Link href="/signup" className="text-zinc-300 underline-offset-2 hover:underline">
            Redeem an invitation
          </Link>
        </p>
      </div>
    </main>
  );
}
