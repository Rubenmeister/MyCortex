import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MyCortex',
  description: 'Your AI second brain',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
