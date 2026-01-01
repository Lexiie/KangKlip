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
      <body className="min-h-screen">
        <div className="relative min-h-screen overflow-hidden px-6 py-10">
          <div className="pointer-events-none absolute inset-0">
            <div className="orbit absolute -left-24 top-10 h-64 w-64 rounded-full bg-orange-300/40 blur-[120px]" />
            <div className="orbit absolute right-0 top-32 h-72 w-72 rounded-full bg-indigo-200/50 blur-[130px]" />
            <div className="orbit absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-amber-200/40 blur-[140px]" />
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
