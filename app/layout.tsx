import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DSA Virtualizer — See your code think.",
  description:
    "A step-by-step algorithm workspace. Write JavaScript, inspect every change, and see your code think.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
