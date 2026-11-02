import type { Metadata } from "next";
import { PageHero } from "../../_components/Blocks";
import { APK_URL, APK_VERSION, APP_FEATURES } from "../../_content/app";

export const metadata: Metadata = {
  title: "Hifi One staff app",
  description: "Download the Hifi One app for Android: tasks, attendance, leave and notifications for Hifi Marketing and Technologies staff.",
  alternates: { canonical: "/site/app" },
};

export default function AppPage() {
  return (
    <>
      <PageHero eyebrow="Staff app" title="Hifi One for Android" intro="Tasks, attendance, leave and notifications in your pocket. For Hifi staff; clients and vendors use the web portal." />
      <section className="hs-section">
        <div className="hs-container" style={{ maxWidth: 720 }}>
          <div className="hs-card" style={{ padding: 32 }}>
            <h2 style={{ fontSize: 24, margin: "0 0 14px" }}>What you can do</h2>
            <ul>{APP_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
            {APK_URL ? (
              <p style={{ marginTop: 24 }}><a className="hs-btn" href={APK_URL} download>Download for Android (version {APK_VERSION})</a></p>
            ) : (
              <p style={{ marginTop: 24 }}><strong>The download is not published yet.</strong> Ask your administrator for the app file.</p>
            )}
            <h2 style={{ fontSize: 20, margin: "28px 0 10px" }}>How to install</h2>
            <ol>
              <li>Open this page on your Android phone and tap Download.</li>
              <li>Open the downloaded file. If Android asks, allow installs from your browser for this one time.</li>
              <li>Open Hifi One and sign in with the same email or phone and password you use on the website.</li>
            </ol>
            <p style={{ fontSize: 14, opacity: 0.75 }}>An iPhone version is planned. Until then, sign in on the website from your phone browser.</p>
          </div>
        </div>
      </section>
    </>
  );
}
