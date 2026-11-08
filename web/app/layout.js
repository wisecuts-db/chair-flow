import './globals.css';

export const metadata = {
  title: 'ShopBoss',
  description: 'Run your barbershop: bookings, walk-ins, staff, booth rent, and who sees what.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F5F3EE',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
