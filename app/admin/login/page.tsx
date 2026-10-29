import type { Metadata } from "next";
import { site } from "@/config/site";
import { adminConfigured } from "@/lib/auth";
import { login } from "../actions";

export const metadata: Metadata = { title: "Admin-Login", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { fehler } = await searchParams;
  const configured = adminConfigured();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form action={login} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <p className="text-lg font-bold">
          <span className="text-brand">●</span> {site.brand.name}
        </p>
        <h1 className="mt-1 text-sm text-slate-500">Admin-Bereich</h1>
        {configured ? (
          <>
            <label className="mt-6 block">
              <span className="text-sm font-medium">Passwort</span>
              <input
                name="password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
            </label>
            {fehler && <p className="mt-3 text-sm text-red-600">Passwort ist falsch.</p>}
            <button type="submit" className="mt-6 w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark">
              Anmelden
            </button>
          </>
        ) : (
          <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            Der Admin-Bereich ist gesperrt, bis <code>ADMIN_PASSWORD</code> in der Umgebung (z. B. <code>.env.local</code>) gesetzt ist.
          </p>
        )}
      </form>
    </div>
  );
}
