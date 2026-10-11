import { whatsappLink } from "@/lib/whatsapp";

// Opens the person's own WhatsApp with a ready message. Nothing is sent by Hifi One.
export default function WhatsAppButton({ phone, text, label = "Message on WhatsApp" }: { phone: string | null | undefined; text: string; label?: string }) {
  const href = whatsappLink(phone, text);
  if (!href) return <span className="text-xs text-muted print:hidden">No usable phone number for WhatsApp</span>;
  return (
    <span className="print:hidden">
      <a className="btn-ghost" href={href} target="_blank" rel="noopener noreferrer">{label}</a>
      <span className="block text-[11px] text-muted mt-0.5">Opens WhatsApp with the message ready; you press send.</span>
    </span>
  );
}
