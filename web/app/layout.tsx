import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AttestFlow — Cross-Chain Verified Payment Engine',
  description: 'AI agent settling cross-chain payments with Attestcoin Protocol proofs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
