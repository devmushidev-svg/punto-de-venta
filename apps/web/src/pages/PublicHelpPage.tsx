import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { HelpPage } from "./HelpPage";

/** Misma información que `/ayuda`, disponible antes de iniciar sesión (soporte en mostrador). */
export function PublicHelpPage() {
  return (
    <div className="relative min-h-screen min-h-dvh overflow-hidden px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="pf-auth-backdrop-alt" aria-hidden />
      <div className="mx-auto max-w-3xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/50 bg-white/40 px-4 py-3 shadow-lg shadow-stone-900/5 backdrop-blur-md">
          <Link
            to="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl px-2 text-sm font-bold text-pf-primary-hover underline-offset-2 hover:underline touch-manipulation"
          >
            ← Volver al inicio de sesión
          </Link>
          <div className="flex items-center gap-2 text-pf-text">
            <BrandLogo size={32} title="MultiPOS" />
            <span className="font-semibold tracking-tight">MultiPOS</span>
          </div>
        </div>
        <HelpPage />
      </div>
    </div>
  );
}
