import "./globals.css";

export const metadata = {
  title: "KangKlip",
  description: "AI short-clip generator",
};

type LayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: LayoutProps) {
  // Render the global layout wrapper.
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0b0b] font-body text-white antialiased">
        <div className="relative min-h-screen overflow-x-hidden px-4 pb-24 pt-8 sm:px-10 sm:pt-12">
          <div className="pointer-events-none absolute inset-0">
            <div className="grid-overlay absolute inset-0" />
            <div className="noise-layer absolute inset-0" />
          </div>
          <div className="relative">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
