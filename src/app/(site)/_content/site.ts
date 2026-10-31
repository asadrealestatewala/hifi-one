// Copy and facts for the public website. Everything here comes from the original hifimarketing.co pages; nothing is invented.
export const SITE_URL = "https://hifimarketing.co";
export const COMPANY = "HIFI Marketing & Technologies";
export const EMAIL = "careers.asia@hifimarketing.co";
export const PHONE = "+92 316 8080801";
export const PHONE_HREF = "tel:+923168080801";

export const SOCIALS = [
  { label: "Facebook", href: "https://www.facebook.com/hifimarketingglobal/", icon: "facebook" },
  { label: "Instagram", href: "https://www.instagram.com/hifi.marketing/", icon: "instagram" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/hifi-marketing-global", icon: "linkedin" },
] as const;

export const NAV = [
  { href: "/site/services", label: "Services" },
  { href: "/site/pricing", label: "Pricing" },
  { href: "/site/about", label: "About" },
  { href: "/site/careers", label: "Careers" },
  { href: "/site/blog", label: "News" },
  { href: "/site/contact", label: "Contact" },
] as const;

export type Service = { id: string; title: string; tagline: string; summary: string; image: { src: string; width: number; height: number }; points: string[] };

export const SERVICES: Service[] = [
  {
    id: "websites",
    title: "Websites",
    tagline: "Crafting engaging online experiences",
    summary: "Crafting engaging online experiences that convert visitors into loyal customers.",
    image: { src: "/site/images/faizan.avif", width: 980, height: 527 },
    points: [
      "Custom website design & development",
      "Responsive & mobile-first approach",
      "E-commerce solutions (WooCommerce, Shopify)",
      "CMS integration (WordPress, Webflow)",
      "Speed optimization & performance tuning",
      "SEO-friendly architecture",
      "WhatsApp & live chat integration",
      "Ongoing maintenance & support",
    ],
  },
  {
    id: "social",
    title: "Social Media",
    tagline: "Elevate your brand's online presence",
    summary: "Elevate your brand's online presence with strategic content and community management.",
    image: { src: "/site/images/social.jpg", width: 1024, height: 677 },
    points: [
      "Social media strategy & planning",
      "Content creation & calendar management",
      "Community engagement & response",
      "Paid social advertising (Meta, LinkedIn, TikTok)",
      "Analytics & performance reporting",
      "Influencer marketing & partnerships",
      "Brand voice & visual identity alignment",
      "Instagram, Facebook, LinkedIn, Twitter, TikTok",
    ],
  },
  {
    id: "crm-erp",
    title: "CRM / ERP",
    tagline: "Streamline your processes and customer relationships",
    summary: "Streamline your processes and customer relationships with powerful automation tools.",
    image: { src: "/site/images/CRM.webp", width: 1600, height: 997 },
    points: [
      "Custom CRM development & integration",
      "Sales pipeline & lead management",
      "Email automation & marketing campaigns",
      "Customer data & analytics",
      "ERP system implementation",
      "Inventory & order management",
      "HR & payroll integration",
      "Zoho, Salesforce, HubSpot, Odoo expertise",
    ],
  },
  {
    id: "ads",
    title: "Ads Management",
    tagline: "Maximize your reach and ROI",
    summary: "Maximize your reach and ROI with data-driven advertising campaigns.",
    image: { src: "/site/images/Ads.webp", width: 750, height: 421 },
    points: [
      "Google Ads (Search, Display, Shopping)",
      "Meta Ads (Facebook & Instagram)",
      "LinkedIn Ads & TikTok Ads",
      "Retargeting & remarketing campaigns",
      "A/B testing & conversion optimization",
      "Keyword research & audience targeting",
      "Daily budget management & bidding",
      "Detailed ROI & performance reporting",
    ],
  },
];

// Platforms named in the service descriptions above
export const PLATFORMS = ["WordPress", "Shopify", "WooCommerce", "Webflow", "Google Ads", "Meta", "TikTok", "LinkedIn", "HubSpot", "Salesforce", "Zoho", "Odoo"];

export const STATS = [
  { value: "10+", label: "Years experience" },
  { value: "500+", label: "Projects done" },
  { value: "140+", label: "Happy clients" },
  { value: "98%", label: "Satisfied clients" },
];

export type PlanLine = { label: string; value: string };
export type Plan = { name: string; sub: string; price: string; note: string; popular?: string; lines: PlanLine[]; delivery?: string };
export type PlanGroup = { id: string; title: string; blurb: string; plans: Plan[] };

const inc = (...labels: string[]): PlanLine[] => labels.map((label) => ({ label, value: "Included" }));

export const PLAN_GROUPS: PlanGroup[] = [
  {
    id: "websites",
    title: "Website design",
    blurb: "One-time project prices.",
    plans: [
      { name: "Express Website", sub: "Perfect for quick setup", price: "AED 999", note: "One-time", delivery: "5–7 days", lines: [{ label: "Landing page", value: "AED 499" }, { label: "5-page website", value: "AED 999" }, ...inc("Mobile responsive", "Basic SEO setup"), { label: "WhatsApp integration", value: "AED 99" }] },
      { name: "Professional Website", sub: "Complete business solution for SMEs", price: "AED 1,499", note: "One-time", popular: "Most popular", delivery: "10–14 days", lines: [...inc("8–12 pages", "Custom UI/UX design", "Blog or services module", "On-page SEO", "Speed optimization"), { label: "WhatsApp + email automation", value: "AED 199" }, ...inc("3 revisions")] },
      { name: "Premium Website", sub: "Enterprise & e-commerce", price: "AED 2,999", note: "One-time", delivery: "20–30 days", lines: [...inc("Up to 30 pages / products", "Full custom UI/UX", "Payment gateway", "Product management", "Advanced SEO", "Social pixel integration"), { label: "1 month support", value: "Free" }] },
    ],
  },
  {
    id: "seo",
    title: "SEO",
    blurb: "Monthly plans.",
    plans: [
      { name: "SEO Starter", sub: "Get found locally", price: "AED 599", note: "Per month", lines: inc("Keyword research", "On-page optimization", "5 keywords tracked", "Monthly report") },
      { name: "SEO Pro", sub: "Grow organic traffic", price: "AED 999", note: "Per month", popular: "Best value", lines: inc("Full SEO strategy", "Content optimization", "20 keywords tracked", "Backlink building", "Competitor analysis", "Bi-weekly reports") },
      { name: "SEO Enterprise", sub: "Own your market", price: "AED 1,999", note: "Per month", lines: inc("Comprehensive SEO", "50+ keywords tracked", "Full content strategy", "Advanced link building", "Technical SEO audit", "Weekly reports + dashboard") },
    ],
  },
  {
    id: "social",
    title: "Social media",
    blurb: "Monthly plans.",
    plans: [
      { name: "Social Starter", sub: "Stay consistent", price: "AED 799", note: "Per month", lines: inc("3 social platforms", "10 posts / month", "Basic analytics", "Monthly report") },
      { name: "Social Pro", sub: "Content and paid reach", price: "AED 1,499", note: "Per month", popular: "Most popular", lines: inc("All social platforms", "20 posts + stories", "Paid ad management", "Advanced analytics", "Content strategy", "Weekly reports") },
      { name: "Social Enterprise", sub: "Full marketing suite", price: "AED 2,999", note: "Per month", lines: inc("Full marketing suite", "Unlimited content", "Full ad management", "Influencer marketing", "Dedicated account manager", "Real-time analytics") },
    ],
  },
  {
    id: "cgi",
    title: "CGI & 3D",
    blurb: "Per-project prices.",
    plans: [
      { name: "3D Basic", sub: "Models and visuals", price: "AED 499", note: "Per project", lines: [{ label: "3D modeling", value: "AED 499" }, { label: "Product visualization", value: "AED 699" }, ...inc("Basic rendering")] },
      { name: "3D Pro", sub: "Animation and showcase", price: "AED 1,499", note: "Per project", popular: "Most popular", lines: [...inc("Advanced 3D modeling", "Animation", "High-end rendering", "3D product showcase"), { label: "Virtual reality", value: "AED 499" }] },
      { name: "CGI Enterprise", sub: "Full CGI production", price: "AED 2,999", note: "Per project", lines: inc("Full CGI production", "3D animation", "Visual effects", "AR/VR solutions", "Interactive 3D") },
    ],
  },
  {
    id: "erp",
    title: "ERP systems",
    blurb: "Monthly plans.",
    plans: [
      { name: "ERP Basic", sub: "Leads and contacts", price: "AED 499", note: "Per month", lines: inc("Lead management", "Contact database", "Email tracking", "Basic reports") },
      { name: "ERP Pro", sub: "Full CRM", price: "AED 999", note: "Per month", popular: "Most popular", lines: inc("Full CRM features", "Sales pipeline", "Email automation", "Advanced analytics", "Tool integration", "5 user accounts") },
      { name: "ERP Enterprise", sub: "Run the whole business", price: "AED 2,999", note: "Per month", lines: inc("Complete ERP solution", "Inventory management", "HR & payroll", "Financial management", "Custom modules", "Unlimited users") },
    ],
  },
  {
    id: "creative",
    title: "Creative design",
    blurb: "Per-project prices.",
    plans: [
      { name: "Creative Basic", sub: "Essentials", price: "AED 299", note: "Per project", lines: [{ label: "Logo design", value: "AED 299" }, { label: "Social media graphics", value: "AED 199" }, { label: "Business card", value: "AED 99" }] },
      { name: "Creative Pro", sub: "Brand identity", price: "AED 999", note: "Per project", popular: "Most popular", lines: [...inc("Brand identity", "Complete branding", "Marketing materials"), { label: "Packaging design", value: "AED 299" }] },
      { name: "Creative Enterprise", sub: "Full design system", price: "AED 1,999", note: "Per project", lines: inc("Full brand strategy", "Complete design system", "UI/UX design", "Motion graphics", "Unlimited revisions") },
    ],
  },
];

export type Person = { name: string; role: string; photo?: { src: string; width: number; height: number } };
export const TEAM: Person[] = [
  { name: "Engr Asad B Zaman", role: "CEO", photo: { src: "/site/images/sir asad.png", width: 496, height: 497 } },
  { name: "Umair Qayyum", role: "Marketing Director", photo: { src: "/site/images/sir umair.jpg", width: 955, height: 960 } },
  { name: "Naghma Riaz", role: "Project Manager", photo: { src: "/site/images/naghma riaz.png", width: 644, height: 647 } },
  { name: "Muhammad Faizan", role: "AI Developer", photo: { src: "/site/images/faizan.png", width: 637, height: 644 } },
  { name: "Shgufta Munir", role: "Digital Marketer", photo: { src: "/site/images/shgufta.jpg", width: 2040, height: 2048 } },
  { name: "Hassnain", role: "eBay Expert" },
  { name: "Ali", role: "Video Editor" },
  { name: "Sana Fatima", role: "Graphic Designer" },
];

export const OFFICES = [
  { region: "Pakistan", kind: "Global delivery center", lines: ["Heights 3 Soan Garden, Islamabad", "First Floor PZT Plaza opp. DHA 1 Islamabad", "Unit 01, Mezzanine Floor, Shadman Town Rawalpindi, Punjab"] },
  { region: "United States", kind: "Regional office", lines: ["7901 4th St N # 24416", "St. Petersburg, FL 33702"] },
  { region: "United Kingdom", kind: "Regional office", lines: ["Unit 7 Pristine Business Park, Newport Rd, Woburn Sands", "Milton Keynes, MK17 8UD"] },
  { region: "United Arab Emirates", kind: "Regional office", lines: ["Jumeirah Lakes Towers, Dubai"] },
];

const u = (id: string, size: string) => `/site/vendor/unsplash/photo-${id}-${size}.jpg`;

export const HIRING_STEPS = [
  { title: "Submit application", text: "Pick a role and send your details and CV from its page.", image: u("1586281380349-632531db7ed4", "400x400") },
  { title: "Expert evaluation", text: "Our team reviews your experience against the role.", image: u("1552664730-d307ca884978", "400x400") },
  { title: "Personal interview", text: "Meet the people you would work with.", image: u("1573497019940-1c28c88b4f3e", "400x400") },
  { title: "Seamless onboarding", text: "Get set up and start contributing from day one.", image: u("1521791136064-7986c2920216", "400x400") },
];

export const PATHWAYS = [
  { title: "Associate Software Engineer", text: "Hone your skills with impactful projects and grow into a technical leader.", image: u("1581091226825-a6a2a5aee158", "400x500") },
  { title: "Software Engineer", text: "Deliver innovative solutions with confidence and take ownership of complex features.", image: u("1555066931-4365d14bab8c", "400x500") },
  { title: "Senior Software Engineer", text: "Lead by expertise and technical mastery, mentoring the next generation of engineers.", image: u("1551434678-e076c223a692", "400x500") },
  { title: "Associate Team Lead", text: "Mentor peers, manage workflows, and drive team success with vision.", image: u("1600880292203-757bb62b4baf", "400x500") },
  { title: "Let's Go Business", text: "Take the leap and grow into executive leadership and specialized domains.", image: u("1522071820081-009f0129c71c", "400x500") },
];

export const GLOBAL = [
  { title: "Global workforce", text: "From North America to the Middle East and APAC, our team spans the globe.", image: u("1526498460520-4c246339dccb", "400x500") },
  { title: "Diverse perspectives", text: "Varied cultural and professional backgrounds drive creativity and innovation.", image: u("1521737852567-6949f3f9f2b5", "400x500") },
  { title: "Seamless collaboration", text: "Leveraging modern tools to overcome borders and deliver excellence.", image: u("1552664730-d307ca884978", "400x500") },
  { title: "Opportunities without limits", text: "Roles that let you contribute and grow, no matter where you are.", image: u("1553877522-43269d4ea984", "400x500") },
];

export const BENEFITS = [
  "Fuel allowance", "OPD & IPD benefits", "Workation opportunities", "World-class gyms", "Exclusive salons", "Work from home options",
  "Paid leaves", "Skill development programs", "Performance bonuses", "Tech allowances", "Diverse work culture", "Health & wellness programs",
];

export const BENEFIT_PHOTO = u("1504384308090-c894fdcc538d", "600x400");

export const CULTURE = [
  { src: u("1522071820081-009f0129c71c", "400x300"), alt: "Team working together around a table" },
  { src: u("1517048676732-d65bc937f952", "400x300"), alt: "Team meeting" },
  { src: u("1556761175-5973dc0f32e7", "400x300"), alt: "Colleagues collaborating" },
  { src: u("1521737852567-6949f3f9f2b5", "400x300"), alt: "Office culture" },
  { src: u("1553877522-43269d4ea984", "400x300"), alt: "Teamwork at the office" },
];
