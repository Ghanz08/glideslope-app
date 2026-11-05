import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { APP_NAME } from "@/lib/env";
import "./globals.css";
import { THEME_COLOR } from "./tokens";
import { SwRegister } from "@/components/sw-register";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Runway dana sampai lulus, tangkapan email otomatis, aset, nota, dan bagi tagihan.",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = { themeColor: THEME_COLOR, width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable}>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
