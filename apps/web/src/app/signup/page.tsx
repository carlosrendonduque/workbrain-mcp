import Link from "next/link";
import { SignupForm } from "./_components/signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">Sign up to WorkBrain</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Invite-only while in MVP. Use the token someone sent you.
          </p>
        </div>
        <SignupForm initialToken={token} />
        <p className="mt-4 text-center text-xs text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="text-zinc-300 underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
