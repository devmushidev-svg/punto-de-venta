export function AppAmbient({ className = "" }: { className?: string }) {
  return (
    <div className={`pf-dashboard-ambient ${className}`} aria-hidden="true">
      <span className="pf-dashboard-ambient-orb pf-dashboard-ambient-orb-primary" />
      <span className="pf-dashboard-ambient-orb pf-dashboard-ambient-orb-mint" />
      <span className="pf-dashboard-ambient-orb pf-dashboard-ambient-orb-sky" />
    </div>
  );
}
