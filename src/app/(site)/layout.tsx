import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { COMPANY, EMAIL, NAV, PHONE, PHONE_HREF, SITE_URL, SOCIALS } from "./_content/site";
import { Icon } from "./_components/Icon";
import { SiteNav } from "./_components/SiteNav";
import "./site.css";

// The public website (hifimarketing.co): "/" for visitors and everything under /site. It shares only the root <html> with the ERP
// (theme script and base reset); its own styles are scoped under .hs so they never leak into the ERP screens.
const inter = localFont({
  src: "../../../public/site/vendor/google-fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--hs-font",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${COMPANY} | Websites, social media, ads and CRM/ERP`, template: `%s | ${COMPANY}` },
  description: "HIFI Marketing & Technologies is a digital agency delivering websites, social media, ads management, CRM/ERP and design, with one-time website packages from AED 999.",
  icons: { icon: [{ url: "/site/icons/icon-32.png", sizes: "32x32", type: "image/png" }, { url: "/site/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/site/icons/icon-180.png" },
  openGraph: { type: "website", siteName: COMPANY, locale: "en_US", images: [{ url: "/site/images/hero-poster.webp", width: 1280, height: 720 }] },
  twitter: { card: "summary_large_image" },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`hs ${inter.variable}`}>
      <a href="#main" className="hs-skip">Skip to content</a>
      <header className="hs-header">
        <div className="hs-container hs-header-inner">
          <Link href="/site" className="hs-logo" aria-label={`${COMPANY} home`}>
            HIFI <span>Marketing &amp; Technologies</span>
          </Link>
          <SiteNav />
        </div>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="hs-footer">
        <div className="hs-container hs-footer-grid">
          <div>
            <Link href="/site" className="hs-logo">HIFI <span>Marketing &amp; Technologies</span></Link>
            <p className="hs-muted">Websites, social media, ads management, CRM/ERP and design for growing businesses in Pakistan, the UAE, the UK and the US.</p>
            <ul className="hs-socials" aria-label="Social media">
              {SOCIALS.map((s) => (
                <li key={s.href}><a href={s.href} aria-label={s.label} rel="noopener" target="_blank"><Icon name={s.icon} size={18} /></a></li>
              ))}
            </ul>
          </div>
          <nav aria-label="Company">
            <h2>Company</h2>
            <ul>
              <li><Link href="/site/about">About us</Link></li>
              <li><Link href="/site/team">Our team</Link></li>
              <li><Link href="/site/careers">Careers</Link></li>
              <li><Link href="/site/blog">News &amp; media</Link></li>
            </ul>
          </nav>
          <nav aria-label="Services">
            <h2>Services</h2>
            <ul>
              {NAV.slice(0, 2).map((n) => <li key={n.href}><Link href={n.href}>{n.label}</Link></li>)}
              <li><Link href="/site/services#crm-erp">CRM / ERP</Link></li>
              <li><Link href="/site/services#ads">Ads management</Link></li>
            </ul>
          </nav>
          <div>
            <h2>Get in touch</h2>
            <ul>
              <li><a href={`mailto:${EMAIL}`}><Icon name="mail" size={16} /> {EMAIL}</a></li>
              <li><a href={PHONE_HREF}><Icon name="phone" size={16} /> {PHONE}</a></li>
              <li><Link href="/portal"><Icon name="building" size={16} /> Client portal</Link></li>
              <li><Link href="/login"><Icon name="user" size={16} /> Staff login</Link></li>
            </ul>
          </div>
        </div>
        <div className="hs-container hs-footer-bottom">
          <p>&copy; 2026 {COMPANY}. All rights reserved.</p>
          <p>Developed by <a href="https://foryoumoazma.my.canva.site/fz-cube-tech" rel="noopener" target="_blank">Muhammad Faizan</a></p>
        </div>
      </footer>
    </div>
  );
}
