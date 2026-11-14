// The image version of a Hifi Partner Stack certificate, sized for social posts and link previews (1200 x 627, the
// LinkedIn share size). Same facts and the same look as the "Modern" PDF design. Used for the partner's PNG download
// and as the preview card when a verify link is shared on LinkedIn, WhatsApp or X.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export type SocialCard = {
  partnerName: string;
  partnerId: string;
  solutionName: string;
  partnerType: string;
  publicId: string;
  validUntil: string;
  status: "VALID" | "EXPIRED" | "REVOKED";
  company: string;
};

export const SOCIAL_SIZE = { width: 1200, height: 627 };
const NAVY = "#1b2559";
const RED = "#e11d1d";

const file = (...p: string[]) => { try { return readFileSync(path.join(process.cwd(), "public", ...p)); } catch { return null; } };
let logo: string | null | undefined;
function logoDataUrl_() {
  if (logo === undefined) { const b = file("logo.png"); logo = b ? `data:image/png;base64,${b.toString("base64")}` : null; }
  return logo;
}
// Inter (SIL Open Font License, public/partner-stack/fonts). Without the files the renderer's built-in font is used.
let fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[] | undefined;
function interFonts() {
  if (fonts === undefined) {
    fonts = ([400, 700] as const).flatMap((weight) => { const data = file("partner-stack", "fonts", `inter-latin-${weight}-normal.woff`); return data ? [{ name: "Inter", data, weight, style: "normal" as const }] : []; });
  }
  return fonts;
}

export function socialCertificateImage(c: SocialCard | null, init?: { headers?: Record<string, string> }) {
  const shown = c && c.status === "VALID" ? c : null;
  const logoDataUrl = logoDataUrl_();
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#ffffff", fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 400, background: NAVY, padding: "56px 48px", color: "#ffffff" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {logoDataUrl && (
              <div style={{ display: "flex", width: 64, height: 64, background: "#ffffff", borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                <img src={logoDataUrl} width={52} height={52} />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 2 }}>HIFI PARTNER STACK</div>
              <div style={{ fontSize: 15, color: "#aab3d6", marginTop: 4 }}>{c?.company ?? "Hifi Marketing and Technologies"}</div>
            </div>
          </div>
          {shown ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 15, color: "#aab3d6", letterSpacing: 2 }}>AUTHORISED SOLUTION</div>
              <div style={{ fontSize: 44, fontWeight: 700, marginTop: 8, lineHeight: 1.1 }}>{shown.solutionName}</div>
              <div style={{ display: "flex", marginTop: 20 }}>
                <div style={{ background: RED, borderRadius: 999, padding: "8px 18px", fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>{shown.partnerType.toUpperCase()}</div>
              </div>
            </div>
          ) : <div style={{ display: "flex" }} />}
          <div style={{ fontSize: 15, color: "#aab3d6" }}>Verify any certificate online</div>
        </div>
        <div style={{ width: 10, background: RED }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "56px 64px" }}>
          {shown ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: RED, letterSpacing: 4 }}>CERTIFICATE OF AUTHORISATION</div>
              <div style={{ fontSize: 22, color: "#6b7080", marginTop: 40 }}>This certifies that</div>
              <div style={{ fontSize: shown.partnerName.length > 26 ? 48 : 60, fontWeight: 700, color: NAVY, marginTop: 6, lineHeight: 1.1 }}>{shown.partnerName}</div>
              <div style={{ fontSize: 18, color: "#6b7080", marginTop: 14, letterSpacing: 1 }}>{`Partner ID ${shown.partnerId}`}</div>
              <div style={{ fontSize: 24, color: "#1f2433", marginTop: 30, lineHeight: 1.4 }}>
                {`is an authorised ${shown.partnerType} for ${shown.solutionName}.`}
              </div>
              <div style={{ width: 56, height: 5, background: RED, marginTop: 36 }} />
              <div style={{ display: "flex", marginTop: 28, fontSize: 17, color: "#6b7080" }}>
                <div style={{ display: "flex", flexDirection: "column", marginRight: 56 }}><span style={{ letterSpacing: 1 }}>VALID UNTIL</span><span style={{ color: "#1f2433", fontWeight: 700, fontSize: 21, marginTop: 4 }}>{shown.validUntil}</span></div>
                <div style={{ display: "flex", flexDirection: "column" }}><span style={{ letterSpacing: 1 }}>CERTIFICATE ID</span><span style={{ color: NAVY, fontWeight: 700, fontSize: 21, marginTop: 4 }}>{shown.publicId}</span></div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: RED, letterSpacing: 4 }}>CERTIFICATE CHECK</div>
              <div style={{ fontSize: 52, fontWeight: 700, color: NAVY, marginTop: 20, lineHeight: 1.15 }}>Check a Hifi Partner Stack certificate</div>
              <div style={{ fontSize: 24, color: "#6b7080", marginTop: 20 }}>Open the link to see whether it is genuine and still valid.</div>
            </div>
          )}
        </div>
      </div>
    ),
    { ...SOCIAL_SIZE, fonts: interFonts(), headers: init?.headers },
  );
}
