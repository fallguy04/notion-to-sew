import { redirect } from "next/navigation";
import { isStaff } from "@/lib/auth";
import { ToastHost } from "@/components/toast";
import Nav from "./nav";

/**
 * The gate for everything under /admin.
 *
 * A layout guard covers every page and every nested route in one place, which
 * a per-page check does not: the page you forget to protect is the one that
 * leaks. Server actions check separately in requireStaff(), because an action
 * is its own endpoint and never passes through this layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isStaff())) {
    redirect("/?choose=1&locked=1");
  }

  return (
    <ToastHost>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <Nav />
        <main className="min-w-0 flex-1 px-5 pb-24 pt-6 lg:px-10 lg:pt-9">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </ToastHost>
  );
}
