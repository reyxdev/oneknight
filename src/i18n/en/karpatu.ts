import type { Dict } from "../uk";

export const karpatu: Dict["karpatu"] = {
  eyebrow: "Case",
  intro: "An online store for handmade wooden bread boxes from the Carpathians. Built from scratch: design, code, SEO.",
  tags: ["Custom build", "React + Node.js", "Not a template", "SEO + GEO"],
  previewLabel: "karpatu.shop preview",
  device: "Screen",
  desktop: "Computer",
  mobile: "Phone",
  prev: "Previous screen",
  next: "Next screen",
  open: "Open the live site",
  shotsNote: "Screenshots of the live site. The site forbids embedding, so this is not an iframe.",
  stops: {
    home: "Home",
    catalog: "Catalogue",
    filters: "Categories",
    material: "Material",
    products: "Other products",
    ornament: "Ornament",
    process: "How it is made",
  },
  layersLabel: "What is inside",
  verified: "Checked on the live site {date}",
  layers: {
    design: {
      name: "Design",
      title: "Its own visual style",
      points: [
        "A dark forest atmosphere with the products at the centre",
        "Petrykivka painting as the main motif",
        "Its own font pair: Literata and Golos",
        "A mobile version designed separately",
      ],
    },
    structure: {
      name: "Structure",
      title: "The site leads from interest to purchase",
      points: [
        "Sections: bread boxes, other products, gifts, how we make it, gallery, journal, reviews",
        "{urls} pages in the sitemap",
        "A catalogue of {variants} bread box variants",
      ],
    },
    functionality: {
      name: "Features",
      title: "What a store needs",
      points: [
        "Cart and checkout",
        "Gift finder",
        "Delivery by Nova Poshta or Ukrposhta, payment on delivery",
        "Admin panel with a password and an authenticator code",
        "Analytics that asks for consent",
      ],
    },
    seo: {
      name: "SEO",
      title: "Search understands what is sold here",
      points: [
        "Structured data: {schema}",
        "{langs} languages with correct hreflang",
        "Canonical URLs and a sitemap",
      ],
    },
    geo: {
      name: "GEO",
      title: "Ready for AI search",
      points: [
        "robots.txt explicitly allows ChatGPT, Claude, Perplexity, Gemini bots",
        "An llms.txt file with key facts about the workshop",
        "Answers to common questions in structured form",
      ],
    },
    tech: {
      name: "Tech",
      title: "Fast and secure",
      points: [
        "React + Node.js, no site builders or templates",
        "Images in AVIF",
        "Self-hosted fonts",
        "Security headers: CSP, HSTS, no embedding",
      ],
    },
  },
  testimonial: {
    title: "From the owner",
    pending: "The owner's review will appear here once they agree to publish it. We do not write reviews for clients.",
    video: "Video review",
  },
  results: {
    title: "Results",
    pending: "We will show numbers once the owner agrees to publish them. There will be no invented numbers here.",
  },
  real: "This is a real project. Not a concept.",
};
