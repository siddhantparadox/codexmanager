import { useAppState } from "../store/appStore";

type TopbarProps = {
  title: string;
  subtitle: string;
};

export default function Topbar({ title, subtitle }: TopbarProps) {
  const { busy, notice } = useAppState();

  return (
    <header className="topbar">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      <div className="topbar-meta">
        <div className="status-pill">
          <span className={`status-dot ${busy ? "busy" : "ready"}`} />
          {busy ? "Working" : "Ready"}
        </div>
        {notice ? <span className="notice">{notice}</span> : null}
      </div>
    </header>
  );
}
