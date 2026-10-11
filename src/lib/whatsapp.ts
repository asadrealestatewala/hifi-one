// WhatsApp "click to chat" links. They open the person's own WhatsApp (app or web) with the message ready to read and send.
// Hifi One does not send anything and cannot tell whether the message was sent: that needs the WhatsApp Business API, which
// requires a Meta business account and approved message templates.

// International digits only. A number needs a country code; local numbers starting with 0 are expanded with the given default.
export function whatsappNumber(raw: string | null | undefined, defaultCountryCode = "92"): string | null {
  let d = (raw ?? "").trim();
  if (!d) return null;
  const plus = d.startsWith("+");
  d = d.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("0")) d = defaultCountryCode + d.slice(1);
  return d.length >= 8 && d.length <= 15 && !d.startsWith("0") ? d : null;
}

export function whatsappLink(raw: string | null | undefined, text: string, defaultCountryCode = "92"): string | null {
  const n = whatsappNumber(raw, defaultCountryCode);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text.slice(0, 1000))}` : null;
}

export const templates = {
  leadFollowUp: (lead: string, me: string, company: string) => `Hello ${lead}, this is ${me} from ${company}. Thank you for your interest in our services. Is now a good time to talk about what you need?`,
  quoteFollowUp: (client: string, number: string, me: string, company: string) => `Hello ${client}, this is ${me} from ${company}. I wanted to check that you received quotation ${number} and whether you have any questions.`,
  paymentReminder: (client: string, number: string, balance: string, due: string | null, company: string) =>
    `Hello ${client}, a friendly reminder from ${company}: invoice ${number} has a balance of ${balance}${due ? ` that was due on ${due}` : ""}. Please let us know if you need anything from us to complete the payment. Thank you.`,
};
