export type SubjectKind = "event" | "platform";

export const FIELDS = {
  date_drop: "Date de sortie / drop",
  presale: "Préventes, codes, inscriptions",
  prix_retail: "Prix retail",
  type_billet: "Type de billet (PDF, Fan Wallet, transfert…)",
  livraison: "Livraison / transfert",
  sections: "Correspondance des sections au listing",
  frais: "Frais vendeur",
  delai_paiement: "Délai de paiement / payout",
  litiges: "Litiges et support",
  infos: "Autres infos utiles",
} as const;

export type Field = keyof typeof FIELDS;

export const FIELD_KEYS = Object.keys(FIELDS) as [Field, ...Field[]];

export const FIELDS_BY_KIND: Record<SubjectKind, Field[]> = {
  event: ["date_drop", "presale", "prix_retail", "type_billet", "livraison", "sections", "infos"],
  platform: ["frais", "delai_paiement", "livraison", "litiges", "infos"],
};

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
