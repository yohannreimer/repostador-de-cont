import { SrtWorkflow } from "../components/srt-workflow";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -left-28 -top-24 h-72 w-72 rounded-full bg-blue-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-56 h-64 w-64 -translate-x-1/2 rounded-full bg-cyan-100/40 blur-3xl" />

      <header className="mx-auto max-w-[1320px] px-4 pt-10 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex rounded-full border border-slate-300 bg-white/85 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
            Authority Distribution Engine · Quality OS
          </p>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-500 hover:bg-white"
            >
              Sair
            </button>
          </form>
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900 md:text-5xl">
          Workspace premium para repurpose multicanal
        </h1>
        <p className="mt-3 max-w-4xl text-sm text-slate-600 md:text-base">
          Um fluxo de ponta a ponta com controle de modelos, prompts, diretrizes editoriais e gate de publicacao para entregar conteudo com nivel premium em Reels, Newsletter, LinkedIn e X.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Fluxo guiado</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">6 etapas claras</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Qualidade real</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Score + publishability</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Controle fino</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Refino por bloco</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Export rapido</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">PDF, TXT e Markdown</p>
          </div>
        </div>
      </header>

      <SrtWorkflow />
    </main>
  );
}
