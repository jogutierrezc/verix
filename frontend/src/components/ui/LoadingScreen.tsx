export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-neutral-500 font-medium">Cargando...</p>
      </div>
    </div>
  );
}
