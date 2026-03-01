import { Suspense } from "react";
import MenuClient from "./MenuClient";

export const dynamic = "force-dynamic";

export default function MenuPage() {
  return (
    <Suspense fallback={<div className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Loading menu...</div>}>
      <MenuClient />
    </Suspense>
  );
}
