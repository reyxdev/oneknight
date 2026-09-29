export const legalDocs = ["privacy", "terms", "offer", "cookies", "oneknight-terms", "subscription-terms", "refund"] as const;
export type LegalDoc = (typeof legalDocs)[number];
export const legalSections = ["scope", "parties", "data", "rights", "payment", "liability", "changes", "contact"] as const;
