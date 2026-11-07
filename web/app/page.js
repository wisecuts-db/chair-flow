import Link from 'next/link';

export default function Home() {
  return (
    <main className="page" style={{ paddingTop: 48 }}>
      <div className="brand" style={{ fontSize: 28 }}>Chair Flow</div>
      <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>Run the shop. Decide who sees what.</h1>
      <p className="muted" style={{ fontSize: 17, margin: 0 }}>
        Bookings, walk-ins, staff, booth rent and contracts for barbershops with employees and booth renters.
        Owners control what managers, barbers, renters and clients can see.
      </p>
      <div className="row wrap">
        <Link className="btn dark" href="/login">Sign in</Link>
        <Link className="btn" href="/login?new=1">Set up my shop</Link>
      </div>
      <p className="small muted">
        Clients book through your shop&apos;s link, and walk-ins sign in on the shop tablet. You&apos;ll find both links on your dashboard.
      </p>
    </main>
  );
}
