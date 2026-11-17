const ROWS = Array.from({ length: 8 }, (_v, i) => i);

export default function AdminLoading(): React.ReactNode {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="route-progress" aria-hidden="true">
        <span />
      </div>
      <div className="page-head">
        <span className="skel skel--title" aria-hidden="true" />
        <span className="skel skel--btn" aria-hidden="true" />
      </div>
      <div className="admin-table-scroll" aria-hidden="true">
        <div className="skel-table">
          {ROWS.map((i) => (
            <div key={i} className="skel-table__row">
              <span className="skel skel--cell" style={{ inlineSize: "36%" }} />
              <span className="skel skel--cell" style={{ inlineSize: "14%" }} />
              <span className="skel skel--cell" style={{ inlineSize: "18%" }} />
              <span className="skel skel--cell" style={{ inlineSize: "10%" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
