import { redirect } from "next/navigation";

export default function LegacyCanonRedirect() {
  redirect("/account/canons");
}
