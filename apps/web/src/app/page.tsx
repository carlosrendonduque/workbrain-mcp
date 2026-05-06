import { redirect } from "next/navigation";
import { readSession } from "@/lib/webapp-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await readSession();
  redirect(session ? "/dashboard" : "/login");
}
