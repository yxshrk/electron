export const metadata = {
  title: 'Reflex',
  description: 'From a complaint to a merged PR, without a single ticket written.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
