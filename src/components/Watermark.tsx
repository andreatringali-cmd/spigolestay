// Filigrana di sfondo: monogramma "S" ripetuto, molto tenue (dietro al contenuto).
export default function Watermark() {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>" +
    "<g fill='none' stroke='#BE5D38' stroke-opacity='0.05' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'>" +
    "<rect x='44' y='44' width='48' height='48' rx='12'/>" +
    "<path d='M80 58c-2.6-3.6-8.2-4.6-11.8-2-3.6 2.6-3.6 7.2 0 9.2l5.2 2.6c3.6 2 3.6 6.2 0 8.8-3.6 2.6-9.2 1-11.8-2.6'/>" +
    "</g></svg>";
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 0, backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundSize: "128px 128px" }}
    />
  );
}
