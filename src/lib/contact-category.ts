// How a contact category is shown to people. The stored value stays CUSTOMER; the screen word is "Client".
export const categoryLabel = (c: string): string => (c === "CUSTOMER" ? "Client" : c.charAt(0) + c.slice(1).toLowerCase());
