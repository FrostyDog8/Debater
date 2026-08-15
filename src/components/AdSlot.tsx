type Props = {
  show: boolean;
};

export function AdSlot({ show }: Props) {
  if (!show) return null;
  const client = import.meta.env.VITE_ADSENSE_CLIENT;
  const slot = import.meta.env.VITE_ADSENSE_SLOT;
  return (
    <aside className="ad-slot" aria-label="Advertisement">
      {client && slot ? (
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%', minHeight: 50 }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format="horizontal"
          data-full-width-responsive="false"
        />
      ) : (
        <div className="ad-placeholder">Ad</div>
      )}
    </aside>
  );
}
